import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2, Clock, Heart, Loader2, PlayCircle, RotateCw, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { useToast } from "@/components/ui/use-toast";
import { localDateKey } from "@/lib/srs";
import {
  RECOMMENDATION_SOURCE_LABELS,
  formatDuration,
  groupRecommendationsByDate,
  groupRecommendationsBySection,
  listDailyRecommendations,
  markRecommendationWatched,
  quickStudyPath,
  recommendationsAvailable,
  setRecommendationFavorite,
  youtubeThumbnail,
} from "@/lib/dailyRecommendations";

const FILTERS = [
  { key: "all", label: "全部" },
  { key: "unwatched", label: "未看" },
  { key: "favorites", label: "收藏" },
];

function dateLabel(date, today) {
  if (date === today) return "今天";
  const yesterday = localDateKey(Date.now() - 24 * 60 * 60 * 1000);
  if (date === yesterday) return "昨天";
  const [, month, day] = date.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

export default function DailyRecommendations() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState("all");
  const today = localDateKey();

  const load = useCallback(async () => {
    if (!user || !recommendationsAvailable()) { setItems([]); setLoading(false); return; }
    setLoading(true);
    setLoadError("");
    try {
      setItems(await listDailyRecommendations());
    } catch (error) {
      console.warn("[daily recommendations] load failed", error?.code || error?.message);
      setLoadError("推荐加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const patchItem = (id, fields) => setItems((current) => current.map((item) => (item.id === id ? { ...item, ...fields } : item)));

  const openItem = (item) => {
    if (!item.watched_at) {
      const watchedAt = new Date().toISOString();
      patchItem(item.id, { watched_at: watchedAt });
      markRecommendationWatched(item.id, watchedAt).catch(() => patchItem(item.id, { watched_at: null }));
    }
    navigate(quickStudyPath(item));
  };

  const toggleFavorite = async (item) => {
    const next = !item.favorited;
    patchItem(item.id, { favorited: next });
    try {
      await setRecommendationFavorite(item.id, next);
    } catch {
      patchItem(item.id, { favorited: !next });
      toast({ title: "收藏失败", description: "请稍后重试", variant: "destructive" });
    }
  };

  const visible = useMemo(() => items.filter((item) => (
    filter === "unwatched" ? !item.watched_at : filter === "favorites" ? item.favorited : true
  )), [filter, items]);
  const groups = useMemo(() => groupRecommendationsByDate(visible, today), [today, visible]);
  const todayCount = items.filter((item) => item.rec_date === today).length;

  return (
    <div className="mx-auto max-w-5xl px-3 pb-16 pt-20 md:px-8 md:pt-28 md:pb-20">
      <header className="max-w-2xl">
        <p className="mb-2 text-[10px] uppercase tracking-luxe text-copper/80 md:mb-3 md:text-[11px]">Daily Picks</p>
        <h1 className="font-display text-2xl leading-tight text-foreground md:text-5xl">今日推荐</h1>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground md:mt-3 md:text-sm">
          每天推送的学习视频会自动出现在这里，点开即可进入精读。{todayCount > 0 && <span className="text-foreground/80">今天有 {todayCount} 个新推荐。</span>}
        </p>
      </header>

      {!user ? (
        <EmptyState icon={Sparkles} title="登录后查看每日推荐">
          <Link to="/login" className="mt-4 inline-flex min-h-10 items-center rounded-full bg-copper px-5 text-sm font-medium text-copper-foreground">邮箱登录</Link>
        </EmptyState>
      ) : !recommendationsAvailable() ? (
        <EmptyState icon={Sparkles} title="云端服务未配置" description="需要配置 Supabase 后才能接收每日推荐。" />
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-2 md:mt-8">
            {FILTERS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                aria-pressed={filter === key}
                className={`min-h-9 rounded-full border px-4 text-xs transition-colors ${filter === key ? "border-copper/60 bg-copper/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
              >
                {label}
              </button>
            ))}
            <button type="button" onClick={load} disabled={loading} aria-label="刷新" className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border px-3 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
              <RotateCw size={13} className={loading ? "animate-spin" : ""} /> 刷新
            </button>
          </div>

          {loading && !items.length ? (
            <div className="flex justify-center py-20"><Loader2 className="animate-spin text-muted-foreground" size={22} /></div>
          ) : loadError ? (
            <EmptyState icon={Sparkles} title={loadError}>
              <button type="button" onClick={load} className="mt-4 min-h-10 rounded-full border border-border px-5 text-sm text-foreground/85">重试</button>
            </EmptyState>
          ) : !groups.length ? (
            <EmptyState
              icon={Sparkles}
              title={filter === "all" ? "还没有推荐" : filter === "unwatched" ? "推荐都看完了" : "还没有收藏的推荐"}
              description={filter === "all" ? "每日推荐导入后会显示在这里。" : ""}
            />
          ) : (
            <div className="mt-6 space-y-8 md:mt-8 md:space-y-10">
              {groups.map((group) => (
                <section key={group.date} aria-label={`${group.date} 的推荐`}>
                  <h2 className="mb-3 flex items-baseline gap-2 text-sm font-medium text-foreground md:text-base">
                    {dateLabel(group.date, today)}
                    <span className="text-xs font-normal text-muted-foreground tabular-nums">{group.date} · {group.items.length} 个</span>
                  </h2>
                  <div className="space-y-5 md:space-y-6">
                    {groupRecommendationsBySection(group.items).map((section) => (
                      <div
                        key={section.name}
                        className={section.main ? "rounded-2xl border border-copper/40 bg-copper/5 p-2.5 md:p-3" : ""}
                      >
                        <h3 className={`mb-2 flex items-center gap-1.5 text-xs font-medium md:text-sm ${section.main ? "text-copper" : "text-foreground/80"}`}>
                          {section.main && <Sparkles size={14} />}
                          {section.name}
                          <span className="font-normal text-muted-foreground tabular-nums">· {section.items.length} 个</span>
                        </h3>
                        <div className="space-y-3">
                          {section.items.map((item) => (
                            <RecommendationCard key={item.id} item={item} onOpen={openItem} onToggleFavorite={toggleFavorite} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RecommendationCard({ item, onOpen, onToggleFavorite }) {
  const duration = formatDuration(item.duration_seconds);
  const watched = Boolean(item.watched_at);
  return (
    <article className={`rounded-2xl border border-white/10 bg-background-soft/60 p-3 transition-colors hover:border-white/20 md:p-4 ${watched ? "opacity-80" : ""}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
        <button type="button" onClick={() => onOpen(item)} className="group relative block w-full shrink-0 overflow-hidden rounded-xl bg-background-elev sm:w-56" aria-label={`开始精读：${item.title}`}>
          <img src={youtubeThumbnail(item.youtube_id)} alt="" loading="lazy" className="aspect-video w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
          <span className="absolute inset-0 grid place-items-center bg-black/0 transition-colors group-hover:bg-black/30">
            <PlayCircle size={36} className="text-white opacity-0 drop-shadow transition-opacity group-hover:opacity-100" />
          </span>
          {duration && <span className="absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[10px] tabular-nums text-white">{duration}</span>}
          {watched && <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-mint"><CheckCircle2 size={11} /> 已看</span>}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <button type="button" onClick={() => onOpen(item)} className="min-w-0 flex-1 text-left">
              <h3 className="line-clamp-2 text-sm font-medium leading-snug text-foreground hover:text-mint md:text-base">{item.title}</h3>
            </button>
            <button
              type="button"
              onClick={() => onToggleFavorite(item)}
              aria-pressed={item.favorited}
              aria-label={item.favorited ? "取消收藏" : "收藏"}
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors ${item.favorited ? "text-rose-400" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Heart size={17} fill={item.favorited ? "currentColor" : "none"} />
            </button>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="rounded-full bg-copper/10 px-2 py-0.5 text-copper">{RECOMMENDATION_SOURCE_LABELS[item.source] || item.source}</span>
            {item.level && <span className="rounded-full bg-mint/10 px-2 py-0.5 text-mint">{item.level}</span>}
            {duration && <span className="inline-flex items-center gap-1"><Clock size={11} />{duration}</span>}
            {(item.tags || []).map((tag) => <span key={tag} className="rounded-full border border-white/10 px-2 py-0.5">#{tag}</span>)}
          </div>

          {item.summary_zh && (
            <div className="mt-2.5">
              <p className="text-[11px] font-medium text-foreground/70">中文要点</p>
              <p className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-muted-foreground md:text-sm">{item.summary_zh}</p>
            </div>
          )}
          {item.why_relevant && (
            <div className="mt-2">
              <p className="text-[11px] font-medium text-foreground/70">为什么跟你有关</p>
              <p className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-muted-foreground md:text-sm">{item.why_relevant}</p>
            </div>
          )}

          <button type="button" onClick={() => onOpen(item)} className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-full bg-copper px-4 text-xs font-medium text-copper-foreground transition-transform hover:scale-[1.02]">
            <PlayCircle size={14} /> {watched ? "再次精读" : "开始精读"}
          </button>
        </div>
      </div>
    </article>
  );
}

function EmptyState({ icon: Icon, title, description, children }) {
  return (
    <div className="mx-auto mt-12 max-w-md rounded-2xl border border-dashed border-white/10 px-6 py-12 text-center">
      <Icon size={26} className="mx-auto text-copper" />
      <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
      {description && <p className="mt-1.5 text-xs text-muted-foreground">{description}</p>}
      {children}
    </div>
  );
}
