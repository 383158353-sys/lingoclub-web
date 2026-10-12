-- Shared YouTube transcript cache (captions are public data, not per-user).
-- Written/read only by serverless functions with the service role.
create table if not exists public.transcript_cache (
  youtube_id text primary key check (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  title text not null default '',
  language text not null default 'en',
  original_language text not null default 'en',
  is_auto_generated boolean not null default false,
  subtitles jsonb not null,
  extractor text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.transcript_cache enable row level security;
revoke all on public.transcript_cache from anon;
revoke all on public.transcript_cache from authenticated;
grant select, insert, update on public.transcript_cache to service_role;
