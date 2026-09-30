import React, { useState, useEffect, useMemo } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import MovieCard from '@/components/MovieCard';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const DIFFS = [
  { key: 'all', label: '全部难度' },
  { key: 'beginner', label: '入门' },
  { key: 'intermediate', label: '进阶' },
  { key: 'advanced', label: '高阶' },
];
const CATS = [
  { key: 'all', label: '全部类型' },
  { key: 'series', label: '剧集' },
  { key: 'film', label: '电影' },
  { key: 'animation', label: '动画' },
  { key: 'indie', label: '独立电影' },
];

export default function Browse() {
  const [movies, setMovies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [diff, setDiff] = useState('all');
  const [cat, setCat] = useState('all');

  useEffect(() => {
    base44.entities.Movie.list('-member_count', 50)
      .then(setMovies)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    return movies.filter(m => {
      if (diff !== 'all' && m.difficulty !== diff) return false;
      if (cat !== 'all' && m.category !== cat) return false;
      if (q) {
        const s = (m.title + m.title_en + m.synopsis).toLowerCase();
        if (!s.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [movies, diff, cat, q]);

  return (
    <div className="mx-auto max-w-7xl px-6 sm:px-10 py-12">
      <div className="mb-10">
        <p className="font-mono text-[11px] tracking-[0.3em] text-primary/70 uppercase mb-3">Community Marketplace</p>
        <h1 className="font-display text-4xl sm:text-5xl">影视学习社区</h1>
        <p className="mt-3 text-foreground/55 max-w-2xl">
          浏览由创作者与同好构建的影视精读社区。每一个社区都是一扇通往某种说话方式的门。
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-10">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground/40" />
          <Input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="搜索影视、关键词…"
            className="pl-10 bg-card/50 border-border/50"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <SlidersHorizontal size={15} className="text-foreground/40" />
          {DIFFS.map(d => (
            <Button key={d.key} size="sm" variant={diff === d.key ? 'default' : 'ghost'}
              onClick={() => setDiff(d.key)}
              className={diff === d.key ? '' : 'text-foreground/60 hover:text-foreground'}>
              {d.label}
            </Button>
          ))}
          <span className="w-px h-5 bg-border/60 mx-1" />
          {CATS.map(c => (
            <Button key={c.key} size="sm" variant={cat === c.key ? 'default' : 'ghost'}
              onClick={() => setCat(c.key)}
              className={cat === c.key ? '' : 'text-foreground/60 hover:text-foreground'}>
              {c.label}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-[3/4] rounded-xl bg-card/50 border border-border/40 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-24 text-center text-foreground/40">
          没有找到匹配的社区。换个关键词试试。
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
          {filtered.map((m, i) => (
            <MovieCard key={m.id} movie={m} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}