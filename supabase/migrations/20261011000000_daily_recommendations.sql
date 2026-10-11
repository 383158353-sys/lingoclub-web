-- Daily recommended YouTube videos pushed by the recommendation assistant.
-- Rows are written only by /api/recommendations/import with the service role;
-- signed-in users can read their own rows and update only the status columns.
create table if not exists public.daily_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rec_date date not null,
  youtube_id text not null check (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  url text not null,
  title text not null,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  level text,
  tags text[] not null default '{}'::text[],
  summary_zh text not null default '',
  why_relevant text not null default '',
  source text not null check (source in ('digest', 'morning_read')),
  watched_at timestamptz,
  favorited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, rec_date, youtube_id)
);

create index if not exists daily_recommendations_user_date_idx
  on public.daily_recommendations (user_id, rec_date desc, created_at);

alter table public.daily_recommendations enable row level security;
revoke all on public.daily_recommendations from anon;
revoke all on public.daily_recommendations from authenticated;
grant select on public.daily_recommendations to authenticated;
-- Column-level grant: the browser can change watch/favorite state only.
grant update (watched_at, favorited, updated_at) on public.daily_recommendations to authenticated;

drop policy if exists "Users read own daily recommendations" on public.daily_recommendations;
create policy "Users read own daily recommendations"
  on public.daily_recommendations for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users update own daily recommendation status" on public.daily_recommendations;
create policy "Users update own daily recommendation status"
  on public.daily_recommendations for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Intentionally no insert/delete policies for authenticated users.
