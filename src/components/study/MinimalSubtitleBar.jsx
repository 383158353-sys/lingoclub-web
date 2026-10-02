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

// 悬浮字幕：只渲染当前激活的那一句台词（随播放进度自动切换），
// 浮在视频区域上方。显示完整台词（不截断，自动换行）。
// 点击任意英文单词 → 调用 vocab-profile 弹出该单词释义。
//
// 字幕方框支持：
//   · 移动：按住字幕背景区域拖拽（非文字、非按钮处），2D 自由移动，松手确认
//   · 大小长宽：右下角拖拽手柄，按住拖拽同时调节宽度和高度，
//     字号和行数自动匹配方框尺寸以完整显示整句台词，松手确认
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
  // 方框宽高（px）：右下角拖拽同时调节，字号/行数自动匹配
  const [boxW, setBoxW] = useState(() => {
    try { const v = parseInt(localStorage.getItem(`${storageSizeKey}_w`), 10); return Number.isFinite(v) && v ? v : 0; } catch { return 0; }
  });
  const [boxH, setBoxH] = useState(() => {
    try { const v = parseInt(localStorage.getItem(`${storageSizeKey}_h`), 10); return Number.isFinite(v) && v ? v : 0; } catch { return 0; }
  });

  const [word, setWord] = useState(null);
  const [saved, setSaved] = useState(false);
  const [detailWord, setDetailWord] = useState(null);
  const { toast } = useToast();
  const pillRef = useRef(null);
  const textRef = useRef(null);

  useEffect(() => { try { localStorage.setItem(`${storageKey}_x`, String(posX)); } catch { /* noop */ } }, [posX, storageKey]);
  useEffect(() => { try { localStorage.setItem(`${storageKey}_y`, String(posY)); } catch { /* noop */ } }, [posY, storageKey]);
  useEffect(() => { try { localStorage.setItem(`${storageSizeKey}_w`, String(boxW)); } catch { /* noop */ } }, [boxW, storageSizeKey]);
  useEffect(() => { try { localStorage.setItem(`${storageSizeKey}_h`, String(boxH)); } catch { /* noop */ } }, [boxH, storageSizeKey]);

  // 字号自动匹配：在给定宽高内二分查找最大字号使整句台词完整显示
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const W = boxW || 0;
    const H = boxH || 0;
    if (!W || !H) return;
    el.style.visibility = "hidden";
    el.style.width = `${W}px`;
    el.style.height = "auto";
    let lo = 10, hi = 56, best = 20;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      el.style.fontSize = `${mid}px`;
      if (el.scrollHeight <= H) { best = mid; lo = mid + 1; }
      else { hi = mid - 1; }
    }
    el.style.fontSize = `${best}px`;
    el.style.height = `${H}px`;
    el.style.visibility = "";
  }, [boxW, boxH, active?.text_en]);

  // 移动：按住字幕背景拖拽（文字/按钮不触发），2D 自由移动，松手确认
  const startMove = (e) => {
    if (e.target.closest("[data-word]") || e.target.closest("button") || e.target.closest("[data-resize]")) return;
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

  // 右下角拖拽：同时调节宽度和高度，字号/行数自动匹配，松手确认
  const startResize = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const startW = boxW || pillRef.current?.offsetWidth || 320;
    const startH = boxH || pillRef.current?.offsetHeight || 60;
    const move = (ev) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      setBoxW(Math.max(120, Math.round(startW + dx)));
      setBoxH(Math.max(32, Math.round(startH + dy)));
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
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

  // 精读按钮：与字幕列表精读按钮功能相同——调用 study.onStudyClick(active)
  const handleStudy = (e) => {
    e.stopPropagation();
    if (!analysisOn) onToggleAnalysis?.();
    if (onStudyClick) onStudyClick(active);
  };

  const hasBox = boxW > 0 && boxH > 0;

  return (
    <div
      ref={pillRef}
      className="absolute z-40"
      style={{ left: `${posX * 100}%`, top: `${posY * 100}%` }}
    >
      <div
        data-bubble
        onPointerDown={startMove}
        className="relative flex items-start gap-1.5 rounded-xl px-3 py-1.5 leading-snug text-white touch-none cursor-move"
        style={{
          width: hasBox ? `${boxW}px` : "auto",
          height: hasBox ? `${boxH}px` : "auto",
          maxWidth: "94vw",
          backgroundColor: "rgba(8,6,4,0.55)",
          backdropFilter: "blur(10px) saturate(120%)",
          WebkitBackdropFilter: "blur(10px) saturate(120%)",
          boxShadow: "0 2px 10px rgba(0,0,0,0.32)",
          overflow: "hidden",
        }}
      >
        {/* 完整台词文本：字号/行数自动匹配方框宽高 */}
        <span ref={textRef} className="flex-1 text-left" style={{ wordBreak: "break-word", overflow: "hidden" }}>
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

        {/* 右侧按钮组：精读 / 循环（与台词列表精读按钮功能相同，含循环状态指示） */}
        <div className="relative flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={handleStudy}
            title={isLooping ? "再次点击退出循环" : "精读当前这句"}
            className={`rounded-full p-1 transition-colors ${
              isLooping ? "text-mint" : "text-white/45 hover:bg-white/10 hover:text-mint"
            }`}
          >
            {isLooping ? <Repeat size={14} /> : <BookOpen size={14} />}
          </button>
        </div>

        {/* 右下角拖拽手柄：同时调节宽度和高度，字号/行数自动匹配 */}
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
