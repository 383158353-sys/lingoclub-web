import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/lib/AuthContext";
import MovieCard from "@/components/movie/MovieCard";
import { Search, Plus, Loader2, Users, ShieldAlert } from "lucide-react";

const FILTERS = [
{ key: "all", label: "全部" },
{ key: "beginner", label: "入门" },
{ key: "intermediate", label: "进阶" },
{ key: "advanced", label: "高级" }];


export default function Communities() {
  const [all, setAll] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [subscribing, setSubscribing] = useState(null);
  const [subscribedIds, setSubscribedIds] = useState(new Set());
  const [takingDown, setTakingDown] = useState(null);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const loadSubscriptions = useCallback(async () => {
    try {
      const subs = await base44.entities.Subscription.list("-created_date", 200);
      setSubscribedIds(new Set((subs || []).filter((s) => s.status === "active").map((s) => s.movie_id)));
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    base44.entities.Movie.list("-member_count", 200)
      .then(setAll)
      .finally(() => setLoading(false));
    loadSubscriptions();
  }, [loadSubscriptions]);

  // 管理员下架：将任意公开发布的视频单设为 private，对其他用户隐藏。
  // RLS 允许管理员更新任意 Movie；该操作仅影响公开可见性，不删除数据。
  const takeDown = async (movie) => {
    if (!window.confirm(`确定下架「${movie.title}」？下架后其他用户将无法在公开列表中看到此视频单。`)) return;
    setTakingDown(movie.id);
    try {
      await base44.entities.Movie.update(movie.id, { visibility: "private" });
      setAll((prev) => prev.filter((m) => m.id !== movie.id));
      toast({ title: "已下架", description: `「${movie.title}」已从公开列表移除。` });
    } catch (e) {
      toast({ title: "下架失败", description: e?.message || "请稍后重试", variant: "destructive" });
    } finally {
      setTakingDown(null);
    }
  };

  const subscribe = async (movie) => {
    setSubscribing(movie.id);
    try {
      const res = await base44.functions.invoke("subscribeToGroup", { movie_id: movie.id });
      const data = res?.data || res;
      if (data?.error) throw new Error(data.error);
      setSubscribedIds((prev) => new Set(prev).add(movie.id));
      toast({ title: data.already_subscribed ? "已订阅过" : "订阅成功", description: data.message || `「${movie.title}」的视频已导入你的库` });
      if (data.folder_id) navigate("/local-study");
    } catch (e) {
      toast({ title: "订阅失败", description: e?.message || "请稍后重试", variant: "destructive" });
    } finally {
      setSubscribing(null);
    }
  };

  // 浏览小组只展示已公开项目——未公开的私人项目由创建者从「创作者工坊」管理。
  const movies = useMemo(() => {
    return all.
    filter((m) => m.visibility === "public").
    filter((m) => {
      const okFilter = filter === "all" || m.difficulty === filter;
      const okQ = !q.trim() || (m.title + (m.title_en || "") + (m.tagline || "")).toLowerCase().includes(q.toLowerCase());
      return okFilter && okQ;
    });
  }, [all, filter, q]);

  return (
    <div className="mx-auto max-w-7xl px-4 lg:px-8 pt-20 pb-16 md:pt-28 md:pb-20">
      <header className="max-w-2xl">
        <p className="mb-2 text-[11px] uppercase tracking-luxe text-mint md:mb-3">Explore · 视频单</p>
        <h1 className="font-display text-2xl font-bold leading-tight text-foreground md:text-5xl">发现视频单，收藏即学</h1>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground md:mt-3 md:text-sm">每个视频单都是别人整理好的视频合集。收藏后自动导入到你的「我的视频」，随时开始学习。</p>
      </header>

      <div className="mt-6 flex flex-col gap-3 border-b border-border/50 pb-4 sm:flex-row sm:items-center sm:justify-between md:mt-10 md:gap-4 md:pb-6">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) =>
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-4 py-1.5 text-[13px] transition-colors ${
            filter === f.key ? "border-mint bg-mint text-background" : "border-white/15 text-muted-foreground hover:text-foreground"}`
            }>
            
              {f.label}
            </button>
          )}
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索影视 / 类型…"
            className="w-full rounded-full border border-white/15 bg-background-elev/50 py-2 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-mint/60 focus:outline-none sm:w-72" />
          
        </div>
      </div>

      {loading ?
      <div className="grid grid-cols-2 gap-3 md:gap-5 md:grid-cols-3 lg:grid-cols-4">
           {Array.from({ length: 6 }).map((_, i) => <div key={i} className="aspect-video animate-pulse rounded-lg bg-background-elev" />)}
         </div> :
      movies.length === 0 ?
      <div className="py-20 text-center text-sm text-muted-foreground">没有匹配的小组，换个关键词试试。</div> :

      <div className="grid grid-cols-2 gap-3 md:gap-5 md:grid-cols-3 lg:grid-cols-4">
          {movies.map((m, i) => (
            <div key={m.id} className="group">
              <MovieCard movie={m} index={i} />
              <div className="mt-1.5 flex items-center justify-between px-0.5 md:mt-2">
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground md:text-[11px]">
                  <Users size={10} className="text-mint/80 md:size-[11px]" /> {m.member_count || 0} 收藏
                </span>
                {isAdmin ? (
                  <button
                    onClick={() => takeDown(m)}
                    disabled={takingDown === m.id}
                    className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-rose-500/30 px-2.5 py-0.5 text-[10px] font-medium text-rose-300/80 transition-colors hover:border-rose-500/60 hover:text-rose-200 disabled:opacity-50 md:px-3 md:py-1 md:text-[11px]"
                  >
                    {takingDown === m.id ? <Loader2 size={10} className="animate-spin md:size-[11px]" /> : <ShieldAlert size={10} className="md:size-[11px]" />}
                    下架
                  </button>
                ) : subscribedIds.has(m.id) ? (
                  <button
                    onClick={() => navigate("/local-study")}
                    className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-mint/90 px-3 py-1 text-[11px] font-medium text-background"
                  >
                    已收藏 · 去学习
                  </button>
                ) : (
                  <button
                    onClick={() => subscribe(m)}
                    disabled={subscribing === m.id}
                    className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-copper px-2.5 py-0.5 text-[10px] font-medium text-copper-foreground disabled:opacity-50 md:px-3 md:py-1 md:text-[11px]"
                  >
                    {subscribing === m.id ? <Loader2 size={10} className="animate-spin md:size-[11px]" /> : <Plus size={10} className="md:size-[11px]" />}
                    收藏
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      }
    </div>);

}