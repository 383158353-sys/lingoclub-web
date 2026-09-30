import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Play, Users, Star, Check, Loader2 } from 'lucide-react';
import Image from '@/components/ui/image';
import { base44 } from '@/api/base44Client';
import { difficultyLabel, difficultyColor, categoryLabel } from '@/lib/srs';

export default function MovieDetail() {
  const { movieId } = useParams();
  const [movie, setMovie] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      base44.entities.Movie.get(movieId).catch(() => null),
      base44.entities.Episode.filter({ movie_id: movieId }, 'season', 50).catch(() => [])
    ]).then(([m, eps]) => {
      setMovie(m);
      // sort by season then episode_number
      eps.sort((a, b) => (a.season - b.season) || (a.episode_number - b.episode_number));
      setEpisodes(eps);
    }).finally(() => setLoading(false));

    base44.auth.me().then(u => {
      if (u?.data?.subscribed?.includes?.(movieId)) setJoined(true);
    }).catch(() => {});
  }, [movieId]);

  async function joinCommunity() {
    setBusy(true);
    try {
      const me = await base44.auth.me();
      const prev = me?.data?.subscribed || [];
      const next = prev.includes(movieId) ? prev : [...prev, movieId];
      await base44.auth.updateMe({ subscribed: next, communities_count: next.length });
      await base44.entities.Movie.update(movieId, { member_count: (movie.member_count || 0) + 1 });
      setJoined(true);
    } catch (e) { /* ignore for public viewers */ }
    setBusy(false);
  }

  if (loading) {
    return <div className="py-32 grid place-items-center"><Loader2 className="animate-spin text-primary" /></div>;
  }
  if (!movie) {
    return <div className="py-32 text-center text-foreground/50">社区未找到。</div>;
  }

  const bySeason = {};
  episodes.forEach(e => { (bySeason[e.season] ||= []).push(e); });

  return (
    <div>
      {/* HERO */}
      <section className="relative">
        <div className="absolute inset-0 h-[58vh]">
          {movie.backdrop_url && (
            <Image src={movie.backdrop_url} alt="" fittingType="fill" className="w-full h-full" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/85 to-background/40" />
        </div>

        <div className="relative mx-auto max-w-7xl px-6 sm:px-10 pt-10">
          <Link to="/browse" className="inline-flex items-center gap-1.5 text-sm text-foreground/55 hover:text-primary mb-8">
            <ArrowLeft size={15} /> 返回社区
          </Link>

          <div className="flex flex-col md:flex-row gap-8 md:gap-10">
            <div className="w-40 sm:w-52 shrink-0 mx-auto md:mx-0">
              <div className="aspect-[3/4] rounded-xl overflow-hidden border border-border/60 stroke-frame">
                {movie.poster_url && <Image src={movie.poster_url} alt={movie.title} fittingType="fill" className="w-full h-full" />}
              </div>
            </div>

            <div className="flex-1 pt-2">
              <p className="font-mono text-[11px] tracking-[0.3em] text-primary/70 uppercase mb-3">
                {categoryLabel(movie.category)} · {movie.year || ''}
              </p>
              <h1 className="font-display text-4xl sm:text-5xl leading-tight text-shadow-cine">{movie.title}</h1>
              {movie.title_en && <p className="text-foreground/45 tracking-[0.15em] mt-2">{movie.title_en}</p>}
              {movie.tagline && <p className="font-display italic text-foreground/70 text-lg mt-4">“{movie.tagline}”</p>}

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-5 text-sm text-foreground/60">
                <span className={difficultyColor(movie.difficulty)}>{difficultyLabel(movie.difficulty)}</span>
                <span className="flex items-center gap-1.5"><Users size={14} /> {(movie.member_count || 0).toLocaleString()} 位成员</span>
                {movie.rating > 0 && <span className="flex items-center gap-1.5 text-primary/80"><Star size={14} /> {movie.rating.toFixed(1)}</span>}
                <span className="flex gap-1.5">{(movie.genre || []).slice(0,3).map(g => (
                  <span key={g} className="text-[11px] px-2 py-0.5 rounded-full border border-border/60">{g}</span>
                ))}</span>
              </div>

              <p className="mt-5 max-w-2xl text-foreground/65 leading-relaxed">{movie.synopsis}</p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                {!joined ? (
                  <button onClick={joinCommunity} disabled={busy}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-primary text-primary-foreground hover:brightness-110 transition disabled:opacity-60">
                    {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                    加入社区
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-2 px-5 py-3 rounded-full border border-primary/40 text-primary">
                    <Check size={16} /> 已加入社区
                  </span>
                )}
                {episodes[0] && (
                  <Link to={`/study/${episodes[0].id}`}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-border text-foreground hover:border-primary hover:text-primary transition">
                    <Play size={15} /> 开始精读
                  </Link>
                )}
              </div>

              <div className="flex gap-3 mt-6 text-xs text-foreground/45">
                <span className="px-3 py-1.5 rounded-lg border border-border/50">月订阅 ¥{movie.price_monthly || 0}</span>
                <span className="px-3 py-1.5 rounded-lg border border-border/50">年订阅 ¥{movie.price_yearly || 0}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* EPISODE LIST */}
      <section className="mx-auto max-w-7xl px-6 sm:px-10 pt-14 pb-12">
        <div className="flex items-end justify-between mb-6">
          <div>
            <p className="font-mono text-[11px] tracking-[0.3em] text-primary/70 uppercase mb-2">剧集目录</p>
            <h2 className="font-display text-3xl">逐集精读</h2>
          </div>
          <p className="text-sm text-foreground/40">共 {episodes.length} 集</p>
        </div>

        {episodes.length === 0 ? (
          <div className="py-16 text-center text-foreground/40 border border-dashed border-border/50 rounded-xl">
            创作者尚未上传剧集内容。
          </div>
        ) : (
          <div className="space-y-10">
            {Object.entries(bySeason).map(([season, eps]) => (
              <div key={season}>
                <h3 className="font-display text-xl text-foreground/80 mb-4 pl-1 flex items-center gap-3">
                  第 {season} 季
                  <span className="h-px flex-1 copper-rule" />
                </h3>
                <div className="grid gap-3">
                  {eps.map((e, i) => (
                    <Link key={e.id} to={`/study/${e.id}`}
                      className="group flex items-center gap-4 p-4 rounded-xl border border-border/40 bg-card/30 hover:border-primary/50 hover:bg-card/50 transition">
                      <span className="font-display text-3xl text-foreground/25 group-hover:text-primary/60 transition w-12 text-center">
                        {String(e.episode_number).padStart(2, '0')}
                      </span>
                      <span className="flex-1 min-w-0">
                        <h4 className="font-display text-lg text-foreground group-hover:text-primary transition truncate">
                          {e.title || `第 ${e.episode_number} 集`}
                        </h4>
                        {e.title_en && <p className="text-xs text-foreground/40">{e.title_en}</p>}
                        {e.synopsis && <p className="text-sm text-foreground/50 mt-1 line-clamp-1">{e.synopsis}</p>}
                      </span>
                      <span className="text-xs text-foreground/40 hidden sm:flex items-center gap-3">
                        {e.duration ? `${Math.round(e.duration / 60)} 分钟` : ''}
                        <span className="flex items-center gap-1 text-primary/70 group-hover:text-primary">
                          <Play size={13} /> 精读
                        </span>
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}