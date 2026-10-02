alter table public.vocabulary_sources
  add column if not exists source_record_id text,
  add column if not exists source_url text,
  add column if not exists source_video_id text;
