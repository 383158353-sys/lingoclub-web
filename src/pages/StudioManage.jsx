import React, { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useToast } from "@/components/ui/use-toast";
import { ArrowLeft, Plus, Loader2, ArrowRight, Film, ChevronUp, ChevronDown, GripVertical, Check, X, Clock, Pencil, Send, EyeOff } from "lucide-react";
import MovieMetaForm from "@/components/studio/MovieMetaForm";
import VisibilityPanel from "@/components/studio/VisibilityPanel";
import AiToolPanel from "@/components/studio/AiToolPanel";
import DeleteGroupButton from "@/components/studio/DeleteGroupButton";
import InlineEpisodeVideoBinder from "@/components/studio/InlineEpisodeVideoBinder";

export default function StudioManage() {
  const { movieId } = useParams();
  const { user } = useAuth();
  const [movie, setMovie] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [epForm, setEpForm] = useState({ episode: 1, title: "", synopsis: "" });

  const [moving, setMoving] = useState(null);
  const [pendingEps, setPendingEps] = useState([]);
  const [draftEps, setDraftEps] = useState([]);
  const { toast } = useToast();
  const [contribBusyId, setContribBusyId] = useState(null);
  const [contribNote, setContribNote] = useState({});

  useEffect(() => {
    if (!movieId) return;
    setLoading(true);
    (async () => {
      try {
        const m = await base44.entities.Movie.get(movieId);
        setMovie(m);
        let eps = await base44.entities.Episode.filter({ movie_id: movieId }, "order", 100);
        // Backfill `order` once for legacy rows so the up/down arrows can swap.
        if ((eps || []).some((e) => e.order == null || e.order === 0)) {
          const updates = (eps || []).map((e, i) => ({ id: e.id, order: i + 1 }));
          await base44.entities.Episode.bulkUpdate(updates);
          eps = (eps || []).map((e, i) => ({ ...e, order: i + 1 }));
        }
        const sorted = (eps || []).slice().sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
        setEpisodes(sorted.filter((e) => e.contribution_status === "approved" || e.contribution_status === undefined || e.contribution_status === null));
        setPendingEps(sorted.filter((e) => e.contribution_status === "pending"));
        setDraftEps(sorted.filter((e) => e.contribution_status === "draft"));
      } finally {
        setLoading(false);
      }
    })();
  }, [movieId]);

  const isOwner = movie && (movie.created_by_id === user?.id || user?.role === "admin");

  const moveEpisode = async (idx, dir) => {
    const target = dir === "up" ? idx - 1 : idx + 1;
    if (target < 0 || target >= episodes.length || moving) return;
    setMoving(idx);
    const a = episodes[idx];
    const b = episodes[target];
    const aOrder = a.order ?? idx + 1;
    const bOrder = b.order ?? target + 1;
    try {
      await base44.entities.Episode.bulkUpdate([
        { id: a.id, order: bOrder },
        { id: b.id, order: aOrder },
      ]);
      const updated = episodes
        .map((e) => (e.id === a.id ? { ...e, order: bOrder } : e.id === b.id ? { ...e, order: aOrder } : e))
        .sort((x, y) => (x.order ?? 99) - (y.order ?? 99));
      setEpisodes(updated);
    } finally {
      setMoving(null);
    }
  };

  const addEpisode = async (e) => {
    e.preventDefault();
    if (!epForm.title.trim()) return;
    setAdding(true);
    try {
      const ep = await base44.entities.Episode.create({
        movie_id: movieId,
        episode: String(epForm.episode || 1),
        episode_number: Number(epForm.episode) || 1,
        title: epForm.title,
        synopsis: epForm.synopsis,
        duration: 0,
        scene_count: 0,
        order: episodes.length + pendingEps.length + 1,
        contribution_status: "approved",
      });
      setEpisodes((es) => [...es, ep].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)));
      setEpForm((f) => ({ ...f, episode: Number(f.episode) + 1, title: "", synopsis: "" }));
    } finally {
      setAdding(false);
    }
  };

  const decideContribution = async (ep, action) => {
    setContribBusyId(ep.id);
    try {
      const updated = await base44.entities.Episode.update(ep.id, {
        contribution_status: action,
        review_note: action === "approved" ? "" : (contribNote[ep.id] || ""),
        reviewed_by_id: user?.id,
        reviewed_date: new Date().toISOString(),
      });
      setPendingEps((list) => list.filter((e) => e.id !== ep.id));
      setContribNote((n) => { const next = { ...n }; delete next[ep.id]; return next; });
      if (action === "approved") {
        setEpisodes((list) => [...list, updated].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)));
      }
      toast({ title: action === "approved" ? "已通过投稿" : "已驳回投稿" });
    } catch (err) {
      toast({ title: "操作失败", description: err?.message, variant: "destructive" });
    } finally {
      setContribBusyId(null);
    }
  };

  if (loading) return <div className="pt-28 pb-20 text-center text-muted-foreground">加载…</div>;
  if (!movie) return <div className="pt-28 pb-20 text-center text-muted-foreground">未找到该项目。</div>;
  if (!isOwner) return <div className="pt-28 pb-20 text-center text-muted-foreground">仅创建者可管理此项目。</div>;

  return (
    <div className="mx-auto max-w-7xl px-5 lg:px-8 pt-28 pb-20">
      <Link to="/studio" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-copper">
        <ArrowLeft size={15} /> 返回工坊
      </Link>

      <div className="mt-6 flex flex-wrap items-start gap-5 border-b border-border/50 pb-8">
        <div className="h-28 w-20 shrink-0 overflow-hidden rounded border border-border">
          <img src={movie.poster_url} alt="" className="h-full w-full object-cover" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-luxe text-copper/80">项目管理</p>
          <h1 className="mt-1 font-display text-3xl text-foreground">{movie.title}</h1>
          {movie.tagline && <p className="mt-1 font-display italic text-copper/80">“{movie.tagline}”</p>}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Link to={`/movie/${movie.id}`} className="inline-flex items-center gap-1.5 text-sm text-copper hover:underline">
              预览小组页面 <ArrowRight size={14} />
            </Link>
          </div>
        </div>
        <PublishQuickAction movie={movie} onSaved={(u) => setMovie(u)} />
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[360px_1fr]">
        <div className="space-y-6">
        <AiToolPanel movie={movie} onSaved={(updated) => setMovie(updated)} />
        <MovieMetaForm movie={movie} onSaved={(updated) => setMovie(updated)} />
        <VisibilityPanel movie={movie} onSaved={(updated) => setMovie(updated)} />
        <div className="rounded-2xl border border-red-400/15 bg-red-500/[0.03] p-5 text-center">
          <p className="text-[11px] uppercase tracking-luxe text-red-200/60">危险操作</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">删除后不可恢复，会连同该小组的剧集、台词、订阅与讨论一并清理。</p>
          <div className="mt-4">
            <DeleteGroupButton movie={movie} />
          </div>
        </div>
        <form onSubmit={addEpisode} className="rounded-2xl border border-border/60 bg-card p-6 h-fit">
          <h2 className="font-display text-lg text-foreground">添加剧集</h2>
          <div className="mt-4">
            <Field label="集数" value={String(epForm.episode)} onChange={(v) => setEpForm({ ...epForm, episode: v })} type="number" />
          </div>
          <div className="mt-3">
            <Field label="本集标题" value={epForm.title} onChange={(v) => setEpForm({ ...epForm, title: v })} placeholder="例：开篇" />
          </div>
          <div className="mt-3">
            <Textarea label="简介" value={epForm.synopsis} onChange={(v) => setEpForm({ ...epForm, synopsis: v })} placeholder="本集内容概要" />
          </div>
          <button type="submit" disabled={adding} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-copper px-5 py-2.5 text-sm font-medium text-copper-foreground disabled:opacity-50">
            {adding ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} 添加剧集
          </button>
        </form>
        </div>

        <div>
          {draftEps.length > 0 && (
            <section className="mb-6 rounded-2xl border border-sky-400/30 bg-sky-500/5 p-5">
              <p className="flex items-center gap-2 font-display text-base text-foreground"><Pencil size={14} className="text-sky-300" /> 草稿 · {draftEps.length}</p>
              <p className="mt-1 text-xs text-muted-foreground">投稿人正在编辑台词与场景，尚未提交审核。可点击进入剧集页继续完善，编辑完成后由投稿人自行提交审核。</p>
              <div className="mt-4 space-y-3">
                {draftEps.map((ep) => (
                  <div key={ep.id} className="rounded-xl border border-border/60 bg-background-elev/40 p-4">
                    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <Link to={`/episode/${ep.id}?studio=1`} className="font-display text-base text-foreground hover:text-copper">{ep.title}</Link>
                        {ep.synopsis && <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{ep.synopsis}</p>}
                        {ep.proposed_by_name && <p className="mt-1.5 text-[11px] text-copper/70">投稿人 · {ep.proposed_by_name}</p>}
                      </div>
                      <Link to={`/episode/${ep.id}?studio=1`} className="ml-auto shrink-0 text-xs text-copper hover:underline">继续编辑 →</Link>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
          {pendingEps.length > 0 && (
            <section className="mb-6 rounded-2xl border border-copper/30 bg-copper/5 p-5">
              <p className="flex items-center gap-2 font-display text-base text-foreground"><Clock size={14} className="text-copper" /> 待审贡献 · {pendingEps.length}</p>
              <p className="mt-1 text-xs text-muted-foreground">投稿人提交的剧集在审核通过后会进入下方主列表。{user?.role !== "admin" && <span className="text-copper/70">（仅管理员可在此审核）</span>}</p>
              <div className="mt-4 space-y-3">
                {pendingEps.map((ep) => (
                  <div key={ep.id} className="rounded-xl border border-border/60 bg-background-elev/40 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <Link to={`/episode/${ep.id}?studio=1`} className="font-display text-base text-foreground hover:text-copper">{ep.title}</Link>
                        {ep.synopsis && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{ep.synopsis}</p>}
                        {ep.proposed_by_name && <p className="mt-2 text-[11px] text-copper/70">投稿人 · {ep.proposed_by_name}</p>}
                      </div>
                      {user?.role === "admin" ? (
                        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={contribBusyId === ep.id}
                              onClick={() => decideContribution(ep, "approved")}
                              className="inline-flex items-center gap-1 rounded-full bg-copper px-3 py-1.5 text-xs font-medium text-copper-foreground disabled:opacity-50"
                            >
                              {contribBusyId === ep.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} 通过
                            </button>
                            <button
                              type="button"
                              disabled={contribBusyId === ep.id}
                              onClick={() => decideContribution(ep, "rejected")}
                              className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-red-400/40 hover:text-red-200 disabled:opacity-50"
                            >
                              <X size={12} /> 驳回
                            </button>
                          </div>
                          <input
                            value={contribNote[ep.id] || ""}
                            onChange={(e) => setContribNote({ ...contribNote, [ep.id]: e.target.value })}
                            placeholder="驳回备注（可选，展示给投稿人）"
                            className="w-full rounded-lg border border-border bg-background-elev/50 px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-copper/50 focus:outline-none sm:w-72"
                          />
                        </div>
                      ) : (
                        <Link to={`/episode/${ep.id}?studio=1`} className="ml-auto shrink-0 text-xs text-copper hover:underline">查看 →</Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
          <h2 className="font-display text-lg text-foreground">剧集列表 <span className="text-sm font-body text-muted-foreground">· {episodes.length}</span></h2>
          {episodes.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">还没有剧集，从左边添加第一集吧。</div>
          ) : (
            <div className="mt-4 space-y-3">
              {episodes.map((ep, idx) => (
                <div key={ep.id} className="group rounded-xl border border-border/60 bg-background-elev/40 p-4 hover:border-copper/30">
                  <div className="flex items-stretch justify-between gap-3">
                    <Link to={`/episode/${ep.id}?studio=1`} className="flex flex-1 items-center gap-3">
                      <GripVertical size={14} className="shrink-0 text-muted-foreground/40" />
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-xs text-copper/80">E{String(idx + 1).padStart(2, "0")}</p>
                        <p className="mt-1 font-display text-base text-foreground">{ep.title}</p>
                        {ep.synopsis && <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{ep.synopsis}</p>}
                      </div>
                    </Link>
                    <div className="flex shrink-0 items-center gap-2 self-center">
                      <div className="flex flex-col">
                        <button
                          type="button"
                          onClick={() => moveEpisode(idx, "up")}
                          disabled={idx === 0 || moving !== null}
                          className="text-muted-foreground/60 transition-colors hover:text-copper disabled:pointer-events-none disabled:opacity-20"
                          title="上移"
                        >
                          <ChevronUp size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveEpisode(idx, "down")}
                          disabled={idx === episodes.length - 1 || moving !== null}
                          className="text-muted-foreground/60 transition-colors hover:text-copper disabled:pointer-events-none disabled:opacity-20"
                          title="下移"
                        >
                          <ChevronDown size={16} />
                        </button>
                      </div>
                      <Link to={`/episode/${ep.id}?studio=1`} className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-copper opacity-0 transition-opacity group-hover:opacity-100">
                        精读配置 <ArrowRight size={13} />
                      </Link>
                    </div>
                  </div>
                  <InlineEpisodeVideoBinder episode={ep} onSaved={(u) => setEpisodes((list) => list.map((e) => (e.id === u.id ? { ...e, ...u } : e)))} />
                </div>
              ))}
            </div>
          )}
          <div className="mt-6 rounded-xl border border-border/60 bg-background-elev/30 p-5">
            <p className="flex items-center gap-2 text-sm text-foreground"><Film size={15} className="text-copper" /> 视频与场景解析</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">在每集下方直接粘贴 B站 / YouTube 链接即可绑定视频;进入剧集页可添加场景与台词精读。</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-luxe text-muted-foreground">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-1.5 w-full rounded-lg border border-border bg-background-elev/50 px-3 py-2 text-sm text-[#3a2a1a] placeholder:text-[#8a7a6a]/70 focus:border-copper/50 focus:outline-none" />
    </label>
  );
}
function Textarea({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-luxe text-muted-foreground">{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} placeholder={placeholder} className="mt-1.5 w-full resize-none rounded-lg border border-border bg-background-elev/50 px-3 py-2 text-sm text-[#3a2a1a] placeholder:text-[#8a7a6a]/70 focus:border-copper/50 focus:outline-none" />
    </label>
  );
}

// 项目管理处显眼的「发布 / 下架」快捷操作。
// private/rejected → 申请公开（pending）；public/pending 可下架为 private。
// 与下方完整可见性面板互补，让公开发布动作更显眼。
function PublishQuickAction({ movie, onSaved }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const v = movie.visibility || "private";

  const go = async (next) => {
    setBusy(true);
    try {
      const updated = await base44.entities.Movie.update(movie.id, { visibility: next });
      onSaved?.(updated);
      toast({ title: next === "pending" ? "已提交公开申请" : "已下架", description: next === "pending" ? "审核通过后将公开。" : "已设为仅自己可见。" });
    } catch (e) {
      toast({ title: "操作失败", description: e?.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (v === "private" || v === "rejected") {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => go("pending")}
        className="inline-flex items-center gap-2 rounded-full bg-copper px-5 py-2.5 text-sm font-medium text-copper-foreground transition-transform hover:scale-[1.02] disabled:opacity-50"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} 发布小组 · 申请公开
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => go("private")}
      className="inline-flex items-center gap-2 rounded-full border border-border bg-background-elev/50 px-4 py-2.5 text-sm text-foreground transition-colors hover:border-red-400/40 hover:text-red-200 disabled:opacity-50"
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <EyeOff size={14} />} {v === "pending" ? "撤回申请（下架）" : "下架小组"}
    </button>
  );
}