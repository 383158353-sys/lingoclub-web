import React, { useState, useRef, useEffect } from "react";
import { saveVocabularyEntry } from "@/lib/vocabularySources";
import { Plus, Loader2, Bookmark, BookmarkCheck } from "lucide-react";
import { invokeAI } from "@/lib/localApi";
import { safeAIErrorMessage } from "@/lib/aiSettings";
import { useToast } from "@/components/ui/use-toast";
import { normalizeSourceCue } from "@/lib/vocabularySourceCue";

// 包装一段可选中文本;鼠标选中其中的单词/短语时,在选区上方弹出小气泡,
// 点击即可把选中文本加入"我的单词库"(Vocabulary),供后续复习。
// 选区用 window.getSelection 取得,气泡以 fixed 定位贴在选区正上方中心。
export default function SelectionBubble({ text, translation, movieId, movieTitle, sceneId, subtitleId, timestamp, sourceCue, episodeId, episodeTitle, sourceType, sourceUrl, sourceRecordId, className, title, children, selectionMeanings }) {
  const wrapRef = useRef(null);
  const textRef = useRef(null);
  const selectedTextRef = useRef("");
  const [bubble, setBubble] = useState(null);
  const [saving, setSaving] = useState(false);
  const [meaning, setMeaning] = useState({ loading: false, text: "", error: "" });
  const [saved, setSaved] = useState(false);
  const { toast } = useToast();
  const isArticle = ["article", "library_article"].includes(sourceType);

  const onMouseUp = () => {
    setTimeout(() => {
      const sel = window.getSelection && window.getSelection();
      const t = sel ? sel.toString().trim() : "";
      if (selectedTextRef.current) return;
      if (!t || !textRef.current || !sel.anchorNode || !textRef.current.contains(sel.anchorNode) || (!textRef.current.contains(sel.focusNode) && !text?.includes(t)) || sel.rangeCount === 0) {
        setBubble(null); return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) { setBubble(null); return; }
      setBubble({ x: Math.max(150, Math.min(window.innerWidth - 150, rect.left + rect.width / 2)), y: rect.top < 90 ? rect.bottom + 10 : rect.top - 10, below: rect.top < 90, text: t });
    }, 0);
  };

  // 手机长按与拖动选择不一定触发 mouseup，文章阅读也监听原生选区变化。
  useEffect(() => {
    if (!isArticle) return;
    document.addEventListener("selectionchange", onMouseUp);
    return () => document.removeEventListener("selectionchange", onMouseUp);
  }, [sourceType]);

  useEffect(() => {
    if (!isArticle || !bubble?.text) return;
    let active = true;
    setSaved(false);
    const selected = bubble.text;
    const supplied = selectionMeanings?.[selected.toLowerCase()] || (selected === text ? translation : "");
    if (supplied) { setMeaning({ loading: false, text: supplied, error: "" }); return; }
    setMeaning({ loading: true, text: "", error: "" });
    // 等拖选稳定后才查询，复用现有精读接口与响应缓存。
    const timer = setTimeout(() => {
      invokeAI("translate_sentence", { text_en: selected, subtitle_text: selected, context_text: text, movie_title: movieTitle })
        .then((result) => { if (active) setMeaning({ loading: false, text: result?.analysis?.translation || "", error: result?.analysis?.translation ? "" : "未返回译文" }); })
        .catch((error) => { if (active) setMeaning({ loading: false, text: "", error: safeAIErrorMessage(error) }); });
    }, 500);
    return () => { active = false; clearTimeout(timer); };
  }, [bubble?.text, sourceType, text, translation, movieTitle, selectionMeanings]);

  const save = async () => {
    const t = (selectedTextRef.current || bubble?.text || "").trim();
    if (!t) return;
    setSaving(true);
    try {
      const cue = normalizeSourceCue(sourceCue || { id: subtitleId, start: timestamp, textEn: text, textZh: translation });
      await saveVocabularyEntry({
        text_en: t,
        text_zh: isArticle ? meaning.text : "",
        expression_en: t,
        meaning_zh: isArticle ? meaning.text : "",
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
      if (isArticle) setSaved(true);
      else setBubble(null);
    } catch (e) {
      toast({ title: "收藏失败", description: e.message, variant: "destructive" });
    } finally {
      selectedTextRef.current = "";
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
      <div ref={textRef}>{children != null ? children : text}</div>
      {bubble && (
        <div data-bubble style={{ position: "fixed", left: bubble.x, top: bubble.y, transform: bubble.below ? "translate(-50%, 0)" : "translate(-50%, -100%)", zIndex: 70 }}>
          {isArticle ? <div className="w-72 max-w-[calc(100vw-24px)] rounded-xl border border-border bg-card px-4 py-3 text-left shadow-xl" onPointerDown={(event) => { selectedTextRef.current = bubble.text; event.preventDefault(); }}>
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 flex-1 break-words text-sm font-semibold leading-relaxed text-foreground">{bubble.text}</p>
              <button type="button" onClick={save} disabled={saving || saved} className={`inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full border px-3 text-xs ${saved ? "border-mint/40 text-mint" : "border-border text-copper"}`}>
                {saving ? <Loader2 size={12} className="animate-spin" /> : saved ? <BookmarkCheck size={12} /> : <Bookmark size={12} />}{saved ? "已收藏" : "收藏"}
              </button>
            </div>
            {meaning.loading ? <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={12} className="animate-spin" />翻译中…</p> : <p className={`mt-2 text-sm leading-relaxed ${meaning.error ? "text-rose-300" : "text-foreground/90"}`}>{meaning.text || meaning.error}</p>}
          </div> :
          <button
            type="button"
            onPointerDown={(event) => { selectedTextRef.current = bubble.text; event.preventDefault(); }}
            onClick={save}
            disabled={saving}
            className="inline-flex min-h-12 max-w-[calc(100vw-24px)] items-center gap-2 whitespace-nowrap rounded-xl border border-white/15 bg-copper px-5 py-3 text-sm font-medium text-copper-foreground shadow-xl shadow-black/40"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            加入“{bubble.text.length > 14 ? bubble.text.slice(0, 14) + "…" : bubble.text}”
          </button>
          }
        </div>
      )}
    </div>
  );
}

function youtubeIdFromUrl(value) {
  try { const url = new URL(value); return url.hostname.endsWith("youtu.be") ? url.pathname.slice(1).split("/")[0] : url.searchParams.get("v") || ""; } catch { return ""; }
}
