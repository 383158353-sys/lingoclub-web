import React, { useState, useEffect } from "react";
import { guestVocab } from "@/lib/guestVocab";
import { invokeAI } from "@/lib/localApi";
import { Loader2, Bookmark, BookmarkCheck } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { toPosEn } from "@/lib/posMap";
import { getCachedProfile, setCachedProfile } from "@/lib/vocabCache";
import { findCueLearningTerm, getCachedTerm, recordSubtitleAICall } from "@/lib/subtitleAiProcessing";

// 将一句英文字幕渲染为可点击的单词 span。
// 点击任意单词 → 先查内存缓存 → 再调 vocab-profile 后端（后端自带 DB 缓存）→ 弹出释义 + 收藏。
// 收藏写入当前浏览器的本地词库。
export default function SubtitleWordLookup({ text, movieId, videoId = movieId, movieTitle, subtitleId, timestamp, className, aiProcessing, subtitleHash, contextText }) {
  const { toast } = useToast();
  const [word, setWord] = useState(null); // { text, loading, profile, err, x, top, h, showBelow }
  const [saved, setSaved] = useState(false);

  const lookup = async (w, rect) => {
    const showBelow = rect.top < 220;
    setSaved(false);
    const cachedTerm = getCachedTerm(videoId, subtitleHash, w, subtitleId, text) || findCueLearningTerm(aiProcessing, w, text);
    if (cachedTerm) {
      const profile = { meaning: cachedTerm.contextMeaning || cachedTerm.basicMeaning, contextMeaning: cachedTerm.contextMeaning, basicMeaning: cachedTerm.basicMeaning, pos: cachedTerm.partOfSpeech || "", phonetic_us: "", type: cachedTerm.type };
      setWord({ text: cachedTerm.expression, loading: false, profile, err: "", x: rect.left + rect.width / 2, top: rect.top, h: rect.height, showBelow });
      if (guestVocab.has(cachedTerm.expression)) setSaved(true);
      return;
    }
    setWord({ text: w, loading: true, profile: null, err: "", x: rect.left + rect.width / 2, top: rect.top, h: rect.height, showBelow });
    // 检查是否已收藏
    if (guestVocab.has(w)) setSaved(true);
    // 1) 内存缓存命中 → 秒弹
    const cached = getCachedProfile(w);
    if (cached) {
      setWord((prev) => (prev ? { ...prev, loading: false, profile: cached, err: "" } : prev));
      return;
    }
    try {
      // 2) 后端：先查 DB 缓存，未命中才调 LLM。
      //    quick=true 仅返回 meaning/pos/phonetic_us 三个字段，2-3 秒内返回。
      //    加 15 秒超时保护，防止 LLM 响应过慢导致气泡永久转圈。
      recordSubtitleAICall(videoId, subtitleHash, "fallbackWordCalls");
      const invokePromise = invokeAI("word_lookup", {
        expression_en: w,
        subtitle_text: contextText || text,
        video_id: videoId,
        context: `${movieTitle || "film & TV"}; current subtitle: ${text}`,
        quick: true,
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("查询超时，请稍后重试")), 15000)
      );
      const res = await Promise.race([invokePromise, timeoutPromise]);
      const profile = res?.profile;
      if (!profile || typeof profile !== "object") throw new Error("未返回释义");
      setCachedProfile(w, profile);
      setWord((prev) => (prev ? { ...prev, loading: false, profile, err: "" } : prev));
    } catch (e) {
      setWord((prev) => (prev ? { ...prev, loading: false, err: e?.message || "查询失败" } : prev));
    }
  };

  const save = async () => {
    if (!word) return;
    // 防重复收藏
    if (guestVocab.has(word.text)) { setSaved(true); toast({ title: "已在你的单词库中", description: word.text }); return; }
    const meaning = word.profile?.meaning || "";
      const payload = {
      text_en: word.text,
      text_zh: meaning,
      expression_en: word.text,
      meaning_zh: meaning,
      type: word.profile?.type === "word" ? "word" : word.profile?.type ? "phrase" : "word",
      tag: word.profile?.type && word.profile.type !== "word" ? "字幕短语" : "划词",
      tags: [word.profile?.type && word.profile.type !== "word" ? "字幕短语" : "划词"],
      profile: word.profile || null,
      source_movie_id: movieId,
      source_movie_title: movieTitle,
      source_subtitle_id: subtitleId,
      timestamp: timestamp || "",
      mastery_level: "new",
      review_count: 0,
      correct_count: 0,
      ease_factor: 2.5,
      interval_days: 0,
    };
    try {
      await guestVocab.create(payload);
      toast({ title: "已加入我的单词库", description: word.text });
      setSaved(true);
    } catch (e) {
      toast({ title: "收藏失败", description: e?.message, variant: "destructive" });
    }
  };

  // 气泡出现后：点击外部 / 滚动 → 关闭
  useEffect(() => {
    if (!word) return;
    const onDown = (e) => { if (!e.target.closest?.("[data-word-bubble]")) setWord(null); };
    const onScroll = () => setWord(null);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [word]);

  const segments = (text || "").split(/(\s+)/);

  return (
    <>
      <p className={className}>
        {segments.map((seg, i) => {
          if (!seg || /^\s+$/.test(seg)) return <span key={i}>{seg}</span>;
          const w = seg.replace(/[^A-Za-z'-]/g, "");
          if (!w) return <span key={i}>{seg}</span>;
          return (
            <span
              key={i}
              onClick={(e) => { e.stopPropagation(); lookup(w, e.currentTarget.getBoundingClientRect()); }}
              className="cursor-pointer underline decoration-transparent underline-offset-2 transition-colors hover:text-mint hover:decoration-mint/60"
            >
              {seg}
            </span>
          );
        })}
      </p>
      {word && (
        <div
          data-word-bubble
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            left: `${word.x}px`,
            top: word.showBelow ? `${word.top + word.h + 8}px` : `${word.top - 8}px`,
            transform: word.showBelow ? "translate(-50%, 0)" : "translate(-50%, -100%)",
            zIndex: 60,
          }}
          className="max-w-[90vw] w-fit rounded-xl border border-border bg-card px-3 py-2 text-left shadow-xl"
        >
          {word.loading && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 size={11} className="animate-spin" /> 查询中…
            </p>
          )}
          {word.err && !word.loading && <p className="text-xs text-rose-300">{word.err}</p>}
          {word.profile && !word.loading && (
            <div className="flex flex-col gap-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-sm font-bold leading-none text-foreground">{word.text}</span>
                <button
                  type="button"
                  onClick={() => !saved && save()}
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
            </div>
          )}
        </div>
      )}
    </>
  );
}
