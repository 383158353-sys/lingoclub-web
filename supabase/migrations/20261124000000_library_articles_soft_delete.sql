-- Soft-delete imported study articles. Vocabulary rows are not touched.
alter table public.library_articles add column if not exists deleted_at timestamptz;
create index if not exists library_articles_user_deleted_idx
  on public.library_articles (user_id, deleted_at desc);
