import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { Image } from "@/components/ui/image";
import DifficultyBadge from "@/components/common/DifficultyBadge";
import { Users, ArrowRight, ArrowLeft, CheckCircle2, Lock, Clapperboard, Clock, LogOut, Loader2, Check, X, Send, Pencil, ShieldCheck, Crown, Wallet, Play, Bookmark } from "lucide-react";
import AddVideoToGroup from "@/components/movie/AddVideoToGroup";

const k = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n));

// 从视频 URL 提取缩略图：YouTube 有官方缩略图，B站/其他回退到小组海报
function getEpisodeThumb(ep, movie) {
  const url = ep.video_url || "";
  const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) return `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg`;
  return movie?.poster_url || "";
}

export default function MovieCommunity() {
  const { movieId } = useParams();
  const navigate = useNavigate();
  const [movie, setMovie] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [joined, setJoined] = useState(false);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [me, setMe] = useState(null);
  const [rechargeInfo, setRechargeInfo] = useState(null);
  const { user } = useAuth();
  const requireAuth = useRequireAuth();

  useEffect(() => {
    if (!movieId) return;
    setLoading(true);
    (async () => {
      try {
        const m = await base44.entities.Movie.get(movieId);
        setMovie(m);
        const eps = await base44.entities.Episode.filter({ movie_id: movieId }, "order", 100);
        const allEps = (eps || []);
        setEpisodes(allEps.filter((e) => e.contribution_status === "approved" || e.contribution_status === undefined || e.contribution_status === null));
        const subs = await base44.entities.Subscription.filter({ movie_id: movieId, status: "active" }, null, 1).catch(() => []);
        setJoined((subs || []).length > 0);
        setMe(await base44.auth.me().catch(() => null));
      } finally {
        setLoading(false);
      }
    })();
  }, [movieId]);

  const reloadEpisodes = useCallback(async () => {
    const eps = await base44.entities.Episode.filter({ movie_id: movieId }, "order", 100);
    setEpisodes((eps || []).filter((e) => e.contribution_status === "approved" || e.contribution_status === undefined || e.contribution_status === null));
  }, [movieId]);

  // 加入：所有积分/会员结算走后端 joinGroup，前端不碰金额。
  // 积分不足时后端返回 402 + 充值信息，这里弹充值引导；其他错误也通过同弹窗提示。
  const join = async () => {
    if (!requireAuth()) return;
    setJoining(true);
    try {
      await base44.functions.invoke("joinGroup", { movie_id: movieId });
      setJoined(true);
      setMe(await base44.auth.me().catch(() => null));
    } catch (e) {
      const data = e?.response?.data || {};
      if (data.code === "INSUFFICIENT_CREDITS") {
        setRechargeInfo({ required: data.required, balance: data.balance, movie_title: data.movie_title || movie?.title });
      } else {
        setRechargeInfo({ error: data.error || e?.message || "加入失败，请稍后重试" });
      }
    } finally {
      setJoining(false);
    }
  };

  // 退出小组：把订阅记录置为 cancelled，该小组便从「个人订阅」消失。
  // 之后再点击「加入小组」会重新激活同一记录。
  const leave = async () => {
    setJoining(true);
    try {
      const existing = await base44.entities.Subscription.filter({ movie_id: movieId }, null, 10);
      const active = (existing || []).find((s) => s.status === "active") || (existing || [])[0];
      if (active) await base44.entities.Subscription.update(active.id, { status: "cancelled" });
      setJoined(false);
    } finally {
      setJoining(false);
    }
  };

  if (loading) return <div className="pt-28 pb-20 text-center text-muted-foreground">加载小组…</div>;
  if (!movie) return <div className="pt-28 pb-20 text-center text-muted-foreground">未找到该影视小组。</div>;
  const isMovieOwner = movie.created_by_id === user?.id || user?.role === "admin";
  const isPremium = me?.premium_expires_at && new Date(me.premium_expires_at) > new Date();
  const myCredits = Number(me?.credits ?? 0);



  return (
    <div className="relative">
      {/* banner */}
      <section className="relative h-[44vh] min-h-[320px] overflow-hidden">
        <Image src={movie.backdrop_url || movie.poster_url} alt="" fittingType="fill" className="h-full w-full animate-ken-burns" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-mahogany/40" />
        <div className="grain" />
      </section>

      <div className="relative z-10 mx-auto max-w-7xl px-5 lg:px-8 -mt-24">
        <div>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <DifficultyBadge level={movie.difficulty} />
              {movie.year && <span className="text-xs text-muted-foreground">{movie.year}</span>}
              <span className="flex items-center gap-1 text-xs text-muted-foreground"><Users size={12} className="text-copper/70" /> {k(movie.member_count)} 收藏</span>
              {movie.genre?.map((g) => <span key={g} className="rounded-full bg-background-elev px-2.5 py-0.5 text-[11px] text-muted-foreground">{g}</span>)}
            </div>
            <h1 className="mt-3 font-display text-4xl leading-tight text-foreground md:text-5xl">{movie.title}</h1>
            {movie.tagline && <p className="mt-2 font-display text-lg italic text-copper/80">“{movie.tagline}”</p>}
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">{movie.description}</p>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              {joined ? (
                <>
                  <button onClick={() => episodes[0] && navigate(`/episode/${episodes[0].id}`)} className="inline-flex items-center gap-2 rounded-full bg-copper px-6 py-3 text-sm font-medium text-copper-foreground transition-transform hover:scale-[1.02]">
                    <Clapperboard size={16} /> 继续学习
                  </button>
                  <span className="inline-flex items-center gap-1.5 text-sm text-copper"><CheckCircle2 size={15} /> 已收藏</span>
                  <button
                    onClick={leave}
                    disabled={joining}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs text-muted-foreground transition-colors hover:border-red-400/40 hover:text-red-200 disabled:opacity-50"
                  >
                    {joining ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />} 取消收藏
                  </button>
                </>
              ) : (
                <button onClick={join} disabled={joining} className="inline-flex items-center gap-2 rounded-full bg-copper px-6 py-3 text-sm font-medium text-copper-foreground transition-transform hover:scale-[1.02] disabled:opacity-50">
                  {joining ? <Loader2 size={16} className="animate-spin" /> : <Bookmark size={16} />} 收藏视频单 <ArrowRight size={16} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 视频单 */}
        <div className="mt-10">
          <div className="flex items-center gap-6 border-b border-border/50 pb-6">
            <div className="flex items-baseline gap-1.5">
              <span className="font-display text-2xl text-copper">{episodes.length}</span>
              <span className="text-xs text-muted-foreground">个视频</span>
            </div>
            <div className="h-6 w-px bg-border/50" />
            <div className="flex items-baseline gap-1.5">
              <span className="font-display text-2xl text-copper">{k(movie.member_count)}</span>
              <span className="text-xs text-muted-foreground">人收藏</span>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <h2 className="font-display text-lg text-foreground">视频单 <span className="text-sm font-body text-muted-foreground">· {episodes.length}</span></h2>
            <AddVideoToGroup movieId={movieId} isOwner={isMovieOwner} onAdded={reloadEpisodes} />
          </div>
          {episodes.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">还没有视频。</div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {episodes.map((ep, idx) => {
                const thumb = getEpisodeThumb(ep, movie);
                return (
                  <Link key={ep.id} to={`/episode/${ep.id}`} className="group rounded-xl border border-border/60 bg-background-elev/40 overflow-hidden transition-colors hover:border-copper/40 hover:bg-copper/5">
                    <div className="relative aspect-video overflow-hidden bg-background-elev">
                      {thumb ? (
                        <Image src={thumb} alt="" fittingType="fill" className="h-full w-full transition-transform duration-500 group-hover:scale-105" />
                      ) : (
                        <div className="flex h-full items-center justify-center"><Clapperboard size={28} className="text-muted-foreground/40" /></div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                      <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white">E{String(ep.episode_number || idx + 1).padStart(2, "0")}</span>
                      {!joined && <span className="absolute right-2 top-2 rounded-full bg-copper/80 px-2 py-0.5 text-[10px] font-medium text-copper-foreground">预览</span>}
                      <span className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-copper/90 text-copper-foreground opacity-0 transition-opacity group-hover:opacity-100">
                        <Play size={15} className="ml-0.5" />
                      </span>
                    </div>
                    <div className="p-3">
                      <p className="truncate text-sm font-medium text-foreground">{ep.title}</p>
                      {ep.synopsis && <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{ep.synopsis}</p>}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {rechargeInfo && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <div className="w-full max-w-md rounded-2xl border border-copper/40 bg-card p-6 text-center">
                <p className="font-display text-xl text-foreground">{rechargeInfo.error ? "加入失败" : "积分不足"}</p>
                {rechargeInfo.error ? (
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{rechargeInfo.error}</p>
                ) : (
                  <>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      加入「{rechargeInfo.movie_title}」需要 <span className="text-foreground">{rechargeInfo.required} 积分</span>，当前余额 <span className="text-copper">{rechargeInfo.balance} 积分</span>。
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">充值积分或开通高级会员后即可加入。</p>
                    <div className="mt-5 flex justify-center gap-3">
                      <Link to="/buy-credits" className="inline-flex items-center gap-1.5 rounded-full bg-copper px-5 py-2.5 text-sm font-medium text-copper-foreground transition-transform hover:scale-[1.02]">
                        去充值 / 开通会员 <ArrowRight size={14} />
                      </Link>
                    </div>
                  </>
                )}
                <button type="button" onClick={() => setRechargeInfo(null)} className="mt-4 text-xs text-muted-foreground hover:text-foreground">关闭</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}