-- 登录用户手动导入的学习文章，与早间推荐隔离。
create table public.library_articles (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 source_url text not null check (source_url ~ '^https?://'),
 title text not null check (length(trim(title)) between 1 and 300),
 body_en text not null check (length(trim(body_en)) between 1 and 50000),
 author text not null default '', outlet text not null default '', level text,
 summary_zh text not null default '', analysis jsonb not null default '{}'::jsonb,
 tags text[] not null default '{}', read_at timestamptz, favorited boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check (jsonb_typeof(analysis) = 'object')
);
create index library_articles_user_created_idx on public.library_articles(user_id, created_at desc);
alter table public.library_articles enable row level security;
revoke all on public.library_articles from anon;
grant select, insert, update, delete on public.library_articles to authenticated, service_role;
create policy "Users manage own library articles" on public.library_articles
 for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
