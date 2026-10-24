import React, { useState, useEffect, useRef } from "react";
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
  SUBTITLE_WIDTH_MIN,
  fontAfterVerticalDrag,
  readSubtitleBoxWidth,
  readSubtitleFontSize,
} from "@/lib/subtitlePillBox";

// 悬浮字幕：只渲染当前激活的那一句台词（随播放进度自动切换），
// 浮在视频区域上方。显示完整台词（不截断，自动换行）。
// 点击任意英文单词 → 调用 vocab-profile 弹出该单词释义。
//
// 字幕方框支持：
//   · 移动：按住字幕背景区域拖拽（非文字、非按钮处），2D 自由移动，松手确认
//   · 宽度：右下角手柄的水平分量设置换行宽度（最小约 120px），写入 `${storageSizeKey}_w`
//   · 字号：垂直分量调节首选字号（14–48，约每 2px 拖拽 1px 字号），写入 `_font`
//     没有 `_font` 时，旧的硬裁切高度 `_h` 会换算成字号一次，之后不再用高度裁切
//   · 高度：按当前宽度和字号自动增高（一行或两行以上都向下长），不缩小字号去塞进短框
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
  // 换行宽度（px）。0 = 尚未拖过，用父容器的 min(80%, 640px)。
  const [boxW, setBoxW] = useState(() => {
    try { return readSubtitleBoxWidth(localStorage.getItem(`${storageSizeKey}_w`)); } catch { return 0; }
  });
  // 首选字号。高度始终随内容，不再把 `_h` 当成裁切高度。
  const [fontSize, setFontSize] = useState(() => {
    try {
      return readSubtitleFontSize(
        localStorage.getItem(`${storageSizeKey}_font`),
        localStorage.getItem(`${storageSizeKey}_h`),
      );
    } catch { return SUBTITLE_FONT_DEFAULT; }
  });

  const [word, setWord] = useState(null);
  const [saved, setSaved] = useState(false);
  const [detailWord, setDetailWord] = useState(null);
  const { toast } = useToast();
  const pillRef = useRef(null);

  useEffect(() => { try { localStorage.setItem(`${storageKey}_x`, String(posX)); } catch { /* noop */ } }, [posX, storageKey]);
  useEffect(() => { try { localStorage.setItem(`${storageKey}_y`, String(posY)); } catch { /* noop */ } }, [posY, storageKey]);
  useEffect(() => { try { localStorage.setItem(`${storageSizeKey}_w`, String(boxW)); } catch { /* noop */ } }, [boxW, storageSizeKey]);
  useEffect(() => { try { localStorage.setItem(`${storageSizeKey}_font`, String(fontSize)); } catch { /* noop */ } }, [fontSize, storageSizeKey]);

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

  // 右下角拖拽：水平改换行宽度，垂直改字号。高度保持 auto，松手即当前值。
  const startResize = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const startW = boxW || pillRef.current?.offsetWidth || 320;
    const startFont = fontSize;
    const move = (ev) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      setBoxW(Math.max(SUBTITLE_WIDTH_MIN, Math.round(startW + dx)));
      setFontSize(fontAfterVerticalDrag(startFont, dy));
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

  return (
    <div
      ref={pillRef}
      className="absolute z-40"
      style={{
        position: "absolute",
        zIndex: 40,
        left: `${posX * 100}%`,
        top: `${posY * 100}%`,
        width: boxW > 0 ? `${boxW}px` : "min(80%, 640px)",
      }}
    >
      <div
        data-bubble
        onPointerDown={startMove}
        className="relative w-full cursor-move touch-none select-none text-white"
        style={{ position: "relative", width: "100%", height: "auto", color: "#fff", touchAction: "none", userSelect: "none", cursor: "move" }}
      >
        {/* 整条磨砂：只模糊方框背后的画面，不波及视频其余区域 */}
        <div aria-hidden className="pointer-events-none rounded-xl" style={PILL_FROST} />
        {/* 下沿更重的模糊和压暗，盖住影片烧录的中英字幕 */}
        <div aria-hidden className="pointer-events-none" style={PILL_FROST_LOWER} />
        <div aria-hidden className="pointer-events-none" style={PILL_FROST_TAIL} />

        {/* 台词在整条宽度里水平垂直居中；左右留白与右侧按钮等宽，避免文字偏左 */}
        <div className="relative z-10 flex min-h-11 items-center justify-center" style={{ position: "relative", zIndex: 10, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 44 }}>
          <p
            className="w-full text-center font-medium"
            style={{
              width: "100%",
              textAlign: "center",
              fontWeight: 500,
              fontSize: `${fontSize}px`,
              lineHeight: 1.4,
              margin: 0,
              padding: "0.45em 52px",
              wordBreak: "break-word",
              textShadow: "0 1px 2px rgba(0,0,0,0.92), 0 0 10px rgba(0,0,0,0.55)",
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
          </p>
        </div>

        {/* 右侧按钮脱离文档流，不把居中台词往左挤 */}
        <div className="absolute right-1 top-1/2 z-20 flex -translate-y-1/2 items-center" style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", zIndex: 20 }}>
          <button
            type="button"
            onClick={handleStudy}
            title={isLooping ? "再次点击退出循环" : "精读当前这句"}
            className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-full p-2 touch-manipulation transition-colors [-webkit-tap-highlight-color:transparent] ${
              isLooping ? "text-mint" : "text-white/70 hover:bg-white/10 hover:text-mint"
            }`}
          >
            {isLooping ? <Repeat size={14} /> : <BookOpen size={14} />}
          </button>
        </div>

        {/* 右下角拖拽手柄：左右改宽度，上下改字号 */}
        <span
          data-resize
          onPointerDown={startResize}
          title="拖拽调节宽度与字号"
          className="absolute -bottom-1.5 -right-1.5 z-20 flex h-4 w-4 cursor-nwse-resize touch-none items-center justify-center rounded-full border border-white/50 bg-black/70"
          style={{ position: "absolute", bottom: -6, right: -6, zIndex: 20, width: 16, height: 16 }}
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

// 磨砂只画在方框上。下沿再叠一层更重的模糊和压暗，并向下多伸出一截，
// 用来盖住影片烧录字幕（通常贴在浮动字幕下面的一行中文）。
const PILL_FROST = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  borderRadius: "0.75rem",
  background: "linear-gradient(to bottom, rgba(10,8,6,0.46) 0%, rgba(8,6,4,0.58) 42%, rgba(4,3,2,0.8) 100%)",
  backdropFilter: "blur(24px) saturate(145%)",
  WebkitBackdropFilter: "blur(24px) saturate(145%)",
  boxShadow: "0 2px 16px rgba(0,0,0,0.4)",
};

const PILL_FROST_LOWER = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  height: "72%",
  pointerEvents: "none",
  borderRadius: "0 0 0.75rem 0.75rem",
  backdropFilter: "blur(42px) saturate(120%) brightness(0.7)",
  WebkitBackdropFilter: "blur(42px) saturate(120%) brightness(0.7)",
  background: "linear-gradient(to bottom, rgba(5,4,3,0) 0%, rgba(4,3,2,0.5) 42%, rgba(2,2,2,0.92) 100%)",
  WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, #000 46%)",
  maskImage: "linear-gradient(to bottom, transparent 0%, #000 46%)",
};

const PILL_FROST_TAIL = {
  position: "absolute",
  left: 8,
  right: 8,
  bottom: -56,
  height: 70,
  pointerEvents: "none",
  backdropFilter: "blur(40px) brightness(0.6)",
  WebkitBackdropFilter: "blur(40px) brightness(0.6)",
  background: "linear-gradient(to bottom, rgba(3,2,2,0.88) 0%, rgba(3,2,2,0.76) 52%, rgba(3,2,2,0.34) 82%, rgba(3,2,2,0) 100%)",
  borderRadius: "0 0 20px 20px",
};

function youtubeIdFromUrl(value) { try { const url = new URL(value); return url.hostname.endsWith("youtu.be") ? url.pathname.slice(1).split("/")[0] : url.searchParams.get("v") || ""; } catch { return ""; } }
