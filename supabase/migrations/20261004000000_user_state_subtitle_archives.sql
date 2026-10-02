alter table public.user_state
  add column if not exists movie_subtitles jsonb not null default '{}'::jsonb;

comment on column public.user_state.movie_subtitles is
  'Per-movie gzip archives loaded only when a user opens a movie; user_state.data contains metadata only.';

create or replace function public.compact_user_state_subtitles()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  movie jsonb;
  movie_id text;
  subtitle_count integer;
  compact_movies jsonb := '[]'::jsonb;
  extracted_archives jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(new.data->'movies') <> 'array' then
    return new;
  end if;

  for movie in select value from jsonb_array_elements(new.data->'movies')
  loop
    movie_id := movie->>'id';
    subtitle_count := case
      when jsonb_typeof(movie->'subtitles') = 'array' then jsonb_array_length(movie->'subtitles')
      else coalesce((movie->>'subtitle_count')::integer, 0)
    end;
    if movie_id is not null and (movie ? 'subtitles' or movie ? 'subtitle_text') then
      extracted_archives := extracted_archives || jsonb_build_object(
        movie_id,
        jsonb_build_object(
          'encoding', 'json',
          'data', jsonb_build_object(
            'subtitles', coalesce(movie->'subtitles', '[]'::jsonb),
            'subtitle_text', movie->'subtitle_text',
            'updated_at', coalesce(movie->>'subtitle_imported_at', movie->>'updated_date', now()::text)
          )
        )
      );
    end if;
    compact_movies := compact_movies || jsonb_build_array(
      (movie - 'subtitles' - 'subtitle_text') || jsonb_build_object('subtitle_count', subtitle_count)
    );
  end loop;

  new.movie_subtitles := coalesce(new.movie_subtitles, '{}'::jsonb) || extracted_archives;
  new.data := jsonb_set(new.data, '{movies}', compact_movies, true);
  return new;
end;
$$;

drop trigger if exists compact_user_state_subtitles_before_write on public.user_state;
create trigger compact_user_state_subtitles_before_write
before insert or update of data on public.user_state
for each row execute function public.compact_user_state_subtitles();

create or replace function public.get_movie_subtitle_archive(p_movie_id text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select movie_subtitles->p_movie_id
  from public.user_state
  where user_id = auth.uid()
  limit 1;
$$;

-- Compact existing rows after the archive column and trigger are ready.
update public.user_state set data = data;
