import React, { useState, useEffect } from 'react';
import { Loader2, Plus, Film, Clapperboard, ArrowRight } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CINE_IMAGES } from '@/lib/cineImages';

export default function Creator() {
  const [user, setUser] = useState(null);
  const [movies, setMovies] = useState([]);
  const [episodes, setEpisodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showMovie, setShowMovie] = useState(false);
  const [showEp, setShowEp] = useState(null);

  // movie form
  const [mf, setMf] = useState({ title: '', title_en: '', synopsis: '', category: 'series', difficulty: 'intermediate', price_monthly: 0, price_yearly: 0 });
  // episode form
  const [ef, setEf] = useState({ season: 1, episode_number: 1, title: '', synopsis: '' });

  useEffect(() => {
    (async () => {
      const me = await base44.auth.me().catch(() => null);
      setUser(me);
      if (me) {
        const all = await base44.entities.Movie.list('-created_date', 50).catch(() => []);
        setMovies(all.filter(m => m.created_by_id === me.id));
      }
      setLoading(false);
    })();
  }, []);

  async function createMovie() {
    if (!mf.title.trim()) return;
    setBusy(true);
    try {
      const created = await base44.entities.Movie.create({
        ...mf,
        title_en: mf.title_en,
        poster_url: CINE_IMAGES[mf.category] || CINE_IMAGES.indie,
        backdrop_url: CINE_IMAGES.heroBackdrop,
        genre: [],
        member_count: 0,
        rating: 0,
      });
      setMovies(m => [created, ...m]);
      setMf({ title: '', title_en: '', synopsis: '', category: 'series', difficulty: 'intermediate', price_monthly: 0, price_yearly: 0 });
      setShowMovie(false);
    } finally { setBusy(false); }
  }

  async function loadEps(movieId) {
    const eps = await base44.entities.Episode.filter({ movie_id: movieId }, 'season', 50).catch(() => []);
    eps.sort((a, b) => (a.season - b.season) || (a.episode_number - b.episode_number));
    setEpisodes(eps);
    setShowEp(movieId);
  }

  async function createEpisode() {
    if (!showEp) return;
    setBusy(true);
    try {
      const created = await base44.entities.Episode.create({
        movie_id: showEp,
        season: Number(ef.season) || 1,
        episode_number: Number(ef.episode_number) || 1,
        title: ef.title,
        synopsis: ef.synopsis,
      });
      setEpisodes(e => [...e, created]);
      setEf({ season: ef.season, episode_number: Number(ef.episode_number) + 1, title: '', synopsis: '' });
    } finally { setBusy(false); }
  }

  if (loading) return <div className="py-32 grid place-items-center"><Loader2 className="animate-spin text-primary" /></div>;

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-24 text-center">
        <Clapperboard size={28} className="text-primary mx-auto mb-4" />
        <h1 className="font-display text-3xl mb-3">创作者后台</h1>
        <p className="text-foreground/55">登录后即可创建你的影视学习社区。</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 sm:px-10 py-12">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10">
        <div>
          <p className="font-mono text-[11px] tracking-[0.3em] text-primary/70 uppercase mb-3">Creator Studio</p>
          <h1 className="font-display text-4xl sm:text-5xl">创作者后台</h1>
          <p className="text-foreground/50 mt-3 max-w-xl">为你拥有合法版权或原创的影视作品建立学习社区，组织剧集与字幕，与同好一起精读。</p>
        </div>
        <Button onClick={() => setShowMovie(s => !s)} className="bg-primary text-primary-foreground hover:brightness-110">
          <Plus size={16} className="mr-1.5" /> 创建社区
        </Button>
      </div>

      {showMovie && (
        <div className="rounded-xl border border-border/60 bg-card/40 p-6 mb-10 stroke-frame">
          <h2 className="font-display text-2xl mb-4">新建影视学习社区</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="影视名称"><Input value={mf.title} onChange={e => setMf({ ...mf, title: e.target.value })} className="bg-background/60 border-border/50" /></Field>
            <Field label="英文名"><Input value={mf.title_en} onChange={e => setMf({ ...mf, title_en: e.target.value })} className="bg-background/60 border-border/50" /></Field>
            <Field label="类型">
              <select value={mf.category} onChange={e => setMf({ ...mf, category: e.target.value })}
                className="bg-background/60 border border-border/50 rounded-md h-10 px-3 w-full text-sm">
                <option value="series">剧集</option>
                <option value="film">电影</option>
                <option value="animation">动画</option>
                <option value="indie">独立电影</option>
              </select>
            </Field>
            <Field label="难度">
              <select value={mf.difficulty} onChange={e => setMf({ ...mf, difficulty: e.target.value })}
                className="bg-background/60 border border-border/50 rounded-md h-10 px-3 w-full text-sm">
                <option value="beginner">入门</option>
                <option value="intermediate">进阶</option>
                <option value="advanced">高阶</option>
              </select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="简介"><Textarea value={mf.synopsis} onChange={e => setMf({ ...mf, synopsis: e.target.value })} rows={3} className="bg-background/60 border-border/50" /></Field>
            </div>
            <Field label="月订阅（¥）"><Input type="number" value={mf.price_monthly} onChange={e => setMf({ ...mf, price_monthly: Number(e.target.value) })} className="bg-background/60 border-border/50" /></Field>
            <Field label="年订阅（¥）"><Input type="number" value={mf.price_yearly} onChange={e => setMf({ ...mf, price_yearly: Number(e.target.value) })} className="bg-background/60 border-border/50" /></Field>
          </div>
          <p className="text-xs text-foreground/40 mt-4">海报将自动套用与作品氛围匹配的电影感封面图。</p>
          <div className="flex gap-2 mt-5">
            <Button onClick={createMovie} disabled={busy || !mf.title.trim()} className="bg-primary text-primary-foreground">
              {busy ? <Loader2 size={15} className="animate-spin mr-1.5" /> : <Plus size={15} className="mr-1.5" />} 创建
            </Button>
            <Button variant="ghost" onClick={() => setShowMovie(false)} className="text-foreground/60">取消</Button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {movies.length === 0 ? (
          <div className="py-16 text-center text-foreground/40 border border-dashed border-border/50 rounded-xl">
            你还没有创建任何社区。点击「创建社区」开始。
          </div>
        ) : movies.map(m => (
          <div key={m.id} className="rounded-xl border border-border/50 bg-card/30 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="font-display text-xl">{m.title}</h3>
                <p className="text-sm text-foreground/45 line-clamp-1 mt-0.5">{m.synopsis}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => loadEps(m.id)} className="border-primary/40 text-primary hover:bg-primary/10">
                <Film size={14} className="mr-1.5" /> 管理剧集
              </Button>
            </div>

            {showEp === m.id && (
              <div className="mt-5 pt-5 border-t border-border/40">
                <div className="grid sm:grid-cols-4 gap-3 mb-3">
                  <Field label="季"><Input type="number" value={ef.season} onChange={e => setEf({ ...ef, season: e.target.value })} className="bg-background/60 border-border/50" /></Field>
                  <Field label="集数"><Input type="number" value={ef.episode_number} onChange={e => setEf({ ...ef, episode_number: e.target.value })} className="bg-background/60 border-border/50" /></Field>
                  <Field label="集名"><Input value={ef.title} onChange={e => setEf({ ...ef, title: e.target.value })} className="bg-background/60 border-border/50 sm:col-span-1" /></Field>
                  <Field label="简介"><Input value={ef.synopsis} onChange={e => setEf({ ...ef, synopsis: e.target.value })} className="bg-background/60 border-border/50" /></Field>
                </div>
                <Button size="sm" onClick={createEpisode} disabled={busy} className="bg-primary text-primary-foreground">
                  <Plus size={14} className="mr-1.5" /> 添加剧集
                </Button>

                <div className="mt-5 space-y-2">
                  {episodes.map(e => (
                    <div key={e.id} className="flex items-center gap-3 text-sm p-3 rounded-lg bg-background/40 border border-border/40">
                      <span className="font-mono text-xs text-foreground/40">S{e.season}·E{e.episode_number}</span>
                      <span className="flex-1 truncate">{e.title || `第 ${e.episode_number} 集`}</span>
                      <a href={`/study/${e.id}`} target="_blank" rel="noreferrer" className="text-primary/70 hover:text-primary inline-flex items-center gap-1 text-xs">
                        精读 <ArrowRight size={12} />
                      </a>
                    </div>
                  ))}
                  {episodes.length === 0 && <p className="text-sm text-foreground/40">尚未添加剧集。</p>}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-widest text-primary/70 mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}