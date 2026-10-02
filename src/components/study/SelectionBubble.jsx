import React, { useState, useRef, useEffect } from "react";
import { saveVocabularyEntry } from "@/lib/vocabularySources";
import { Plus, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { normalizeSourceCue } from "@/lib/vocabularySourceCue";

// 包装一段可选中文本;鼠标选中其中的单词/短语时,在选区上方弹出小气泡,
// 点击即可把选中文本加入"我的单词库"(Vocabulary),供后续复习。
// 选区用 window.getSelection 取得,气泡以 fixed 定位贴在选区正上方中心。
export default function SelectionBubble({ text, translation, movieId, movieTitle, sceneId, subtitleId, timestamp, sourceCue, episodeId, episodeTitle, sourceType, sourceUrl, sourceRecordId, className, title, children }) {
  const wrapRef = useRef(null);
  const [bubble, setBubble] = useState(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const onMouseUp = () => {
    setTimeout(() => {
      const sel = window.getSelection && window.getSelection();
      const t = sel ? sel.toString().trim() : "";
      if (!t || !wrapRef.current || !sel.anchorNode || !wrapRef.current.contains(sel.anchorNode) || sel.rangeCount === 0) {
        setBubble(null); return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) { setBubble(null); return; }
      setBubble({ x: rect.left + rect.width / 2, y: rect.top, text: t });
    }, 0);
  };

  const save = async () => {
    const t = (bubble?.text || "").trim();
    if (!t) return;
    setSaving(true);
    try {
      const cue = normalizeSourceCue(sourceCue || { id: subtitleId, start: timestamp, textEn: text, textZh: translation });
      await saveVocabularyEntry({
        text_en: t,
        text_zh: "",
        expression_en: t,
        meaning_zh: "",
        type: t.indexOf(" ") >= 0 ? (t.split(/\s+/).length > 4 ? "sentence" : "phrase") : "word",
        tag: "划词",
        tags: ["划词"],
        source_movie_id: movieId,
        source_record_id: sourceRecordId || movieId,
        source_url: sourceUrl || "",
        source_video_id: youtubeIdFromUrl(sourceUrl),
        source_movie_title: movieTitle,
        source_scene_id: sceneId,
        source_subtitle_id: cue.id || subtitleId,
        source_episode_id: episodeId,
        source_episode_title: episodeTitle,
        source_sentence_en: cue.textEn || text,
        source_sentence_zh: cue.textZh || translation || "",
        source_time_start: cue.start,
        source_time_end: cue.end,
        source_timestamp_seconds: cue.start,
        source_timestamp_end_seconds: cue.end,
        source_type: sourceType,
        source_timestamp_text: cue.start ?? timestamp ?? "",
        timestamp: timestamp || "",
        mastery_level: "new",
        review_count: 0,
        correct_count: 0,
        ease_factor: 2.5,
        interval_days: 0,
      });
      toast({ title: "已加入我的单词库", description: t });
      try { window.getSelection().removeAllRanges(); } catch { /* noop */ }
      setBubble(null);
    } catch (e) {
      toast({ title: "收藏失败", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // 气泡出现后,点击别处或滚动/缩放即隐藏;点气泡自身不隐藏(由保存处理)。
  useEffect(() => {
    if (!bubble) return;
    const hide = () => setBubble(null);
    const onDown = (e) => { if (!e.target.closest || !e.target.closest("[data-bubble]")) hide(); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [bubble]);

  return (
    <div ref={wrapRef} onMouseUp={onMouseUp} className={className} title={title} style={{ position: "relative" }}>
      {children != null ? children : text}
      {bubble && (
        <div data-bubble style={{ position: "fixed", left: bubble.x, top: bubble.y, transform: "translate(-50%, -100%)", zIndex: 60 }}>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-copper px-3 py-1.5 text-xs font-medium text-copper-foreground shadow-lg shadow-copper/20"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            加入“{bubble.text.length > 14 ? bubble.text.slice(0, 14) + "…" : bubble.text}”
          </button>
        </div>
      )}
    </div>
  );
}

function youtubeIdFromUrl(value) {
  try { const url = new URL(value); return url.hostname.endsWith("youtu.be") ? url.pathname.slice(1).split("/")[0] : url.searchParams.get("v") || ""; } catch { return ""; }
}
