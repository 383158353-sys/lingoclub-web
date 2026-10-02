import React, { useState, useEffect } from 'react';
import { Bookmark, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { vocabTypeLabel } from '@/lib/srs';
import { saveVocabularyEntry } from '@/lib/vocabularySources';

export default function SaveVocabDialog({
  open, onOpenChange,
  source,
}) {
  const [type, setType] = useState('sentence');
  const [textEn, setTextEn] = useState('');
  const [textZh, setTextZh] = useState('');
  const [explanation, setExplanation] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);

  // When opening with a new source, prefill defaults.
  useEffect(() => {
    if (open && source) {
      setType(source.type || 'sentence');
      setTextEn(source.text_en || '');
      setTextZh(source.text_zh || '');
      setExplanation(source.explanation || '');
      setTags(source.tags ? source.tags.join(', ') : '影视表达');
    }
  }, [open, source]);

  async function save() {
    if (!textEn.trim()) return;
    setSaving(true);
    try {
      const cue = source?.sourceCue || source?.source_cue || {};
      await saveVocabularyEntry({
        type,
        expression_en: textEn.trim(),
        text_en: textEn.trim(),
        text_zh: textZh.trim(),
        meaning_zh: textZh.trim(),
        explanation: explanation.trim(),
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        source_movie_id: source?.movie_id,
        source_record_id: source?.source_record_id || source?.movie_id,
        source_movie_title: source?.movie_title,
        source_episode_id: source?.episode_id,
        source_subtitle_id: source?.subtitle_id,
        source_time_start: cue.start ?? source?.source_time_start,
        source_time_end: cue.end ?? source?.source_time_end,
        source_sentence_en: cue.textEn || source?.text_en || textEn.trim(),
        source_sentence_zh: cue.textZh || source?.text_zh || textZh.trim(),
        sourceCue: cue,
        source_url: source?.source_url || "",
        source_type: source?.source_type || "local",
        timestamp: source?.timestamp,
        review_status: 'new',
        review_count: 0,
        ease_factor: 2.5,
        interval_days: 0,
        next_review_date: new Date().toISOString(),
      });
      onOpenChange(false);
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border/60 text-foreground max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl flex items-center gap-2">
            <Bookmark size={18} className="text-primary" /> 收录到我的语料库
          </DialogTitle>
          <DialogDescription className="text-foreground/50">
            把这句话连同你的理解收进个人收藏，稍后可用闪卡复习。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex gap-2">
            {['word', 'phrase', 'sentence'].map(t => (
              <button key={t} onClick={() => setType(t)}
                className={`px-3 py-1.5 rounded-full text-xs border transition
                  ${type === t ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-foreground/60 hover:text-foreground'}`}>
                {vocabTypeLabel(t)}
              </button>
            ))}
          </div>

          <div>
            <label className="text-[11px] uppercase tracking-widest text-primary/70">英文</label>
            <Textarea value={textEn} onChange={e => setTextEn(e.target.value)} rows={2}
              className="mt-1 bg-background/60 border-border/50" />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-widest text-primary/70">中文</label>
            <Textarea value={textZh} onChange={e => setTextZh(e.target.value)} rows={2}
              className="mt-1 bg-background/60 border-border/50" placeholder="翻译或解释…" />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-widest text-primary/70">备注</label>
            <Textarea value={explanation} onChange={e => setExplanation(e.target.value)} rows={2}
              className="mt-1 bg-background/60 border-border/50" placeholder="语境、情绪、文化…" />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-widest text-primary/70">标签（逗号分隔）</label>
            <Input value={tags} onChange={e => setTags(e.target.value)}
              className="mt-1 bg-background/60 border-border/50" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-foreground/60">取消</Button>
          <Button onClick={save} disabled={saving || !textEn.trim()}>
            {saving ? <Loader2 size={15} className="animate-spin mr-1.5" /> : <Bookmark size={15} className="mr-1.5" />}
            收藏
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
