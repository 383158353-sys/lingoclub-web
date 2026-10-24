import React, { useState, useEffect, useRef, useLayoutEffect } from "react";
import { saveVocabularyEntry } from "@/lib/vocabularySources";
import { invokeAI } from "@/lib/localApi";
import { Loader2, Bookmark, BookmarkCheck, BookOpen, Repeat } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { toPosEn } from "@/lib/posMap";
import { getCachedProfile, setCachedProfile } from "@/lib/vocabCache";
import WordDetailDialog from "@/components/vocab/WordDetailDialog";
import { AISettingsButton } from "@/components/AISettingsPanel";
import { safeAIErrorMessage } from "@/lib/aiSettings";
import { normalizeSourceCue } from "@/lib/vocabularySourceCue";
import {
  SUBTITLE_FONT_DEFAULT,
  SUBTITLE_FONT_NUDGE,
  SUBTITLE_HEIGHT_MIN,
  SUBTITLE_LINE_HEIGHT,
  SUBTITLE_NUDGE_SPACE_ABOVE,
  SUBTITLE_NUDGE_SPACE_BELOW,
  SUBTITLE_PILL_BACKGROUND,
  SUBTITLE_PILL_BLUR,
  SUBTITLE_PILL_SHADOW,
  SUBTITLE_TEXT_PAD_Y,
  fitSubtitleBlock,
  nextSubtitleBoxSize,
  nudgeSubtitleFont,
  readManualSubtitleFont,
  readSubtitleBoxAxis,
  subtitleCueBoxHeight,
  subtitleTextPadX,
} from "@/lib/subtitlePillBox";

