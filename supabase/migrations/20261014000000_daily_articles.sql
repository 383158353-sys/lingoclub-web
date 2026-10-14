-- 每日精读短文由服务端导入，浏览器只能读取自己的文章和更新阅读状态。
create table if not exists public.daily_articles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rec_date date not null,
  source_url text not null,
  title text not null,
  author text not null default '',
  outlet text not null default '',
  level text,
  tags text[] not null default '{}'::text[],
  summary_zh text not null default '',
  body_en text not null,
  analysis jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  favorited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, rec_date, source_url)
);
create index if not exists daily_articles_user_date_idx
  on public.daily_articles (user_id, rec_date desc, created_at);
alter table public.daily_articles enable row level security;
revoke all on public.daily_articles from anon;
revoke all on public.daily_articles from authenticated;
grant select on public.daily_articles to authenticated;
grant update (read_at, favorited, updated_at) on public.daily_articles to authenticated;
create policy "Users read own daily articles"
  on public.daily_articles for select to authenticated using (auth.uid() = user_id);
create policy "Users update own daily article status"
  on public.daily_articles for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- authenticated 没有插入、删除权限。
