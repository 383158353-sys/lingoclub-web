import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Heart, Loader2, RotateCw } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { useToast } from "@/components/ui/use-toast";
import { listDailyArticles, setArticleFavorite } from "@/lib/dailyArticles";
import { articleDomain, articlePath, groupArticlesByDate } from "@/lib/dailyArticlesFormat";
import { localDateKey } from "@/lib/srs";

export default function DailyArticleList() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState(new Set());
  useEffect(() => {
    let active = true;
    setItems([]); setLoading(true); setError("");
    listDailyArticles().then((rows) => { if (active) setItems(rows); })
      .catch(() => { if (active) setError("文章加载失败，请稍后重试"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.id, refresh]);
  const groups = useMemo(() => groupArticlesByDate(items, localDateKey()), [items]);
  const favorite = async (item) => {
    const next = !item.favorited;
    setPending((ids) => new Set([...ids, item.id]));
    setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, favorited: next } : row));
    try { await setArticleFavorite(item.id, next); }
    catch {
      setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, favorited: !next } : row));
      toast({ title: "收藏失败", description: "请稍后重试", variant: "destructive" });
    } finally { setPending((ids) => { const copy = new Set(ids); copy.delete(item.id); return copy; }); }
  };
  return <div className="mt-6">
    <div className="flex justify-end"><button type="button" onClick={() => setRefresh((n) => n + 1)} disabled={loading} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-border px-4 text-xs text-muted-foreground"><RotateCw size={13} /> 刷新文章</button></div>
    {loading ? <div className="flex justify-center py-20"><Loader2 className="animate-spin" aria-label="正在加载文章" /></div>
      : error ? <div className="py-16 text-center text-muted-foreground"><p>{error}</p><button type="button" onClick={() => setRefresh((n) => n + 1)} className="mt-4 text-copper">重试</button></div>
      : !groups.length ? <p className="rounded-2xl border border-dashed border-border px-6 py-16 text-center text-sm text-muted-foreground">还没有今日文章。早间精读短文导入后会出现在这里。</p>
      : <div className="mt-6 space-y-8">{groups.map((group) => <section key={group.date}>
        <h2 className="mb-3 text-sm text-foreground">{group.date === localDateKey() ? "今天" : group.date} · {group.items.length} 篇</h2>
        <div className="space-y-3">{group.items.map((item) => <article key={item.id} className="rounded-2xl border border-border bg-background-soft/60 p-4 md:p-5">
          <div className="flex items-start gap-3"><Link to={articlePath(item.id)} className="flex-1 font-display text-lg text-foreground hover:text-mint">{item.title}</Link>
            <button type="button" onClick={() => favorite(item)} disabled={pending.has(item.id)} aria-label={item.favorited ? "取消收藏文章" : "收藏文章"} aria-pressed={item.favorited} className="grid h-9 w-9 place-items-center disabled:opacity-50"><Heart size={18} className={item.favorited ? "text-rose-400" : "text-muted-foreground"} fill={item.favorited ? "currentColor" : "none"} /></button></div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground"><span>{item.outlet || articleDomain(item.source_url)}</span><span>{articleDomain(item.source_url)}</span>{item.level && <span className="text-mint">{item.level}</span>}<span>{item.read_at ? "已读" : "未读"}</span>{item.favorited && <span className="text-rose-400">已收藏</span>}</div>
          {item.summary_zh && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.summary_zh}</p>}
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">{(item.tags || []).map((tag) => <span key={tag}>#{tag}</span>)}</div>
          <Link to={articlePath(item.id)} className="mt-4 inline-flex min-h-9 items-center rounded-full bg-copper px-4 text-xs text-copper-foreground">开始阅读</Link>
        </article>)}</div>
      </section>)}</div>}
  </div>;
}
