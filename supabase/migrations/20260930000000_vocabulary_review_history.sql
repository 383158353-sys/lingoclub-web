create table if not exists public.review_logs (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  vocabulary_id text not null,
  reviewed_at timestamptz not null,
  session_id uuid,
  question_type text not null,
  user_answer text,
  correct_answer text,
  is_correct boolean not null,
  rating smallint not null,
  response_time_ms integer,
  previous_mastery text,
  new_mastery text,
  previous_next_review_at timestamptz,
  new_next_review_at timestamptz,
  review_mode text not null check (review_mode in ('daily', 'weak', 'mistakes', 'random', 'manual')),
  created_at timestamptz not null default now()
);

create index if not exists review_logs_user_reviewed_at_idx
  on public.review_logs (user_id, reviewed_at desc);
create index if not exists review_logs_user_vocabulary_reviewed_at_idx
  on public.review_logs (user_id, vocabulary_id, reviewed_at desc);

alter table public.review_logs enable row level security;
revoke all on public.review_logs from anon;
grant select, insert on public.review_logs to authenticated;

drop policy if exists "Users read own review logs" on public.review_logs;
create policy "Users read own review logs"
  on public.review_logs for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users insert own review logs" on public.review_logs;
create policy "Users insert own review logs"
  on public.review_logs for insert to authenticated
  with check (auth.uid() = user_id);

create table if not exists public.vocabulary_sources (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  vocabulary_id text not null,
  source_key text not null,
  source_sentence_en text not null default '',
  source_sentence_zh text not null default '',
  source_movie_id text,
  source_movie_title text,
  source_episode_id text,
  source_episode_title text,
  source_subtitle_id text,
  source_timestamp_seconds double precision,
  source_timestamp_text text,
  source_type text not null default 'manual',
  subtitle_snapshot jsonb not null default '{}'::jsonb,
  saved_at timestamptz not null default now(),
  unique (user_id, vocabulary_id, source_key)
);

create index if not exists vocabulary_sources_user_vocabulary_idx
  on public.vocabulary_sources (user_id, vocabulary_id, saved_at desc);

alter table public.vocabulary_sources enable row level security;
revoke all on public.vocabulary_sources from anon;
grant select, insert, update on public.vocabulary_sources to authenticated;

drop policy if exists "Users read own vocabulary sources" on public.vocabulary_sources;
create policy "Users read own vocabulary sources"
  on public.vocabulary_sources for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users insert own vocabulary sources" on public.vocabulary_sources;
create policy "Users insert own vocabulary sources"
  on public.vocabulary_sources for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users update own vocabulary sources" on public.vocabulary_sources;
create policy "Users update own vocabulary sources"
  on public.vocabulary_sources for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
