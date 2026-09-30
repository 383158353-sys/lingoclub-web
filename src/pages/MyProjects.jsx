import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { base44 } from "@/api/base44Client";
import { Image } from "@/components/ui/image";
import DifficultyBadge from "@/components/common/DifficultyBadge";
import { Users, Clapperboard, GripVertical, LogOut, Loader2, ChevronUp, ChevronDown, ArrowRight } from "lucide-react";

const k = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n));

// "个人订阅" — 仅展示当前用户已订阅 (status="active") 的小组。
// 退出后该小组不再出现于此页面；可在影片小组页再次加入（已存在记录会被重新激活）。
// 顺序由 `order` 字段持久化；拖动或上下按钮调整会立刻 bulkUpdate 入库。
export default function MyProjects() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const subs = await base44.entities.Subscription.list(null, 200);
      const active = (subs || []).filter((s) => s.status === "active");
      active.sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0) || new Date(a.start_date || 0) - new Date(b.start_date || 0)
      );
      const movieMap = {};
      await Promise.all(
        active.map(async (s) => {
          if (movieMap[s.movie_id]) return;
          try {
            movieMap[s.movie_id] = await base44.entities.Movie.get(s.movie_id);
          } catch (_) {
            /* 已被删除的小组静默忽略 */
          }
        })
      );
      setItems(active.map((s) => ({ sub: s, movie: movieMap[s.movie_id] })).filter((x) => x.movie));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const persistOrder = async (next) => {
    const updates = next.map((it, i) => ({ id: it.sub.id, order: i + 1 }));
    await base44.entities.Subscription.bulkUpdate(updates);
  };

  const onDragEnd = async (result) => {
    if (!result.destination || result.destination.index === result.source.index) return;
    const next = Array.from(items);
    const [moved] = next.splice(result.source.index, 1);
    next.splice(result.destination.index, 0, moved);
    setItems(next);
    try {
      await persistOrder(next);
    } catch (_) {
      /* ignore */
    }
  };

  const move = async (idx, dir) => {
    const target = dir === "up" ? idx - 1 : idx + 1;
    if (target < 0 || target >= items.length || busy) return;
    setBusy(items[idx].sub.id);
    const next = Array.from(items);
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    setItems(next);
    try {
      await persistOrder(next);
    } finally {
      setBusy(null);
    }
  };

  const leave = async (subId) => {
    setBusy(subId);
    try {
      await base44.entities.Subscription.update(subId, { status: "cancelled" });
      setItems((list) => list.filter((it) => it.sub.id !== subId));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-5 lg:px-8 pt-28 pb-20">
      <header className="max-w-2xl">
        <p className="mb-3 text-[11px] uppercase tracking-luxe text-copper/80">My Groups · 个人订阅</p>
        <h1 className="font-display text-4xl leading-tight text-foreground md:text-5xl">我加入的小组</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          所有正在订阅的小组都在这里。可拖动卡片调整顺序，也可随时退出 — 退出后仍可在影片页再次加入。
        </p>
      </header>

      {loading ? (
        <div className="mt-10 flex items-center justify-center py-16">
          <Loader2 size={18} className="animate-spin text-copper/70" />
        </div>
      ) : items.length === 0 ? (
        <div className="mt-12 rounded-2xl border border-dashed border-border bg-background-elev/30 py-16 text-center">
          <Clapperboard size={28} className="mx-auto text-copper/60" />
          <p className="mt-3 text-sm text-muted-foreground">还没有订阅任何小组。</p>
          <Link
            to="/communities"
            className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-copper px-5 py-2 text-sm font-medium text-copper-foreground"
          >
            去浏览小组 <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="subs">
            {(provided) => (
              <ul
                ref={provided.innerRef}
                {...provided.droppableProps}
                className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
              >
                {items.map((it, idx) => (
                  <Draggable key={it.sub.id} draggableId={it.sub.id} index={idx}>
                    {(p) => (
                      <li ref={p.innerRef} {...p.draggableProps} className="h-full">
                        <div className="group relative flex h-full gap-3 rounded-2xl border border-border/60 bg-card p-4 hover:border-copper/30">
                          <div className="flex items-center" {...p.dragHandleProps}>
                            <GripVertical size={16} className="cursor-grab text-muted-foreground/40" />
                          </div>
                          <Link
                            to={`/movie/${it.movie.id}`}
                            className="relative h-24 w-16 shrink-0 overflow-hidden rounded border border-border"
                          >
                            <Image
                              src={it.movie.poster_url}
                              alt={it.movie.title}
                              fittingType="fill"
                              focalPointY={0.35}
                              className="h-full w-full"
                            />
                          </Link>
                          <div className="min-w-0 flex-1">
                            <Link
                              to={`/movie/${it.movie.id}`}
                              className="font-display text-base leading-tight text-foreground line-clamp-2 hover:text-copper"
                            >
                              {it.movie.title}
                            </Link>
                            {it.movie.tagline && (
                              <p className="mt-1 line-clamp-1 text-[11px] italic text-muted-foreground">
                                {it.movie.tagline}
                              </p>
                            )}
                            <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                              <DifficultyBadge level={it.movie.difficulty} />
                              <span className="flex items-center gap-1"><Users size={11} className="text-copper/70" /> {k(it.movie.member_count || 0)}</span>
                            </div>
                            <div className="mt-3 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => leave(it.sub.id)}
                                disabled={busy === it.sub.id}
                                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:border-red-400/40 hover:text-red-200 disabled:opacity-50"
                              >
                                {busy === it.sub.id ? (
                                  <Loader2 size={11} className="animate-spin" />
                                ) : (
                                  <LogOut size={11} />
                                )}{" "}
                                退出小组
                              </button>
                              <div className="flex flex-col -my-1">
                                <button
                                  type="button"
                                  onClick={() => move(idx, "up")}
                                  disabled={idx === 0 || busy}
                                  className="text-muted-foreground/40 transition-colors hover:text-copper disabled:opacity-20"
                                  aria-label="上移"
                                >
                                  <ChevronUp size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => move(idx, "down")}
                                  disabled={idx === items.length - 1 || busy}
                                  className="text-muted-foreground/40 transition-colors hover:text-copper disabled:opacity-20"
                                  aria-label="下移"
                                >
                                  <ChevronDown size={14} />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </li>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </ul>
            )}
          </Droppable>
        </DragDropContext>
      )}
    </div>
  );
}