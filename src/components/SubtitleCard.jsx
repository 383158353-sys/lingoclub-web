import React, { useState } from 'react';
import { Sparkles, Bookmark, MessageSquare, Loader2, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { vocabTypeLabel } from '@/lib/srs';

// Speaks the English line using the browser's TTS.
function speak(text) {
  if (!window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.92;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

export default function SubtitleCard({
  sub,
  movieTitle,
  expanded,
  onToggle,
  onSave,
  onDiscuss,
  saved,
}) {
  const a = sub.analysis || {};
  const hasAnalysis = sub.analysis && (a.words?.length || a.phrases?.length || a.grammar || a.culture);
  const [analyzing, setAnalyzing] = useState(false);
  const [liveAnalysis, setLiveAnalysis] = useState(null);
  const [aiError, setAiError] = useState('');

  const display = liveAnalysis || a;

  async function runAi() {
    setAnalyzing(true);
    setAiError('');
    try {
      // Import here to avoid circular import noise; base44 via the pre-initialized sdk.
      const { base44 } = await import('@/api/base44Client');
      const res = await base44.functions.invoke('analyzeSubtitle', {
        text_en: sub.text_en,
        speaker: sub.speaker,
      });
      if (res.data?.analysis) {
        setLiveAnalysis(res.data.analysis);
      } else {
        setAiError(res.data?.error || '解析失败');
      }
    } catch (e) {
      setAiError(e.message || '解析失败');
    } finally {
      setAnalyzing(false);
    }
  }

  function safe(text) {
    return (text || '').replace(/;/g, '');
  }

  return (
    <article
      className={`group relative rounded-xl border transition-colors
        ${expanded ? 'border-primary/40 bg-card/80' : 'border-border/50 bg-card/40 hover:border-border'}`}
    >
      <button onClick={onToggle} className="w-full text-left px-4 sm:px-5 py-4 flex gap-4 items-start">
        <span className="font-mono text-[12px] text-primary/70 tracking-wider pt-1 shrink-0 w-[68px]">
          {sub.timestamp || '—'}
        </span>
        <span className="flex-1 min-w-0">
          {sub.speaker && (
            <span className="text-[11px] uppercase tracking-[0.2em] text-foreground/40">{sub.speaker}</span>
          )}
          <p className="font-display text-lg leading-snug text-foreground">
            {sub.text_en}
          </p>
          {sub.text_zh && (
            <p className="text-sm text-foreground/55 mt-1">{sub.text_zh}</p>
          )}
        </span>
        <span className="flex items-center gap-1.5 shrink-0 opacity-70 group-hover:opacity-100">
          {saved && <Bookmark size={15} className="text-primary fill-primary" />}
        </span>
      </button>

      {expanded && (
        <div className="px-4 sm:px-5 pb-5 pt-1 ml-[84px] space-y-5 animate-float-up">
          {/* quick actions */}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => speak(sub.text_en)} className="text-foreground/70 hover:text-primary">
              <Volume2 size={14} className="mr-1.5" /> 朗读
            </Button>
            <Button size="sm" variant="ghost" onClick={onSave} className="text-foreground/70 hover:text-primary">
              <Bookmark size={14} className="mr-1.5" /> 收藏{saved ? ' ✓' : ''}
            </Button>
            <Button size="sm" variant="ghost" onClick={onDiscuss} className="text-foreground/70 hover:text-primary">
              <MessageSquare size={14} className="mr-1.5" /> 讨论
            </Button>
            <Button size="sm" variant="ghost" onClick={runAi} disabled={analyzing}
              className="text-primary/90 hover:bg-primary/10 ml-auto">
              {analyzing ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Sparkles size={14} className="mr-1.5" />}
              {analyzing ? 'AI 解析中…' : 'AI 深度解析'}
            </Button>
          </div>

          {aiError && <p className="text-xs text-destructive/80">{aiError}</p>}

          {hasAnalysis || liveAnalysis ? (
            <div className="grid sm:grid-cols-2 gap-5 stroke-frame">
              {display.words?.length > 0 && (
                <Section title="单词">
                  <ul className="space-y-1.5">
                    {display.words.map((w, i) => (
                      <li key={i} className="text-sm">
                        <span className="font-medium text-foreground">{w.word}</span>
                        {w.ipa && <span className="font-mono text-[11px] text-primary/60 ml-2">{w.ipa}</span>}
                        <span className="text-foreground/55 ml-1">— {w.meaning_zh}</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              {display.phrases?.length > 0 && (
                <Section title="短语">
                  <ul className="space-y-1.5">
                    {display.phrases.map((p, i) => (
                      <li key={i} className="text-sm">
                        <span className="font-medium text-foreground">{p.phrase}</span>
                        <span className="text-foreground/55 ml-1">— {p.meaning_zh}</span>
                        {p.note && <p className="text-foreground/45 text-xs mt-0.5">{p.note}</p>}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              {display.grammar && <Section title="语法结构"><p className="text-sm text-foreground/65">{display.grammar}</p></Section>}
              {display.emotion && <Section title="角色情绪"><p className="text-sm text-foreground/65">{display.emotion}</p></Section>}
              {display.culture && <Section title="文化语境"><p className="text-sm text-foreground/65">{display.culture}</p></Section>}
              {display.pronunciation && <Section title="发音提示"><p className="text-sm text-foreground/65">{display.pronunciation}</p></Section>}
              {display.extended?.length > 0 && (
                <Section title="扩展表达" className="sm:col-span-2">
                  <ul className="space-y-1.5">
                    {display.extended.map((e, i) => (
                      <li key={i} className="text-sm">
                        <span className="text-foreground">{e.en}</span>
                        <span className="text-foreground/50 ml-2">— {e.zh}</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </div>
          ) : (
            <p className="text-sm text-foreground/45 flex items-center gap-2">
              <Sparkles size={14} className="text-primary/60" /> 点击「AI 深度解析」生成单词、语法、语境与文化解析。
            </p>
          )}

          <p className="text-[11px] text-foreground/35 pt-1">来源 · {movieTitle} {sub.timestamp ? `· ${sub.timestamp}` : ''}</p>
        </div>
      )}
    </article>
  );
}

function Section({ title, children, className = '' }) {
  return (
    <section className={className}>
      <h4 className="text-[11px] uppercase tracking-[0.22em] text-primary/70 mb-2">{title}</h4>
      {children}
    </section>
  );
}