// 悬浮字幕：只渲染当前激活的那一句台词（随播放进度自动切换），
// 浮在视频区域上方。显示完整台词（不截断，自动换行）。
// 点击任意英文单词 → 调用 vocab-profile 弹出该单词释义。
//
// 字幕方框支持：
//   · 移动：按住字幕背景区域拖拽（非文字、非按钮处），2D 自由移动，松手确认
//   · 大小长宽：右下角拖拽同时调节宽度和高度，字号撑满这个方框，松手确认
//   · 字号：右侧悬停只改字号，方框宽高不动；字小于方框时文字略偏上居中
//   · 换句：字号不动。这一句在当前字号下换行放不下时，方框向下增高一行；
//     后面的句子行数变少时，高度收回拖好的默认高度，不留多出来的空行
//   · 精读按钮：与字幕列表精读按钮功能相同（study.onStudyClick），半透明风格
export default function MinimalSubtitleBar({
  study,
  movieId,
  videoId = movieId,
  movieTitle,
  episodeId,
  episodeTitle,
  sourceType,
  sourceUrl,
  sourceRecordId,
  storageKey = "min_sub_pos",
  storageSizeKey = "min_sub_size",
  onToggleAnalysis,
  analysisOn = true,
}) {
  const { subs, activeId, onStudyClick, loopingId } = study;
  const active = subs.find((s) => s.id === activeId) || null;
  const isLooping = loopingId === active?.id;

  // 位置：父容器宽高百分比（分辨率无关），默认居中偏下
  const [posX, setPosX] = useState(() => {
    try { const v = parseFloat(localStorage.getItem(`${storageKey}_x`)); return Number.isFinite(v) ? v : 0.5; } catch { return 0.5; }
  });
  const [posY, setPosY] = useState(() => {
    try { const v = parseFloat(localStorage.getItem(`${storageKey}_y`)); return Number.isFinite(v) ? v : 0.62; } catch { return 0.62; }
  });
  // 方框宽度，和用户拖出的默认高度。显示高度可以在这个默认值上临时长高。
  const [boxW, setBoxW] = useState(() => {
    try { return readSubtitleBoxAxis(localStorage.getItem(`${storageSizeKey}_w`)); } catch { return 0; }
  });
  const [frameH, setFrameH] = useState(() => {
    try { return readSubtitleBoxAxis(localStorage.getItem(`${storageSizeKey}_h`)); } catch { return 0; }
  });
  const [boxH, setBoxH] = useState(frameH);
  const [fittedFont, setFittedFont] = useState(SUBTITLE_FONT_DEFAULT);
  const [lineHeight, setLineHeight] = useState(SUBTITLE_LINE_HEIGHT);
  // null = 拖框时按方框撑满；有值 = 右侧微调过的字号，微调本身不改方框
  const [manualFont, setManualFont] = useState(() => {
    try { return readManualSubtitleFont(localStorage.getItem(`${storageSizeKey}_manual`)); } catch { return null; }
  });
  // 拖框松手后锁住的字号。换句只改高度，不再为了塞进方框去缩小字号。
  const [lockedFont, setLockedFont] = useState(() => {
    try { return readManualSubtitleFont(localStorage.getItem(`${storageSizeKey}_fit`)); } catch { return null; }
  });

  const [word, setWord] = useState(null);
  const [saved, setSaved] = useState(false);
  const [detailWord, setDetailWord] = useState(null);
  const { toast } = useToast();
  const pillRef = useRef(null);
  const textRef = useRef(null);
  const dragging = useRef(false);
  const pinHeight = useRef(manualFont != null);
  const seenCue = useRef(null);
  const fittedRef = useRef(SUBTITLE_FONT_DEFAULT);
  const leadingRef = useRef(SUBTITLE_LINE_HEIGHT);

  useEffect(() => { try { localStorage.setItem(`${storageKey}_x`, String(posX)); } catch { /* noop */ } }, [posX, storageKey]);
  useEffect(() => { try { localStorage.setItem(`${storageKey}_y`, String(posY)); } catch { /* noop */ } }, [posY, storageKey]);
  useEffect(() => { try { localStorage.setItem(`${storageSizeKey}_w`, String(boxW)); } catch { /* noop */ } }, [boxW, storageSizeKey]);
  useEffect(() => { try { localStorage.setItem(`${storageSizeKey}_h`, String(frameH)); } catch { /* noop */ } }, [frameH, storageSizeKey]);
  useEffect(() => {
    try {
      const key = `${storageSizeKey}_manual`;
      if (manualFont == null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(manualFont));
    } catch { /* noop */ }
  }, [manualFont, storageSizeKey]);
  useEffect(() => {
    try {
      const key = `${storageSizeKey}_fit`;
      if (lockedFont == null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(lockedFont));
    } catch { /* noop */ }
  }, [lockedFont, storageSizeKey]);

  // 离屏测量，避免方框自身的固定高度把 scrollHeight 卡住。
  // 拖框时字号撑满；微调时只改字号；换句时字号不动，高度跟着整句走。
  useLayoutEffect(() => {
    const host = textRef.current;
    if (!host) return;
    const cue = active?.text_en || "";
    const cueChanged = seenCue.current !== null && seenCue.current !== cue;
    if (cueChanged) pinHeight.current = false;
    seenCue.current = cue;
    if (!(boxW > 0) || !cue) {
      setFittedFont((prev) => (prev === SUBTITLE_FONT_DEFAULT ? prev : SUBTITLE_FONT_DEFAULT));
      setLineHeight((prev) => (prev === SUBTITLE_LINE_HEIGHT ? prev : SUBTITLE_LINE_HEIGHT));
      return;
    }
    const padX = subtitleTextPadX(boxW);
    const probe = document.createElement("div");
    probe.style.position = "fixed";
    probe.style.left = "-10000px";
    probe.style.top = "0";
    probe.style.visibility = "hidden";
    probe.style.boxSizing = "border-box";
    probe.style.width = `${boxW}px`;
    probe.style.padding = `${SUBTITLE_TEXT_PAD_Y}px ${padX}px`;
    probe.style.fontWeight = "400";
    probe.style.wordBreak = "break-word";
    probe.style.fontFamily = getComputedStyle(host).fontFamily;
    probe.style.textAlign = "center";
    probe.textContent = cue;
    document.body.appendChild(probe);
    const measure = (fontPx, lh) => {
      probe.style.fontSize = `${fontPx}px`;
      probe.style.lineHeight = String(lh);
      return probe.scrollHeight;
    };
    const applyFont = (size, leading) => {
      fittedRef.current = size;
      leadingRef.current = leading;
      setFittedFont((prev) => (prev === size ? prev : size));
      setLineHeight((prev) => (Math.abs(prev - leading) < 0.005 ? prev : leading));
    };
    try {
      if (dragging.current && frameH > 0) {
        const fit = fitSubtitleBlock(measure, Math.max(SUBTITLE_HEIGHT_MIN, frameH - 2));
        applyFont(fit.font, fit.lineHeight);
        pinHeight.current = true;
        return;
      }
      if (pinHeight.current && (manualFont != null || lockedFont != null)) {
        const size = manualFont ?? lockedFont;
        applyFont(size, manualFont != null ? SUBTITLE_LINE_HEIGHT : leadingRef.current);
        return;
      }
      if (manualFont == null && lockedFont == null && frameH > 0) {
        const fit = fitSubtitleBlock(measure, Math.max(SUBTITLE_HEIGHT_MIN, frameH - 2));
        applyFont(fit.font, fit.lineHeight);
        setLockedFont(fit.font);
        setBoxH(frameH);
        pinHeight.current = true;
        return;
      }
      const size = manualFont ?? lockedFont ?? SUBTITLE_FONT_DEFAULT;
      const leading = SUBTITLE_LINE_HEIGHT;
      const textH = measure(size, leading);
      const cueHeight = subtitleCueBoxHeight(textH, frameH);
      applyFont(size, leading);
      setBoxH((prev) => (prev === cueHeight ? prev : cueHeight));
    } finally {
      probe.remove();
    }
  }, [boxW, frameH, manualFont, lockedFont, active?.text_en]);

  // 移动：按住字幕背景拖拽（文字/按钮不触发），2D 自由移动，松手确认
  const startMove = (e) => {
    if (e.target.closest("[data-word]") || e.target.closest("button") || e.target.closest("[data-resize]") || e.target.closest("[data-font-nudge]")) return;
    e.preventDefault();
    e.stopPropagation();
    const parent = pillRef.current?.parentElement;
    if (!parent) return;
    const W = parent.clientWidth || 640;
    const H = parent.clientHeight || 360;
    const sx = e.clientX;
    const sy = e.clientY;
    const startX = posX;
    const startY = posY;
    const move = (ev) => {
      const dx = (ev.clientX - sx) / W;
      const dy = (ev.clientY - sy) / H;
      setPosX(Math.max(0, Math.min(0.92, startX + dx)));
      setPosY(Math.max(0.02, Math.min(0.95, startY + dy)));
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // 右下角拖拽：同时调节宽度和高度，字号随后撑满方框，松手确认
  const startResize = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const startW = boxW || pillRef.current?.offsetWidth || 320;
    const startH = boxH || pillRef.current?.offsetHeight || 60;
    dragging.current = true;
    pinHeight.current = true;
    const move = (ev) => {
      const next = nextSubtitleBoxSize(startW, startH, ev.clientX - sx, ev.clientY - sy);
      setManualFont(null);
      setBoxW(next.width);
      setFrameH(next.height);
      setBoxH(next.height);
    };
    const up = () => {
      dragging.current = false;
      pinHeight.current = true;
      setLockedFont(fittedRef.current);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const lookupWord = async (w) => {
    setSaved(false);
    setWord({ text: w, loading: true, profile: null, err: "" });
    // 内存缓存命中 → 秒弹
    const cached = getCachedProfile(w);
    if (cached) {
      setWord({ text: w, loading: false, profile: cached, err: "" });
      return;
    }
    try {
      // quick=true 仅返回 meaning/pos/phonetic_us，2-3 秒内返回；加 15 秒超时保护
      const invokePromise = invokeAI("word_lookup", {
        expression_en: w,
        subtitle_text: active.text_en,
        video_id: videoId,
        context: movieTitle || "film & TV",
        quick: true,
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("查询超时，请稍后重试")), 15000)
      );
      const res = await Promise.race([invokePromise, timeoutPromise]);
      const profile = res?.profile;
      if (!profile || typeof profile !== "object") throw new Error("未返回释义");
      setCachedProfile(w, profile);
      setWord({ text: w, loading: false, profile, err: "" });
    } catch (e) {
      setWord({ text: w, loading: false, profile: null, err: safeAIErrorMessage(e) });
    }
  };

  const saveWord = async (w, meaning) => {
    const cue = normalizeSourceCue(active || {});
    const payload = {
      text_en: w,
      text_zh: meaning || "",
      expression_en: w,
      meaning_zh: meaning || "",
      type: "word",
      tag: "划词",
      tags: ["划词"],
      source_movie_id: movieId,
      source_record_id: sourceRecordId || movieId,
      source_url: sourceUrl || "",
      source_video_id: youtubeIdFromUrl(sourceUrl),
      source_movie_title: movieTitle,
      source_episode_id: episodeId,
      source_episode_title: episodeTitle,
      source_sentence_en: cue.textEn,
      source_sentence_zh: cue.textZh,
      source_subtitle_id: cue.id,
      source_time_start: cue.start,
      source_time_end: cue.end,
      source_timestamp_seconds: cue.start,
      source_timestamp_end_seconds: cue.end,
      source_timestamp_text: cue.start ?? "",
      source_type: sourceType || (episodeId ? "episode" : "local"),
      mastery_level: "new",
      review_count: 0,
      correct_count: 0,
      ease_factor: 2.5,
      interval_days: 0,
      profile: word.profile || null,
    };
    try {
      await saveVocabularyEntry(payload);
      toast({ title: "已保存这一条语境", description: w });
      setSaved(true);
    } catch (e) {
      toast({ title: "收藏失败", description: e?.message, variant: "destructive" });
    }
  };

  useEffect(() => {
    if (!word) return;
    const onDown = (e) => { if (!e.target.closest?.("[data-bubble]")) setWord(null); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [word]);

  if (!active?.text_en) return null;

  const words = active.text_en.split(/(\s+)/);
  const popoverBelow = posY < 0.55;
  const padX = subtitleTextPadX(boxW);
  const shownFont = manualFont ?? fittedFont;
  const nudgeFont = (delta) => {
    pinHeight.current = true;
    leadingRef.current = SUBTITLE_LINE_HEIGHT;
    const from = fittedRef.current || shownFont;
    setManualFont((prev) => nudgeSubtitleFont(prev ?? from, delta));
  };
  const onFontWheel = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (e.clientX < rect.right - 64) return;
    e.preventDefault();
    e.stopPropagation();
    nudgeFont(e.deltaY < 0 ? SUBTITLE_FONT_NUDGE : -SUBTITLE_FONT_NUDGE);
  };

  // 精读按钮：与字幕列表精读按钮功能相同——调用 study.onStudyClick(active)
  const handleStudy = (e) => {
    e.stopPropagation();
    if (!analysisOn) onToggleAnalysis?.();
    if (onStudyClick) onStudyClick(active);
  };

  return (
    <div
      ref={pillRef}
      className="absolute z-40"
      style={{ left: `${posX * 100}%`, top: `${posY * 100}%` }}
    >
      <div
        data-bubble
        onPointerDown={startMove}
        onWheel={onFontWheel}
        className="group relative cursor-move touch-none text-white"
        style={{
          width: boxW > 0 ? `${boxW}px` : "auto",
          height: boxH > 0 ? `${boxH}px` : "auto",
          maxWidth: "94vw",
          minHeight: boxH > 0 ? undefined : 44,
          backgroundColor: SUBTITLE_PILL_BACKGROUND,
          backdropFilter: SUBTITLE_PILL_BLUR,
          WebkitBackdropFilter: SUBTITLE_PILL_BLUR,
          boxShadow: SUBTITLE_PILL_SHADOW,
          borderRadius: "0.75rem",
          overflow: "hidden",
        }}
      >
        {/* 台词在方框内水平、垂直居中；字号由宽高二分撑满 */}
        <div
          className="flex w-full flex-col"
          style={{ display: "flex", flexDirection: "column", width: "100%", height: boxH > 0 ? "100%" : "auto", minHeight: boxH > 0 ? "100%" : 44 }}
        >
          {boxH > 0 && <div aria-hidden style={{ flex: `${SUBTITLE_NUDGE_SPACE_ABOVE} 1 0px`, minHeight: 0 }} />}
          <span
            ref={textRef}
            className="block min-w-0 text-center"
            style={{
              width: "100%",
              flex: "0 0 auto",
              height: "auto",
              fontSize: `${shownFont}px`,
              lineHeight,
              fontWeight: 400,
              wordBreak: "break-word",
              boxSizing: "border-box",
              padding: `${SUBTITLE_TEXT_PAD_Y}px ${padX}px`,
            }}
          >
            {words.map((seg, i) => {
              if (/^\s+$/.test(seg) || !seg) return <span key={i}>{seg}</span>;
              const w = seg.replace(/[^A-Za-z'-]/g, "");
              if (!w) return <span key={i}>{seg}</span>;
              return (
                <span
                  key={i}
                  data-word
                  onClick={(e) => { e.stopPropagation(); lookupWord(w); }}
                  className="cursor-pointer underline decoration-transparent underline-offset-2 transition-colors hover:text-mint hover:decoration-mint/60"
                >
                  {seg}
                </span>
              );
            })}
          </span>
          {boxH > 0 && <div aria-hidden style={{ flex: `${SUBTITLE_NUDGE_SPACE_BELOW} 1 0px`, minHeight: 0 }} />}
        </div>

        {/* 右侧字号微调：默认隐藏，悬停才出现一条细线，不是按钮 */}
        <div
          data-font-nudge
          className="pointer-events-none absolute bottom-4 right-1 top-1 z-20 w-11 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100"
        >
          <div
            data-font-nudge
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={(e) => { e.stopPropagation(); nudgeFont(SUBTITLE_FONT_NUDGE); }}
            className="absolute inset-x-0 top-0 cursor-ns-resize"
            style={{ height: "calc(50% - 22px)" }}
            aria-label="放大字幕"
          >
            <span data-font-nudge className="absolute left-1/2 top-1/2 h-px w-2.5 -translate-x-1/2 bg-white/40" />
          </div>
          <div
            data-font-nudge
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={(e) => { e.stopPropagation(); nudgeFont(-SUBTITLE_FONT_NUDGE); }}
            className="absolute inset-x-0 bottom-0 cursor-ns-resize"
            style={{ height: "calc(50% - 22px)" }}
            aria-label="缩小字幕"
          >
            <span data-font-nudge className="absolute left-1/2 top-1/2 h-px w-2.5 -translate-x-1/2 bg-white/40" />
          </div>
        </div>

        {/* 精读按钮保持原来的 14px 图标和半透明颜色，脱离文档流以免把居中台词挤偏 */}
        <div className="absolute right-1 top-1/2 z-10 -translate-y-1/2">
          <button
            type="button"
            onClick={handleStudy}
            title={isLooping ? "再次点击退出循环" : "精读当前这句"}
            className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-full p-2 touch-manipulation transition-colors [-webkit-tap-highlight-color:transparent] ${
              isLooping ? "text-mint" : "text-white/45 hover:bg-white/10 hover:text-mint"
            }`}
          >
            {isLooping ? <Repeat size={14} /> : <BookOpen size={14} />}
          </button>
        </div>

        {/* 右下角拖拽手柄：同时调节宽度和高度 */}
        <span
          data-resize
          onPointerDown={startResize}
          title="拖拽调节字幕大小"
          className="absolute -bottom-1.5 -right-1.5 z-10 flex h-4 w-4 cursor-nwse-resize touch-none items-center justify-center rounded-full border border-white/50 bg-black/70"
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="text-white/60">
            <path d="M7 1L1 7M7 4L4 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </span>
      </div>

      {word && (
        <div
          data-bubble
          onClick={(e) => e.stopPropagation()}
          className={`absolute left-0 w-fit max-w-[90vw] rounded-xl border border-border bg-card px-3 py-2 text-left shadow-xl ${popoverBelow ? "top-full mt-2" : "bottom-full mb-2"}`}
        >
          {word.loading && <p className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 size={11} className="animate-spin" /> 查询中…</p>}
          {word.err && !word.loading && <div className="space-y-1"><p className="text-xs text-rose-300">{word.err}</p>{word.err === "AI 解析尚未配置" && <AISettingsButton className="text-[11px] text-copper underline">设置 AI →</AISettingsButton>}</div>}
          {word.profile && !word.loading && (
            <div className="flex flex-col gap-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-sm font-bold leading-none text-foreground">{word.text}</span>
                <button
                  type="button"
                  onClick={() => !saved && saveWord(word.text, word.profile.meaning)}
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors ${saved ? "border-mint/40 bg-mint/10 text-mint" : "border-border text-muted-foreground hover:border-mint/50 hover:text-mint"}`}
                >
                  {saved ? <BookmarkCheck size={10} /> : <Bookmark size={10} />} {saved ? "已收藏" : "收藏"}
                </button>
              </div>
              <div className="mt-0.5 flex items-baseline gap-1.5 leading-none">
                {word.profile.phonetic_us && <span className="text-[11px] text-muted-foreground">{word.profile.phonetic_us}</span>}
                {toPosEn(word.profile.pos) && <span className="text-[11px] italic text-mint/80">{toPosEn(word.profile.pos)}</span>}
              </div>
              {word.profile.meaning && <p className="mt-0.5 text-xs leading-snug text-foreground/90">{word.profile.meaning}</p>}
              <button type="button" onClick={() => { const cue = normalizeSourceCue(active || {}); setDetailWord({ id: `lookup:${word.text}`, expression_en: word.text, text_en: word.text, meaning_zh: word.profile.meaning || "", text_zh: word.profile.meaning || "", profile: word.profile, source_sentence_en: cue.textEn, source_sentence_zh: cue.textZh, source_movie_id: movieId, source_record_id: sourceRecordId || movieId, source_url: sourceUrl || "", source_video_id: youtubeIdFromUrl(sourceUrl), source_movie_title: movieTitle, source_episode_id: episodeId, source_episode_title: episodeTitle, source_subtitle_id: cue.id, source_time_start: cue.start, source_time_end: cue.end, source_timestamp_seconds: cue.start, source_timestamp_end_seconds: cue.end, source_timestamp_text: cue.start ?? "", source_type: sourceType || (episodeId ? "episode" : "local") }); }} className="mt-2 text-left text-[10px] text-copper hover:underline">查看完整词条</button>
            </div>
          )}
        </div>
      )}
      <WordDetailDialog vocabulary={detailWord} open={Boolean(detailWord)} onOpenChange={(open) => { if (!open) setDetailWord(null); }} />
    </div>
  );
}

function youtubeIdFromUrl(value) { try { const url = new URL(value); return url.hostname.endsWith("youtu.be") ? url.pathname.slice(1).split("/")[0] : url.searchParams.get("v") || ""; } catch { return ""; } }
