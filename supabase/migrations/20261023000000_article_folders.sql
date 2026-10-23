-- 学习页文章文件夹。收藏夹不入库，由 favorited 派生，与视频库一致。
alter table public.daily_articles add column if not exists folder text not null default '';
alter table public.library_articles add column if not exists folder text not null default '';

-- daily_articles 只有列级 UPDATE。新列必须单独授权，导入 upsert 不写 folder，已有归类保留。
grant update (folder) on public.daily_articles to authenticated;
