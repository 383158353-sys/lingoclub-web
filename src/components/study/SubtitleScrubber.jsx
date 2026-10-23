import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Loader2, Pencil, Check, X, BookOpen, Repeat, ArrowUp, Languages } from "lucide-react";

import { toSec } from "@/lib/timecode";
import SubtitleWordLookup from "@/components/study/SubtitleWordLookup";
import { AISettingsButton } from "@/components/AISettingsPanel";
import { resolveSubtitleTranslationState, subtitleHash } from "@/lib/subtitleAiProcessing";
import { createScrollIntentTracker, computeRowScrollTop, cueIndexAtTime, forceScrollTo, resolvePlaybackTime } from "@/lib/subtitleScrollIntent";
import { toSec as toSecForArrow } from "@/lib/timecode";

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
export default function SubtitleScrubber({ study, movieId, movieTitle, episodeId, episodeTitle, sourceType, sourceUrl, sourceRecordId, videoId = movieId, editable, listHeight, focusRequest, getCurrentTime }) {
  const { loading, subs, activeId, analyzingId, hasAnyTs, onLineClick, onStudyClick, loopingId, updateSub, processingStatus = {}, retrySubtitleProcessing } = study;
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
  const resumeTimerRef = useRef(null);
  const resumeFollowRef = useRef(null);
  // Decides manual-vs-programmatic scroll from real finger/wheel input (not timers), and
  // whether a row click is a tap or the end of a scroll gesture (must never seek).
  const intentRef = useRef(null);
  if (!intentRef.current) intentRef.current = createScrollIntentTracker();
  const touchingRef = useRef(false);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  // Index once per subs change instead of a findIndex per row per render (was O(n²) on every tick).
  const contextTextById = useMemo(() => {
    const map = new Map();
    subs.forEach((cue, index) => {
      map.set(cue.id, subs.slice(Math.max(0, index - 4), index + 5).map((c) => c.text_en || "").filter(Boolean).join("\n"));
    });
    return map;
  }, [subs]);

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
      intentRef.current.programmatic();
      container.scrollTo({ top: Math.max(0, container.scrollTop + delta), behavior: smooth ? "smooth" : "auto" });
    } else {
      // 用户已手动滚动：完全不干预滚动位置，直到点击「回到当前台词」
      return;
    }

    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    // Reset programmatic flag after the scroll settles. iOS Safari smooth scrolling runs well past
    // 400ms; resetting too early made our own scroll look like a user scroll, which turned follow
    // off again right after tapping ↑ (the "arrow does nothing" bug).
    scrollTimerRef.current = setTimeout(() => { programmaticRef.current = false; }, smooth ? 1200 : 150);
  }, []);

  // Auto-scroll on activeId change (video progressed or user scrubbed to a new line)
  useEffect(() => {
    if (!activeId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-sub-id="${activeId}"]`);
    if (!el) return;
    scrollToEl(el, { forceTop: false });
  }, [activeId, subs, scrollToEl]);

  // Rows grow when translations stream in, which pushes the pinned line down while
  // follow is on. Re-pin (instant) whenever the list's size changes.
  useEffect(() => {
    const container = listRef.current;
    const list = container?.querySelector("ul");
    if (!list || typeof ResizeObserver === "undefined") return undefined;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!followOnRef.current || touchingRef.current || !activeIdRef.current) return;
        const el = container.querySelector(`[data-sub-id="${activeIdRef.current}"]`);
        if (el) { intentRef.current.ignoreScrollFor(200); scrollToEl(el, { forceTop: true }); }
      });
    });
    observer.observe(list);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [subs.length, scrollToEl]);

  // User scroll detection: any scroll NOT caused by our own scrollTo → user scrolled → disable pin-to-top
  // Re-attach when subs load (list isn't rendered until subs are available)
  useEffect(() => {
    if (subs.length === 0) return;
    const container = listRef.current;
    if (!container) return;
    const intent = intentRef.current;
    const scheduleResume = () => {
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = setTimeout(() => {
        if (touchingRef.current) { scheduleResume(); return; } // finger still down
        resumeFollowRef.current?.();
      }, 4000);
    };
    const onTouchStart = (e) => { const t = e.touches[0]; touchingRef.current = true; intent.touchStart(t?.clientX || 0, t?.clientY || 0); };
    const onTouchMove = (e) => { const t = e.touches[0]; if (t) intent.touchMove(t.clientX, t.clientY); };
    const onTouchEnd = () => { touchingRef.current = false; intent.touchEnd(); };
    const onWheel = () => intent.wheel();
    const onScroll = () => {
      // Only finger / wheel driven scrolls (incl. iOS momentum) count as manual. Our own
      // scrollTo + smooth animation, layout shifts and content-visibility reflow are ignored.
      if (!intent.scroll()) return;
      if (followOnRef.current) {
        followOnRef.current = false;
        setFollowOff(true);
      }
      // Resume auto-follow 4s after the user stops scrolling manually.
      scheduleResume();
    };
    const opts = { passive: true };
    container.addEventListener("touchstart", onTouchStart, opts);
    container.addEventListener("touchmove", onTouchMove, opts);
    container.addEventListener("touchend", onTouchEnd, opts);
    container.addEventListener("touchcancel", onTouchEnd, opts);
    container.addEventListener("wheel", onWheel, opts);
    container.addEventListener("keydown", onWheel, opts);
    container.addEventListener("scroll", onScroll, opts);
    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", onTouchEnd);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("keydown", onWheel);
      container.removeEventListener("scroll", onScroll);
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    };
  }, [subs.length]);

  // Cleanup timer on unmount
  useEffect(() => () => { if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current); }, []);

  const focusActiveTranscriptCue = useCallback((cueId, { smooth = false } = {}) => {
    if (!cueId || !listRef.current) return;
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    followOnRef.current = true;
    setFollowOff(false);
    const el = listRef.current.querySelector(`[data-sub-id="${cueId}"]`);
    if (el) scrollToEl(el, { smooth, forceTop: true });
  }, [scrollToEl]);

  // "回到当前台词" (↑). Must work every time on iOS:
  //  · target = live player time (activeId is null in gaps between lines / may lag a tick)
  //  · jump via direct scrollTop (smooth scrollTo / scrollIntoView get cancelled by momentum)
  //  · our own scroll is never treated as manual until the position has settled; retry once.
  const cancelArrowRef = useRef(null);
  const lastTimeRef = useRef(0);
  // Remember the last good playback time (fallback when the iframe API reports 0).
  useEffect(() => {
    if (!activeId) return;
    try {
      const t = Number(getCurrentTime?.());
      if (Number.isFinite(t) && t > 0.25) lastTimeRef.current = t;
    } catch { /* player not ready */ }
  }, [activeId, getCurrentTime]);
  const resolveCurrentCueId = useCallback(() => {
    let live;
    try { live = getCurrentTime?.(); } catch { live = undefined; }
    const activeCue = activeId ? subs.find((cue) => cue.id === activeId) : null;
    const t = resolvePlaybackTime(live, (lastTimeRef.current > 0.5 ? lastTimeRef.current : null) ?? toSecForArrow(activeCue?.time_start));
    if (Number.isFinite(t) && t >= 0) {
      const starts = subs.map((cue) => toSecForArrow(cue.time_start));
      const ordered = starts.every((v, i) => i === 0 || !Number.isFinite(v) || !Number.isFinite(starts[i - 1]) || v >= starts[i - 1]);
      if (ordered) {
        const idx = cueIndexAtTime(starts, t);
        if (idx >= 0) return subs[idx].id;
      }
    }
    return activeId || null;
  }, [getCurrentTime, subs, activeId]);
  const backToCurrent = useCallback(() => {
    const container = listRef.current;
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    followOnRef.current = true;
    setFollowOff(false);
    if (!container) return;
    // Resolve the cue on every frame: playback keeps moving while we settle.
    const targetTop = () => {
      const cueId = resolveCurrentCueId();
      const el = cueId ? container.querySelector(`[data-sub-id="${cueId}"]`) : null;
      if (!el) return 0;
      return computeRowScrollTop({
        scrollTop: container.scrollTop,
        rowTop: el.getBoundingClientRect().top,
        containerTop: container.getBoundingClientRect().top,
        padTop: 12,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
      });
    };
    cancelArrowRef.current?.();
    programmaticRef.current = true;
    intentRef.current.programmatic();
    intentRef.current.ignoreScrollFor(1600);
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    cancelArrowRef.current = forceScrollTo(container, targetTop, {
      isInterrupted: () => touchingRef.current, // user grabbed the list again: stop fighting them
      onDone: () => {
        programmaticRef.current = false;
        intentRef.current.programmatic();
        // Swallow iOS's trailing scroll events (~300ms) after the jump (unless the user touched).
        if (!touchingRef.current) intentRef.current.ignoreScrollFor(300);
        // Follow stays on: the activeId effect keeps pinning the playing line from here.
        followOnRef.current = true;
        setFollowOff(false);
      },
    });
  }, [resolveCurrentCueId]);
  useEffect(() => () => cancelArrowRef.current?.(), []);
  resumeFollowRef.current = () => { if (!followOnRef.current && activeId) focusActiveTranscriptCue(activeId, { smooth: true }); };

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
              return (
                <li key={s.id} data-sub-id={s.id} style={isActive || isEditing ? undefined : { contentVisibility: "auto", containIntrinsicSize: "auto 64px" }}>
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
                        onClick={() => {
                          // A tap that ends/stops a scroll on mobile must never seek the video.
                          if (!intentRef.current.consumeClick()) return;
                          onLineClick(s);
                        }}
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
                          contextText={contextTextById.get(s.id) || ""}
                          className={`leading-snug ${isActive ? "text-base font-semibold text-foreground" : "text-sm text-foreground/60"}`}
                        />
                        {showChinese && s.text_en?.trim() && (
                          <p aria-live="polite" className={`mt-0.5 text-xs leading-snug ${s.text_zh ? (isActive ? "text-copper-soft/90" : "text-muted-foreground/55") : translationState === "error" ? "text-rose-300/80" : "text-muted-foreground/45"}`}>
                            {s.text_zh || (translationState === "error"
                              ? (processingStatus.setupMessage
                                ? <AISettingsButton onClick={(event) => event.stopPropagation()} className="underline decoration-dotted underline-offset-2 hover:text-rose-200">{processingStatus.setupMessage}</AISettingsButton>
                                : retrySubtitleProcessing
                                ? <button type="button" onClick={(event) => { event.stopPropagation(); retrySubtitleProcessing(); }} className="underline decoration-dotted underline-offset-2 hover:text-rose-200">翻译失败，点此重试</button>
                                : "翻译失败")
                              : "翻译中…")}
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
                            if (!intentRef.current.consumeClick()) return; // scroll gesture, not a tap
                            onStudyClick(s);
                            if (event.detail > 0) event.currentTarget.blur();
                          }}
                          onKeyDown={(event) => {
                            if (event.code === "Space") event.preventDefault();
                          }}
                          title={loopingId === s.id ? "精读中，再次点击退出并继续播放" : "精读并循环该台词"}
                          className={`inline-flex min-h-11 min-w-11 touch-manipulation items-center gap-1 rounded-full border px-3 py-2 text-[11px] font-medium transition-all [-webkit-tap-highlight-color:transparent] hover:scale-[1.03] ${
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
          <div className="absolute left-1/2 top-2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/70 p-1 text-white" style={{ transform: "translate3d(-50%,0,0)", touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}>
            <button
              type="button"
              onClick={backToCurrent}
              title="回到当前台词"
              aria-label="回到当前台词"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-white/15 active:bg-white/25"
            >
              <ArrowUp size={16} />
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
              className={`inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-full px-1.5 text-[11px] font-semibold transition-colors hover:bg-white/15 ${showChinese ? "text-mint" : "text-white"}`}
            >
              <Languages size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
