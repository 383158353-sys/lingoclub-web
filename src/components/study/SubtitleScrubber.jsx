import React, { useState, useEffect, useRef, useCallback } from "react";
import { Loader2, Pencil, Check, X, BookOpen, Repeat, ArrowUp, Languages } from "lucide-react";

import { toSec } from "@/lib/timecode";
import SubtitleWordLookup from "@/components/study/SubtitleWordLookup";
import { getCueContext, resolveSubtitleTranslationState, subtitleHash } from "@/lib/subtitleAiProcessing";

// Subtitle list shown under the video. Bi-directional sync:
//   · Click subtitle row → video seeks to that timestamp (via onLineClick)
//   · Video plays / scrubbed → activeId updates → list auto-scrolls to keep active line visible
//
// Auto-follow has two modes:
//   · followOn = true  (default): pin active line to TOP of viewport on every activeId change
//   · followOn = false (user scrolled away): soft-follow — only scroll when active line
//     goes completely out of view, respecting user's scroll position
// "回到当前台词" button re-engages followOn = true and smooth-scrolls back.
//
// Key anti-feedback design: the scroll event listener ONLY sets followOn=false.
// It does NOT check visibility or trigger scrolls. All scrolling happens in the
// activeId useEffect, guarded by programmaticRef so our own scrolls don't
// trigger the listener.
export default function SubtitleScrubber({ study, movieId, movieTitle, episodeId, episodeTitle, sourceType, sourceUrl, sourceRecordId, videoId = movieId, editable, listHeight, focusRequest }) {
  const { loading, subs, activeId, analyzingId, hasAnyTs, onLineClick, onStudyClick, loopingId, updateSub, processingStatus = {} } = study;
  const listRef = useRef(null);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({ time_start: "", time_end: "", text_en: "", text_zh: "" });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editErr, setEditErr] = useState("");
  const processingHash = subtitleHash(subs);
  const failedTranslationIds = new Set(processingStatus.failedCueIds || []);

  // --- Auto-follow state ---
  const followOnRef = useRef(true);       // true = pin-to-top; false = soft-follow (user scrolled)
  const [followOff, setFollowOff] = useState(false); // mirror of followOnRef for UI (show button)
  const [showChinese, setShowChinese] = useState(() => {
    try { return localStorage.getItem("lingoclub:subtitle-list-show-chinese") !== "false"; } catch { return true; }
  });
  const programmaticRef = useRef(false);   // true while we're scrolling via scrollTo (suppress user-scroll detection)
  const scrollTimerRef = useRef(null);

  const startEdit = (s) => {
    setEditErr("");
    setDraft({ time_start: s.time_start || "", time_end: s.time_end || "", text_en: s.text_en || "", text_zh: s.text_zh || "" });
    setEditingId(s.id);
  };
  const cancelEdit = () => { setEditingId(null); setEditErr(""); };
  const saveEdit = async (s) => {
    if (!draft.text_en.trim()) { setEditErr("请输入英文台词"); return; }
    const start = toSec(draft.time_start);
    if (draft.time_start && Number.isNaN(start)) { setEditErr("开始时间格式应为 MM:SS"); return; }
    if (draft.time_end && Number.isNaN(toSec(draft.time_end))) { setEditErr("结束时间格式不正确"); return; }
    setSavingEdit(true);
    try {
      await updateSub(s.id, {
        time_start: draft.time_start,
        time_end: draft.time_end,
        text_en: draft.text_en,
        text_zh: draft.text_zh,
        order: Number.isNaN(start) ? s.order : Math.floor(start),
        timestamp: draft.time_start,
      });
      setEditingId(null);
    } catch (e) {
      setEditErr(e?.message || "保存失败");
    } finally {
      setSavingEdit(false);
    }
  };

  // Helper: programmatic scroll that suppresses the user-scroll detector
  const scrollToEl = useCallback((el, { smooth = false, forceTop = false }) => {
    const container = listRef.current;
    if (!container || !el) return;
    const padTop = 12; // p-3 top padding
    const elRect = el.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();

    if (forceTop || followOnRef.current) {
      // Pin to top: always scroll so active line sits at the top
      const delta = elRect.top - cRect.top - padTop;
      if (Math.abs(delta) < 8) return;
      programmaticRef.current = true;
      container.scrollTo({ top: Math.max(0, container.scrollTop + delta), behavior: smooth ? "smooth" : "auto" });
    } else {
      // 用户已手动滚动：完全不干预滚动位置，直到点击「回到当前台词」
      return;
    }

    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    // Reset programmatic flag quickly after instant scroll so user scroll detection stays responsive
    scrollTimerRef.current = setTimeout(() => { programmaticRef.current = false; }, smooth ? 400 : 80);
  }, []);

  // Auto-scroll on activeId change (video progressed or user scrubbed to a new line)
  useEffect(() => {
    if (!activeId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-sub-id="${activeId}"]`);
    if (!el) return;
    scrollToEl(el, { forceTop: false });
  }, [activeId, subs, scrollToEl]);

  // User scroll detection: any scroll NOT caused by our own scrollTo → user scrolled → disable pin-to-top
  // Re-attach when subs load (list isn't rendered until subs are available)
  useEffect(() => {
    if (subs.length === 0) return;
    const container = listRef.current;
    if (!container) return;
    const onScroll = () => {
      if (programmaticRef.current) return; // our own scroll, ignore
      if (followOnRef.current) {
        followOnRef.current = false;
        setFollowOff(true);
      }
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [subs.length]);

  // Cleanup timer on unmount
  useEffect(() => () => { if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current); }, []);

  const focusActiveTranscriptCue = useCallback((cueId, { smooth = false } = {}) => {
    if (!cueId || !listRef.current) return;
    followOnRef.current = true;
    setFollowOff(false);
    const el = listRef.current.querySelector(`[data-sub-id="${cueId}"]`);
    if (el) scrollToEl(el, { smooth, forceTop: true });
  }, [scrollToEl]);

  // "回到当前台词": same list-only top alignment used by keyboard shortcuts.
  const backToCurrent = useCallback(() => {
    focusActiveTranscriptCue(activeId, { smooth: true });
  }, [activeId, focusActiveTranscriptCue]);

  // Keyboard focus requests are explicit even when the active cue did not change.
  // This uses the same list-only top alignment as the existing return-to-current control.
  useEffect(() => {
    if (!focusRequest?.cueId || focusRequest.requestId == null) return;
    focusActiveTranscriptCue(focusRequest.cueId);
  }, [focusRequest?.cueId, focusRequest?.requestId, subs, focusActiveTranscriptCue]);

  if (loading) return <p className="text-sm text-muted-foreground">加载台词…</p>;
  if (subs.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-background-elev/30 p-10 text-center text-sm text-muted-foreground">
        本集还没有台词。创作者请在下方「台词管理」逐条添加带时间戳的台词。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!hasAnyTs && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200/90">
          本集台词均无时间戳，点击不会跳转、播放也不会自动跟随。请在下方「批量导入」中粘贴带时间码的文本——支持 <span className="font-mono">SRT/WebVTT</span>，也支持「时间码独占一行、下一行为英文台词」的格式（如 <span className="font-mono">01:04</span> 换行后写句子），导入时会自动为每一句生成可跳转的时间戳；或在「台词管理」中逐句补填开始时间。
        </div>
      )}
      <div className="relative">
        <div ref={listRef} style={listHeight ? { height: listHeight } : undefined} className={`scrollbar-none ${listHeight ? "" : "h-64"} overflow-y-auto rounded-xl border border-border bg-background p-3`}>
          <ul className="space-y-2">
            {subs.map((s) => {
              const isActive = s.id === activeId;
              const isEditing = editingId === s.id;
              const translationState = resolveSubtitleTranslationState(s, processingStatus.phase, failedTranslationIds);
              const cueContext = getCueContext(subs, s.id, 4);
              return (
                <li key={s.id} data-sub-id={s.id}>
                  {isEditing ? (
                    <div className="rounded-md border border-copper/40 bg-background-elev/40 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <input value={draft.time_start} onChange={(e) => setDraft((d) => ({ ...d, time_start: e.target.value }))} placeholder="开始 MM:SS" className="w-24 rounded-lg border border-border bg-background px-2 py-1 font-mono text-xs text-foreground focus:border-copper/50 focus:outline-none" />
                        <input value={draft.time_end} onChange={(e) => setDraft((d) => ({ ...d, time_end: e.target.value }))} placeholder="结束 MM:SS" className="w-24 rounded-lg border border-border bg-background px-2 py-1 font-mono text-xs text-foreground focus:border-copper/50 focus:outline-none" />
                        {editErr && <span className="text-xs text-rose-300">{editErr}</span>}
                      </div>
                      <input value={draft.text_en} onChange={(e) => setDraft((d) => ({ ...d, text_en: e.target.value }))} placeholder="英文台词" className="mt-2 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:border-copper/50 focus:outline-none" />
                      <input value={draft.text_zh} onChange={(e) => setDraft((d) => ({ ...d, text_zh: e.target.value }))} placeholder="中文翻译（可选）" className="mt-2 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:border-copper/50 focus:outline-none" />
                      <div className="mt-2 flex items-center gap-2">
                        <button type="button" onClick={() => saveEdit(s)} disabled={savingEdit} className="inline-flex items-center gap-1.5 rounded-full bg-copper px-3.5 py-1.5 text-xs font-medium text-copper-foreground disabled:opacity-50">
                          {savingEdit ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} 保存
                        </button>
                        <button type="button" onClick={cancelEdit} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                          <X size={12} /> 取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className={`relative flex items-stretch rounded-md transition-colors ${isActive ? "bg-copper/20 ring-1 ring-copper/30" : "hover:bg-white/[0.03]"}`}>
                      {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-[4px] rounded-full bg-copper-soft" />}
                      <div
                        onClick={() => onLineClick(s)}
                        title={hasAnyTs ? "点击单词查释义，点击空白处定位视频" : "点击单词查释义"}
                        className="min-w-0 flex-1 cursor-pointer px-3 py-3 text-left"
                      >
                        {analyzingId === s.id && (
                          <div className="mb-0.5"><Loader2 size={11} className="animate-spin text-copper/70" /></div>
                        )}
                        <SubtitleWordLookup
                          text={s.text_en}
                          movieId={movieId}
                          videoId={videoId}
                          movieTitle={movieTitle}
                          episodeId={episodeId}
                          episodeTitle={episodeTitle}
                          sourceType={sourceType || (episodeId ? "episode" : "local")}
                          sourceUrl={sourceUrl}
                          sourceRecordId={sourceRecordId || movieId}
                          subtitleId={s.id}
                          timestamp={s.time_start}
                          timestampSeconds={s.time_start}
                          timestampEnd={s.time_end}
                          sourceCue={{ id: s.id, start: s.time_start, end: s.time_end, textEn: s.text_en, textZh: s.text_zh }}
                          translation={s.text_zh}
                          aiProcessing={s.ai_processing}
                          subtitleHash={processingHash}
                          contextText={[...cueContext.previous, cueContext.target, ...cueContext.next].filter(Boolean).map((cue) => cue.text).join("\n")}
                          className={`leading-snug ${isActive ? "text-base font-semibold text-foreground" : "text-sm text-foreground/60"}`}
                        />
                        {showChinese && s.text_en?.trim() && (
                          <p aria-live="polite" className={`mt-0.5 text-xs leading-snug ${s.text_zh ? (isActive ? "text-copper-soft/90" : "text-muted-foreground/55") : translationState === "error" ? "text-rose-300/80" : "text-muted-foreground/45"}`}>
                            {s.text_zh || (translationState === "error" ? "翻译暂时失败" : "翻译中…")}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5 pr-3">
                        {editable && (
                          <button type="button" onClick={() => startEdit(s)} title="编辑此句" className="text-muted-foreground/70 transition-colors hover:text-copper"><Pencil size={14} /></button>
                        )}
                        <button
                          type="button"
                          onClick={(event) => {
                            onStudyClick(s);
                            if (event.detail > 0) event.currentTarget.blur();
                          }}
                          onKeyDown={(event) => {
                            if (event.code === "Space") event.preventDefault();
                          }}
                          title={loopingId === s.id ? "精读中，再次点击退出并继续播放" : "精读并循环该台词"}
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all hover:scale-[1.03] ${
                            loopingId === s.id
                              ? "border-mint bg-mint/25 text-mint shadow-sm shadow-mint/40"
                              : "border-copper/40 bg-copper/10 text-copper"
                          }`}
                        >
                          {loopingId === s.id ? <Repeat size={12} /> : <BookOpen size={12} />}
                          <span>{loopingId === s.id ? "精读中" : "精读"}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {/* Tail spacer lets the last rows reach the top of the window.
              Without it the list clamps at scrollHeight - clientHeight and the
              active line near the end stays mid-viewport instead of pinned. */}
          <div className="h-52" aria-hidden />
        </div>
        {followOff && (
          <div className="absolute left-1/2 top-2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/55 p-1 text-white backdrop-blur-sm">
            <button
              type="button"
              onClick={backToCurrent}
              title="回到当前台词"
              aria-label="回到当前台词"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-white/15"
            >
              <ArrowUp size={14} />
            </button>
            <button
              type="button"
              onClick={() => setShowChinese((visible) => {
                const next = !visible;
                try { localStorage.setItem("lingoclub:subtitle-list-show-chinese", String(next)); } catch { /* preference is optional */ }
                return next;
              })}
              title={showChinese ? "隐藏中文" : "显示中文"}
              aria-label={showChinese ? "隐藏中文" : "显示中文"}
              aria-pressed={showChinese}
              className={`inline-flex h-7 min-w-8 items-center justify-center gap-1 rounded-full px-1.5 text-[11px] font-semibold transition-colors hover:bg-white/15 ${showChinese ? "text-mint" : "text-white"}`}
            >
              <Languages size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
