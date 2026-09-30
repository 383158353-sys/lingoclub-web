import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Check, RotateCw, X, Hand } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { isDue, scheduleReview, bumpStudied, vocabTypeLabel } from '@/lib/srs';

export default function Review() {
  const [user, setUser] = useState(null);
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState({ reviewed: 0, mastered: 0 });

  useEffect(() => {
    (async () => {
      const me = await base44.auth.me().catch(() => null);
      setUser(me);
      if (me) {
        const list = await base44.entities.Vocabulary.list('-next_review', 200);
        const due = list.filter(isDue);
        setQueue(due);
      }
      setLoading(false);
    })();
  }, []);

  const card = queue[idx];

  async function rate(quality) {
    if (!card || busy) return;
    setBusy(true);
    const updated = scheduleReview(card, quality);
    try {
      await base44.entities.Vocabulary.update(card.id, updated);
      setStats(s => ({
        reviewed: s.reviewed + 1,
        mastered: s.mastered + (updated.review_status === 'mastered' ? 1 : 0),
      }));
      const prev = user?.data || {};
      const streak = bumpStudied(prev);
      const me = await base44.auth.updateMe(streak).catch(() => null);
      if (me) setUser(m => ({ ...m, ...me }));
    } finally {
      setBusy(false);
      setFlipped(false);
      if (idx + 1 >= queue.length) setDone(true);
      else setIdx(i => i + 1);
    }
  }

  if (loading) return <div className="py-32 grid place-items-center"><Loader2 className="animate-spin text-primary" /></div>;

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-24 text-center">
        <RotateCw size={28} className="text-primary mx-auto mb-4" />
        <h1 className="font-display text-3xl mb-3">登录后开始复习</h1>
        <Link to="/profile" className="inline-flex mt-4 px-6 py-3 rounded-full bg-primary text-primary-foreground">前往个人主页</Link>
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-24 text-center">
        <Check size={30} className="text-primary mx-auto mb-4" />
        <h1 className="font-display text-4xl mb-3">今天的复习已清空</h1>
        <p className="text-foreground/55 mb-6">没有等待复习的表达。去精读新的台词，或回看你的语料库。</p>
        <div className="flex justify-center gap-3">
          <Link to="/browse" className="px-5 py-2.5 rounded-full border border-primary/40 text-foreground hover:bg-primary/5">浏览社区</Link>
          <Link to="/collection" className="px-5 py-2.5 rounded-full bg-primary text-primary-foreground hover:brightness-110">查看语料库</Link>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-24 text-center">
        <p className="font-mono text-[11px] tracking-[0.3em] text-primary/70 uppercase mb-3">Session Complete</p>
        <h1 className="font-display text-5xl mb-6">本期复习完成</h1>
        <div className="flex justify-center gap-6 mb-8">
          <div className="rounded-xl border border-border/50 bg-card/40 px-8 py-4">
            <p className="font-display text-3xl text-primary">{stats.reviewed}</p>
            <p className="text-xs text-foreground/45">复习条目</p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card/40 px-8 py-4">
            <p className="font-display text-3xl text-primary">{stats.mastered}</p>
            <p className="text-xs text-foreground/45">新掌握</p>
          </div>
        </div>
        <Link to="/collection" className="inline-flex px-6 py-3 rounded-full bg-primary text-primary-foreground hover:brightness-110">返回语料库</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-8 py-12">
      <div className="flex items-center justify-between mb-6">
        <p className="font-mono text-[11px] tracking-[0.3em] text-primary/70 uppercase">闪卡复习 · {idx + 1} / {queue.length}</p>
        <Link to="/collection" className="text-sm text-foreground/50 hover:text-primary">退出</Link>
      </div>
      <div className="h-1 rounded-full bg-secondary overflow-hidden mb-10">
        <div className="h-full bg-primary transition-all duration-500" style={{ width: `${(idx / queue.length) * 100}%` }} />
      </div>

      <div
        className="relative min-h-[300px] sm:min-h-[340px] rounded-2xl border border-border/60 bg-card/40 stroke-frame grid place-items-center p-10 cursor-pointer select-none"
        onClick={() => setFlipped(f => !f)}
      >
        <div className="absolute top-4 left-4 text-[11px] uppercase tracking-widest text-primary/60">
          {vocabTypeLabel(card.type)}
        </div>
        <div className="absolute top-4 right-4 text-[11px] text-foreground/40">
          {card.review_count > 0 ? `已复习 ${card.review_count} 次` : '首次复习'}
        </div>

        {!flipped ? (
          <div className="text-center animate-float-up">
            <p className="font-display text-3xl sm:text-4xl leading-snug text-foreground max-w-lg">{card.text_en}</p>
            <p className="mt-8 text-xs text-foreground/40">轻点卡片查看释义</p>
          </div>
        ) : (
          <div className="text-center animate-float-up">
            <p className="font-display text-xl text-foreground/60 mb-3">{card.text_en}</p>
            <p className="font-display text-2xl text-primary mb-4">{card.text_zh}</p>
            {card.explanation && <p className="text-sm text-foreground/55 max-w-md mx-auto leading-relaxed">{card.explanation}</p>}
            {card.source_movie_title && (
              <p className="mt-5 text-[11px] text-foreground/35">
                来源 · {card.source_movie_title} {card.timestamp ? `· ${card.timestamp}` : ''}
              </p>
            )}
          </div>
        )}
      </div>

      {!flipped ? (
        <p className="text-center text-sm text-foreground/40 mt-8">先回忆它的意思，再翻面给评分。</p>
      ) : (
        <div className="grid grid-cols-4 gap-2 mt-8">
          <RateBtn label="忘了" icon={X} tone="destructive" onClick={() => rate(0)} disabled={busy} />
          <RateBtn label="困难" icon={Hand} onClick={() => rate(3)} disabled={busy} />
          <RateBtn label="良好" icon={Check} onClick={() => rate(4)} disabled={busy} />
          <RateBtn label="简单" icon={Check} primary onClick={() => rate(5)} disabled={busy} />
        </div>
      )}
    </div>
  );
}

function RateBtn({ label, icon: Icon, onClick, disabled, primary, tone }) {
  const base = "flex flex-col items-center gap-1 py-3 rounded-xl border text-sm transition disabled:opacity-50";
  const cls = primary
    ? "bg-primary text-primary-foreground border-primary hover:brightness-110"
    : tone === 'destructive'
    ? "border-destructive/50 text-destructive/80 hover:bg-destructive/10"
    : "border-border text-foreground/70 hover:border-primary hover:text-primary";
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${cls}`}>
      <Icon size={16} /> {label}
    </button>
  );
}