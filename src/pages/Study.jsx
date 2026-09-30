import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Loader2, ArrowLeft, MessagesSquare, Send, Play, ChevronRight, Clock } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import SubtitleCard from '@/components/SubtitleCard';
import SaveVocabDialog from '@/components/SaveVocabDialog';

export default function Study() {
  const { episodeId } = useParams();
  const [episode, setEpisode] = useState(null);
  const [movie, setMovie] = useState(null);
  const [allEpisodes, setAllEpisodes] = useState([]);
  const [scenes, setScenes] = useState([]);
  const [subtitles, setSubtitles] = useState([]);
  const [comments, setComments] = useState([]);
  const [savedIds, setSavedIds] = useState(new Set());
  const [activeScene, setActiveScene] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [posting, setPosting] = useState(false);
  const [user, setUser] = useState(null);
  const [saveSource, setSaveSource] = useState(null);
  const [progress, setProgress] = useState(0); // 0..1
  const studiedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    studiedRef.current = false;
    (async () => {
      try {
        const ep = await base44.entities.Episode.get(episodeId).catch(() => null);
        if (!ep || cancelled) { setLoading(false); return; }
        setEpisode(ep);
        const [mv, eps, scs] = await Promise.all([
          ep.movie_id ? base44.entities.Movie.get(ep.movie_id).catch(() => null) : Promise.resolve(null),
          ep.movie_id ? base44.entities.Episode.filter({ movie_id: ep.movie_id }, 'season', 50).catch(() => []) : Promise.resolve([]),
          base44.entities.Scene.filter({ episode_id: episodeId }, 'sequence', 30).catch(() => []),
        ]);
        eps.sort((a, b) => (a.season - b.season) || (a.episode_number - b.episode_number));
        setMovie(mv); setAllEpisodes(eps); setScenes(scs);
        setActiveScene(scs[0]?.id || null);

        const subs = await base44.entities.Subtitle.filter({ scene_id: scs[0]?.id || '_' }, 'sort_order', 80).catch(() => []);
        setSubtitles(subs);

        const cmts = await base44.entities.Comment.filter({ episode_id: episodeId }, '-created_date', 60).catch(() => []);
        setComments(cmts);

        const me = await base44.auth.me().catch(() => null);
        setUser(me);
        if (me) {
          const myVocab = await base44.entities.Vocabulary.filter({ source_episode_id: episodeId }, undefined, 100).catch(() => []);
          setSavedIds(new Set(myVocab.map(v => v.source_subtitle_id).filter(Boolean)));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [episodeId]);

  // load subtitles when scene changes
  async function selectScene(sceneId) {
    setActiveScene(sceneId);
    const subs = await base44.entities.Subtitle.filter({ scene_id: sceneId }, 'sort_order', 80).catch(() => []);
    setSubtitles(subs);
  }

  async function markStudied() {
    if (studiedRef.current || !user) return;
    studiedRef.current = true;
    try {
      const prev = user.data?.studied_episodes || [];
      if (!prev.includes(episodeId)) {
        const next = [...prev, episodeId];
        await base44.auth.updateMe({ studied_episodes: next });
      }
    } catch {}
  }

  function toggle(subId) {
    setExpanded(e => (e === subId ? null : subId));
    if (!expanded) markStudied();
    setProgress(p => Math.max(p, (subtitles.findIndex(s => s.id === subId) + 1) / Math.max(1, subtitles.length)));
  }

  function openSave(sub) {
    setSaveSource({
      text_en: sub.text_en,
      text_zh: sub.text_zh,
      type: 'sentence',
      movie_id: movie?.id,
      movie_title: movie?.title,
      episode_id: episode?.id,
      subtitle_id: sub.id,
      timestamp: sub.timestamp,
      tags: ['影视表达'],
    });
  }

  async function postComment() {
    if (!commentText.trim()) return;
    setPosting(true);
    try {
      const created = await base44.entities.Comment.create({
        movie_id: movie?.id,
        episode_id: episode?.id,
        scene_id: activeScene,
        content: commentText.trim(),
        author_name: user?.full_name || user?.email || '影迷',
        kind: 'discussion',
      });
      setComments(c => [created, ...c]);
      setCommentText('');
    } finally { setPosting(false); }
  }

  const sceneComments = useMemo(
    () => comments.filter(c => !c.scene_id || c.scene_id === activeScene),
    [comments, activeScene]
  );

  if (loading) return <div className="py-32 grid place-items-center"><Loader2 className="animate-spin text-primary" /></div>;
  if (!episode) return <div className="py-32 text-center text-foreground/50">剧集不存在。</div>;

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-8 py-8">
      <Link to={movie ? `/community/${movie.id}` : '/browse'} className="inline-flex items-center gap-1.5 text-sm text-foreground/55 hover:text-primary mb-6">
        <ArrowLeft size={15} /> {movie?.title || '影视社区'}
      </Link>

      <div className="grid lg:grid-cols-[260px_1fr] gap-8">
        {/* LEFT: episode list */}
        <aside className="lg:sticky lg:top-24 self-start max-h-none lg:max-h-[calc(100vh-7rem)] overflow-auto scrollbar-thin pr-1">
          <p className="font-mono text-[11px] tracking-[0.3em] text-primary/70 uppercase mb-3">剧集</p>
          <div className="space-y-5">
            {groupBySeason(allEpisodes).map(([season, eps]) => (
              <div key={season}>
                <h3 className="font-display text-sm text-foreground/55 mb-2">第 {season} 季</h3>
                <div className="space-y-1">
                  {eps.map(e => {
                    const active = e.id === episodeId;
                    return (
                      <Link key={e.id} to={`/study/${e.id}`}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition
                          ${active ? 'bg-primary/15 text-primary border border-primary/30' : 'text-foreground/65 hover:bg-card/60 hover:text-foreground'}`}>
                        <span className="font-mono text-xs text-foreground/40 w-6">{String(e.episode_number).padStart(2, '0')}</span>
                        <span className="truncate flex-1">{e.title || `第 ${e.episode_number} 集`}</span>
                        {active && <ChevronRight size={14} />}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* MAIN */}
        <div className="min-w-0">
          {/* episode header + progress */}
          <div className="mb-8 stroke-frame rounded-xl bg-card/30 border border-border/40 p-6">
            <p className="font-mono text-[11px] tracking-[0.3em] text-primary/70 uppercase mb-2">
              S{episode.season} · E{episode.episode_number}
            </p>
            <h1 className="font-display text-3xl">{episode.title || `第 ${episode.episode_number} 集`}</h1>
            {episode.synopsis && <p className="mt-3 text-foreground/55 leading-relaxed max-w-2xl">{episode.synopsis}</p>}
            <div className="mt-5">
              <div className="flex items-center justify-between text-xs text-foreground/45 mb-1.5">
                <span>精读进度</span>
                <span>{Math.round(progress * 100)}%</span>
              </div>
              <div className="h-1 rounded-full bg-secondary overflow-hidden">
                <div className="h-full bg-primary transition-all duration-500" style={{ width: `${progress * 100}%` }} />
              </div>
            </div>
          </div>

          {/* scene selector */}
          {scenes.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-6">
              {scenes.map(sc => {
                const active = sc.id === activeScene;
                return (
                  <button key={sc.id} onClick={() => selectScene(sc.id)}
                    className={`px-3.5 py-1.5 rounded-full text-xs border transition
                      ${active ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-foreground/60 hover:text-foreground hover:border-primary/40'}`}>
                    <Clock size={11} className="inline mr-1.5 opacity-70" />
                    {sc.title || `场景 ${sc.sequence}`} · {sc.timestamp_start || ''}
                  </button>
                );
              })}
            </div>
          )}

          {/* subtitles */}
          <div className="space-y-2.5">
            {subtitles.length === 0 ? (
              <div className="py-16 text-center text-foreground/40 border border-dashed border-border/50 rounded-xl">
                本场景暂无字幕内容。
              </div>
            ) : (
              subtitles.map((sub, i) => (
                <div key={sub.id} style={{ animationDelay: `${i * 40}ms` }} className="animate-float-up">
                  <SubtitleCard
                    sub={sub}
                    movieTitle={movie?.title}
                    expanded={expanded === sub.id}
                    onToggle={() => toggle(sub.id)}
                    onSave={() => openSave(sub)}
                    onDiscuss={() => { document.getElementById('discussion')?.scrollIntoView({ behavior: 'smooth' }); }}
                    saved={savedIds.has(sub.id)}
                  />
                </div>
              ))
            )}
          </div>

          {/* DISCUSSION */}
          <section id="discussion" className="mt-12 pt-8 border-t border-border/40">
            <h2 className="font-display text-2xl flex items-center gap-2 mb-5">
              <MessagesSquare size={18} className="text-primary" /> 同好讨论
            </h2>
            <p className="text-sm text-foreground/45 mb-4">
              围绕这一集的片段、时间点与角色，分享你的理解与笔记。
            </p>

            <div className="rounded-xl border border-border/50 bg-card/30 p-4 mb-6">
              <Textarea value={commentText} onChange={e => setCommentText(e.target.value)}
                rows={3} placeholder="这一刻的对白、停顿或情绪，你怎么看？"
                className="bg-background/60 border-border/50 resize-none" />
              <div className="flex justify-between items-center mt-3">
                <span className="text-xs text-foreground/40">绑定到当前场景 · {scenes.find(s => s.id === activeScene)?.title || '—'}</span>
                <Button size="sm" onClick={postComment} disabled={!commentText.trim() || posting}>
                  {posting ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <Send size={14} className="mr-1.5" />}
                  发表
                </Button>
              </div>
            </div>

            <div className="space-y-4">
              {sceneComments.length === 0 ? (
                <p className="text-sm text-foreground/40 py-4">还没有讨论。开启第一句吧。</p>
              ) : sceneComments.map(c => (
                <article key={c.id} className="rounded-xl border border-border/40 bg-card/20 p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-7 h-7 rounded-full bg-secondary border border-border grid place-items-center text-primary text-xs font-display">
                      {(c.author_name || '·')[0].toUpperCase()}
                    </div>
                    <span className="text-sm text-foreground/80">{c.author_name || '匿名影迷'}</span>
                    <span className="text-[11px] text-foreground/35 ml-auto">
                      {new Date(c.created_date).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-sm text-foreground/70 leading-relaxed whitespace-pre-wrap">{c.content}</p>
                </article>
              ))}
            </div>
          </section>
        </div>
      </div>

      <SaveVocabDialog open={!!saveSource} onOpenChange={o => !o && setSaveSource(null)} source={saveSource} />
    </div>
  );
}

function groupBySeason(eps) {
  const map = {};
  eps.forEach(e => { (map[e.season] ||= []).push(e); });
  return Object.entries(map).sort((a, b) => a[0] - b[0]);
}