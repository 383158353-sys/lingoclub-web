-- Safe, additive extension for cue-accurate source playback and durable review events.
-- Existing user_state, vocabulary_sources, and review_logs rows are preserved.

alter table public.vocabulary_sources
  add column if not exists source_time_start double precision,
  add column if not exists source_time_end double precision,
  add column if not exists source_timestamp_end_seconds double precision,
  add column if not exists context_meaning text;

alter table public.review_logs
  add column if not exists source_id text,
  add column if not exists attempt_type text not null default 'first',
  add column if not exists previous_interval integer not null default 0,
  add column if not exists new_interval integer not null default 0;

alter table public.review_logs
  drop constraint if exists review_logs_review_mode_check;

alter table public.review_logs
  add constraint review_logs_review_mode_check
  check (review_mode in ('daily', 'due', 'weak', 'mistakes', 'random', 'manual', 'source', 'new', 'recent', 'today', 'all', 'focus', 'occasional'));

alter table public.review_logs
  drop constraint if exists review_logs_attempt_type_check;

alter table public.review_logs
  add constraint review_logs_attempt_type_check
  check (attempt_type in ('first', 'retry'));
