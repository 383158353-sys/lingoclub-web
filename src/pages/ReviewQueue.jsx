import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useToast } from "@/components/ui/use-toast";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, X, Loader2, Eye, EyeOff } from "lucide-react";

export default function ReviewQueue() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [note, setNote] = useState({});
  const [publicItems, setPublicItems] = useState([]);
  const [loadingPub, setLoadingPub] = useState(true);
  const [delistingId, setDelistingId] = useState(null);
  const [pendingEps, setPendingEps] = useState([]);
  const [loadingEps, setLoadingEps] = useState(true);
  const [epBusyId, setEpBusyId] = useState(null);
  const [epNote, setEpNote] = useState({});
  const [movies, setMovies] = useState([]);

  const reload = async () => {
    setLoading(true);
    setLoadingPub(true);
    setLoadingEps(true);
    try {
      const all = await base44.entities.Movie.list("-updated_date", 200);
      setMovies(all || []);
      setItems((all || []).filter((m) => m.visibility === "pending"));
      setPublicItems((all || []).filter((m) => m.visibility === "public"));
      const eps = await base44.entities.Episode.filter({ contribution_status: "pending" }, "-updated_date", 200);
      setPendingEps(eps || []);
    } finally {
      setLoading(false);
      setLoadingPub(false);
      setLoadingEps(false);
    }
  };
  useEffect(() => { reload(); }, []);

  if (loading) return <div className="pt-28 pb-20 text-center text-muted-foreground">加载待审项目…</div>;
  if (user?.role !== "admin") {
    return (
      <div className="mx-auto max-w-2xl px-5 pt-32 pb-20 text-center">
        <p className="text-sm text-muted-foreground">该入口仅对管理员开放。</p>
        <button onClick={() => navigate("/studio")} className="mt-4 text-sm text-copper hover:underline">返回创作者工坊</button>
      </div>
    );
  }

  const decide = async (m, approve) => {
    setBusyId(m.id);
    try {
      await base44.entities.Movie.update(m.id, {
        visibility: approve ? "public" : "rejected",
        review_note: note[m.id] || (approve ? "审核通过" : "暂未通过"),
        reviewed_by_id: user?.id,
        reviewed_date: new Date().toISOString(),
      });
      toast({ title: approve ? "已通过，项目进入公开影苑" : `已驳回：${m.title}`, duration: 6000 });
      setItems((xs) => xs.filter((x) => x.id !== m.id));
    } catch (e) {
      toast({ title: "操作失败", description: e.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const delist = async (m) => {
    setDelistingId(m.id);
    try {
      await base44.entities.Movie.update(m.id, {
        visibility: "private",
        review_note: "管理员下架",
        reviewed_by_id: user?.id,
        reviewed_date: new Date().toISOString(),
      });
      toast({ title: "已下架", description: `${m.title} 已从影苑商城撤下。` });
      setPublicItems((xs) => xs.filter((x) => x.id !== m.id));
    } catch (e) {
      toast({ title: "操作失败", description: e.message, variant: "destructive" });
    } finally {
      setDelistingId(null);
    }
  };

  const movieTitle = (id) => (movies.find((m) => m.id === id)?.title) || "（未知小组）";

  const decideEp = async (ep, action) => {
    setEpBusyId(ep.id);
    try {
      await base44.entities.Episode.update(ep.id, {
        contribution_status: action,
        review_note: action === "approved" ? "" : (epNote[ep.id] || ""),
        reviewed_by_id: user?.id,
        reviewed_date: new Date().toISOString(),
      });
      toast({ title: action === "approved" ? "已通过投稿" : "已驳回投稿" });
      setPendingEps((xs) => xs.filter((x) => x.id !== ep.id));
      setEpNote((n) => { const next = { ...n }; delete next[ep.id]; return next; });
    } catch (e) {
      toast({ title: "操作失败", description: e.message, variant: "destructive" });
    } finally {
      setEpBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-5 lg:px-8 pt-28 pb-20">
      <Link to="/studio" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-copper">
        <ArrowLeft size={15} /> 返回工坊
      </Link>
      <header className="mt-6 max-w-2xl">
        <p className="mb-3 text-[11px] uppercase tracking-luxe text-copper/80">Admin · Review</p>
        <h1 className="font-display text-4xl leading-tight text-foreground">公开申请审核</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">创作者申请将项目公开到影苑商城前，需要你确认内容合规与版权。</p>
      </header>

      {items.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          当前没有待审的公开申请。
        </div>
      ) : (
        <div className="mt-8 space-y-4">
          {items.map((m) => (
            <div key={m.id} className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card p-5 sm:flex-row">
              <div className="h-36 w-24 shrink-0 overflow-hidden rounded border border-border">
                <img src={m.poster_url} alt="" className="h-full w-full object-cover" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-[11px] text-copper/80">S{m.year || "—"}</p>
                    <h3 className="mt-1 font-display text-xl text-foreground">{m.title}</h3>
                    {m.title_en && <p className="text-xs italic text-muted-foreground">{m.title_en}</p>}
                    {m.tagline && <p className="mt-1 font-display italic text-copper/80">“{m.tagline}”</p>}
                  </div>
                  <Link to={`/movie/${m.id}`} className="shrink-0 inline-flex items-center gap-1 text-xs text-copper hover:underline">
                    <Eye size={12} /> 预览
                  </Link>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{m.description || "（无简介）"}</p>
                <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="rounded-full border border-border px-2 py-0.5">{m.difficulty}</span>
                  <span className="rounded-full border border-border px-2 py-0.5">{m.price_monthly > 0 ? `¥${m.price_monthly}/月` : "免费"}</span>
                </div>
                <div className="mt-4">
                  <input
                    value={note[m.id] || ""}
                    onChange={(e) => setNote({ ...note, [m.id]: e.target.value })}
                    placeholder={m.review_note || "审核备注（可选，会展示给创作者）"}
                    className="w-full rounded-lg border border-border bg-background-elev/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-copper/50 focus:outline-none"
                  />
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => decide(m, true)}
                    disabled={busyId === m.id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-copper px-4 py-2 text-xs font-medium text-copper-foreground transition-transform hover:scale-[1.02] disabled:opacity-50"
                  >
                    {busyId === m.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} 通过并公开
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(m, false)}
                    disabled={busyId === m.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs text-muted-foreground hover:border-destructive/50 hover:text-destructive disabled:opacity-50"
                  >
                    <X size={12} /> 驳回
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <section className="mt-12">
        <p className="mb-3 text-[11px] uppercase tracking-luxe text-copper/80">Admin · Delist</p>
        <h2 className="font-display text-2xl text-foreground">已公开项目 · 可下架</h2>
        <p className="mt-2 text-sm text-muted-foreground">下架后立即从影苑商城撤下，项目恢复为仅创作者可见（创作者仍可在工坊中重新申请公开）。</p>
        {loadingPub ? (
          <p className="mt-6 text-sm text-muted-foreground">加载已公开项目…</p>
        ) : publicItems.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">当前没有已公开项目。</div>
        ) : (
          <div className="mt-6 space-y-3">
            {publicItems.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card p-4">
                <Link to={`/movie/${m.id}`} className="flex min-w-0 items-center gap-3">
                  {m.poster_url && <img src={m.poster_url} alt="" className="h-12 w-9 shrink-0 rounded border border-border object-cover" />}
                  <div className="min-w-0">
                    <h3 className="truncate font-display text-base text-foreground hover:text-copper">{m.title}</h3>
                    <p className="text-[11px] text-muted-foreground">{m.price_monthly > 0 ? `¥${m.price_monthly}/月` : "免费"} · {m.member_count || 0} 成员</p>
                  </div>
                </Link>
                <button
                  type="button"
                  disabled={delistingId === m.id}
                  onClick={() => delist(m)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-red-400/40 hover:text-red-200 disabled:opacity-50"
                >
                  {delistingId === m.id ? <Loader2 size={12} className="animate-spin" /> : <EyeOff size={12} />} 下架
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-12">
        <p className="mb-3 text-[11px] uppercase tracking-luxe text-copper/80">Admin · Episodes</p>
        <h2 className="font-display text-2xl text-foreground">影视投稿审核</h2>
        <p className="mt-2 text-sm text-muted-foreground">用户向各小组投稿的剧集在这里统一审核。通过后将在该小组的剧集列表公开；驳回可附上备注展示给投稿人，便于修改后重新提交。</p>
        {loadingEps ? (
          <p className="mt-6 text-sm text-muted-foreground">加载剧集投稿…</p>
        ) : pendingEps.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">当前没有待审的影视剧集投稿。</div>
        ) : (
          <div className="mt-6 space-y-3">
            {pendingEps.map((ep) => (
              <div key={ep.id} className="rounded-2xl border border-border/60 bg-card p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-muted-foreground">
                      小组 · <Link to={`/movie/${ep.movie_id}`} className="text-copper hover:underline">{movieTitle(ep.movie_id)}</Link>
                    </p>
                    <Link to={`/episode/${ep.id}`} className="font-display text-base text-foreground hover:text-copper">{ep.title}</Link>
                    {ep.synopsis && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{ep.synopsis}</p>}
                    {ep.proposed_by_name && <p className="mt-2 text-[11px] text-copper/70">投稿人 · {ep.proposed_by_name}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={epBusyId === ep.id}
                        onClick={() => decideEp(ep, "approved")}
                        className="inline-flex items-center gap-1 rounded-full bg-copper px-3 py-1.5 text-xs font-medium text-copper-foreground disabled:opacity-50"
                      >
                        {epBusyId === ep.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} 通过
                      </button>
                      <button
                        type="button"
                        disabled={epBusyId === ep.id}
                        onClick={() => decideEp(ep, "rejected")}
                        className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-red-400/40 hover:text-red-200 disabled:opacity-50"
                      >
                        <X size={12} /> 驳回
                      </button>
                    </div>
                    <input
                      value={epNote[ep.id] || ""}
                      onChange={(e) => setEpNote({ ...epNote, [ep.id]: e.target.value })}
                      placeholder="驳回备注（可选，展示给投稿人）"
                      className="w-full rounded-lg border border-border bg-background-elev/50 px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-copper/50 focus:outline-none sm:w-72"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}