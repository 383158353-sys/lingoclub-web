alter table public.user_state
  add column if not exists movie_subtitles jsonb not null default '{}'::jsonb;

comment on column public.user_state.movie_subtitles is
  'Per-movie gzip archives loaded only when a user opens a movie; user_state.data contains metadata only.';
