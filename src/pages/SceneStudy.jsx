import React, { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Image } from "@/components/ui/image";
import SubtitleAnalysisPanel from "@/components/study/SubtitleAnalysisPanel";
import CommentThread from "@/components/study/CommentThread";
import { ArrowLeft, ArrowRight, Clock, ChevronLeft, ChevronRight } from "lucide-react";

export default function SceneStudy() {
  const { sceneId } = useParams();
  const [scene, setScene] = useState(null);
  const [movie, setMovie] = useState(null);
  const [subtitles, setSubtitles] = useState([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sceneId) return;
    setLoading(true);
    setActive(0);
    (async () => {
      try {
        const sc = await base44.entities.Scene.get(sceneId);
        setScene(sc);
        const [m, subs, allScenes] = await Promise.all([
          base44.entities.Movie.get(sc.movie_id),
          base44.entities.Subtitle.filter({ scene_id: sceneId }, "order", 60),
          base44.entities.Scene.filter({ episode_id: sc.episode_id }, "order", 100),
        ]);
        setMovie(m);
        setSubtitles(subs || []);
        const idx = allScenes.findIndex((s) => s.id === sceneId);
        setScene((prev) => prev && ({ ...prev, _sibling: allScenes, _idx: idx }));
      } finally {
        setLoading(false);
      }
    })();
  }, [sceneId]);

  if (loading) return <div className="pt-28 pb-20 text-center text-muted-foreground">加载场景…</div>;
  if (!scene) return <div className="pt-28 pb-20 text-center text-muted-foreground">未找到该场景。</div>;

  const sub = subtitles[active];

  return (
    <div className="mx-auto max-w-7xl px-5 lg:px-8 pt-24 pb-20">
      <div className="flex items-center justify-between">
        <Link to={movie ? `/movie/${movie.id}` : "/communities"} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-copper">
          <ArrowLeft size={15} /> 返回社区
        </Link>
        <SiblingNav scene={scene} sceneId={sceneId} />
      </div>

      {/* scene header */}
      <div className="mt-5 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="relative aspect-video overflow-hidden rounded-xl border border-border">
          <Image src={movie?.backdrop_url || movie?.poster_url} alt="" fittingType="fill" className="h-full w-full" />
          <div className="absolute inset-0 bg-gradient-to-t from-mahogany via-mahogany/30 to-transparent" />
          <div className="absolute bottom-0 left-0 p-5">
            <span className="font-mono text-xs text-copper/90">{scene.timestamp}</span>
            <h1 className="mt-1 font-display text-2xl text-cream leading-tight">{scene.title}</h1>
            <p className="mt-1 text-xs text-cream/70">{movie?.title}</p>
          </div>
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-6">
          <p className="text-[11px] uppercase tracking-luxe text-copper/70">本场景简析</p>
          <p className="mt-3 text-sm leading-relaxed text-foreground/85">{scene.description}</p>
          {scene.ai_summary && <p className="mt-4 border-l-2 border-copper/30 pl-3 text-sm italic leading-relaxed text-muted-foreground">{scene.ai_summary}</p>}
        </div>
      </div>

      {/* subtitle lines */}
      <div className="mt-14 grid gap-10 lg:grid-cols-[340px_1fr]">
        <aside>
          <h2 className="font-display text-lg text-foreground">台词 <span className="text-sm font-body text-muted-foreground">· {subtitles.length}</span></h2>
          <p className="mt-1 text-xs text-muted-foreground">点击任意一句进入精读</p>
          <ul className="mt-5 space-y-2">
            {subtitles.map((s, i) => (
              <li key={s.id}>
                <button
                  onClick={() => setActive(i)}
                  className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
                    i === active ? "border-copper/50 bg-copper/8" : "border-border/60 hover:border-copper/30 hover:bg-background-elev/40"
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{s.speaker}</span>
                    <span className="font-mono text-copper/80">{s.timestamp}</span>
                  </div>
                  <p className="mt-1 text-sm text-foreground/90 line-clamp-2">{s.text_en}</p>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div>
          {sub ? (
            <>
              <div className="flex items-center gap-3 text-[11px] uppercase tracking-luxe text-copper/70">
                <Clock size={12} /> 精读 {sub.timestamp}
              </div>
              <div className="mt-3 rounded-2xl border border-border/60 bg-card p-7 lg:p-9">
                <SubtitleAnalysisPanel
                  subtitle={sub}
                  movieTitle={movie?.title}
                  movieId={movie?.id}
                  sceneId={sceneId}
                  onSaved={() => {}}
                />
              </div>
              <CommentThread movieId={movie?.id} movieTitle={movie?.title} sceneId={sceneId} timestamp={sub.timestamp} />
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
              本场景尚未录入台词。先把上面的「场景概览」当作你的精读材料吧。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SiblingNav({ scene, sceneId }) {
  if (!scene?._sibling) return null;
  const list = scene._sibling;
  const idx = scene._idx ?? -1;
  const prev = idx > 0 ? list[idx - 1] : null;
  const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;
  return (
    <div className="flex items-center gap-2">
      {prev ? (
        <Link to={`/scene/${prev.id}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-copper">
          <ChevronLeft size={14} /> 上一场景
        </Link>
      ) : <span className="text-xs text-muted-foreground/30"><ChevronLeft size={14} className="inline" /> 上一场景</span>}
      <span className="text-muted-foreground/30">·</span>
      {next ? (
        <Link to={`/scene/${next.id}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-copper">
          下一场景 <ChevronRight size={14} />
        </Link>
      ) : <span className="text-xs text-muted-foreground/30">下一场景 <ChevronRight size={14} className="inline" /></span>}
    </div>
  );
}