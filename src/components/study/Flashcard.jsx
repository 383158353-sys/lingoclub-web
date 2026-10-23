import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Volume2, VolumeX } from "lucide-react";
import { invokeAI } from "@/lib/localApi";
import { buildReviewQuestion, distractorsForReview, getReviewQuestionPresentation, isCorrectReviewAnswer, prefetchReviewDistractors } from "@/lib/reviewDistractors";
import { commitReviewAnswer, scheduleReviewAutoAdvance } from "@/lib/reviewFlow";
import { BuryButton, WordDetailOverlay } from "@/components/vocab/WordDetailDialog";
import { pronounce } from "@/lib/pronunciation";
import { answerFeedbackPlan, isReviewSoundEnabled, playReviewSound, setReviewSoundEnabled } from "@/lib/reviewSounds";

function speak(text) {
  pronounce(text, { accent: "en-US" });
}

export default function Flashcard({ mode, card, pool, upcoming = [], onAnswer, onBack, onBury, onRestore, fontScale = 1 }) {
  const [picked, setPicked] = useState(null);
  const [correct, setCorrect] = useState(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [soundOn, setSoundOn] = useState(() => isReviewSoundEnabled());
  const questionCache = useRef({ key: null, question: null });
  const poolRef = useRef(pool);
  const autoTimer = useRef(null);
  const pendingAnswer = useRef(null);
  const answerToken = useRef(0);
  const onAnswerRef = useRef(onAnswer);
  onAnswerRef.current = onAnswer;
  const startedAt = useRef(Date.now());
  const expr = card.expression_en || card.text_en || "";
  const meaning = card.meaning_zh || card.text_zh || "";
  const ts = card.timestamp || "";
  const presentation = getReviewQuestionPresentation(card, mode, picked !== null);
  const questionKey = `${card?.id}:${mode}`;
  if (questionCache.current.key !== questionKey) {
    questionCache.current = { key: questionKey, question: buildReviewQuestion(card, pool, mode, distractorsForReview(card, pool, mode)) };
  }
  const question = questionCache.current.question;
  const options = question?.options || [];
  const hasCompleteOptions = options.length > 0;
  const upcomingKey = upcoming.map((item) => item?.id).filter(Boolean).slice(0, 2).join("\n");
  poolRef.current = pool;

  const commitAnswer = useCallback((token) => {
    const pending = pendingAnswer.current;
    if (!pending || pending.token !== token || pending.committed || pending.committing) return false;
    if (autoTimer.current) {
      clearTimeout(autoTimer.current);
      autoTimer.current = null;
    }
    const result = commitReviewAnswer(pending, () => onAnswerRef.current?.(pending.card, pending.correct, pending.details));
    if (!result.committed) {
      console.error("[LingoClub review answer commit]", result.error);
      if (pending.correct && (pending.retryCount || 0) < 1) {
        pending.retryCount = (pending.retryCount || 0) + 1;
        autoTimer.current = scheduleReviewAutoAdvance(mode, () => commitAnswer(token));
      } else if (!pending.correct) {
        setShowAnswer(true);
      }
    }
    return result.committed;
  }, []);

  useEffect(() => {
    const targets = upcoming.filter((item) => item?.id).slice(0, 2);
    if (!targets.length) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    prefetchReviewDistractors(targets, mode, (target) => invokeAI("generate_distractors", {
      expression_en: target.expression_en || target.text_en || "",
      meaning_zh: target.meaning_zh || target.text_zh || "",
      subtitle_text: target.expression_en || target.text_en || "",
      video_id: target.source_movie_id || "review",
    }, { signal: controller.signal, timeoutMs: 3500 }), poolRef.current);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // upcomingKey is the identity of the next two cards; pool is read from poolRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, upcomingKey]);

  const pronounceTimer = useRef(null);
  useEffect(() => () => { if (pronounceTimer.current) clearTimeout(pronounceTimer.current); }, []);

  useEffect(() => {
    if (mode === "r3" && expr) speak(expr);
  }, [card.id, expr, mode]);

  useEffect(() => {
    setPicked(null);
    setCorrect(null);
    setShowAnswer(false);
    pendingAnswer.current = null;
    startedAt.current = Date.now();
  }, [card.id, mode]);

  useEffect(() => {
    const advanceWhenVisible = () => {
      const pending = pendingAnswer.current;
      if (document.visibilityState !== "hidden" && pending?.correct && Date.now() >= pending.dueAt) {
        commitAnswer(pending.token);
      }
    };
    document.addEventListener("visibilitychange", advanceWhenVisible);
    window.addEventListener("pageshow", advanceWhenVisible);
    window.addEventListener("focus", advanceWhenVisible);
    return () => {
      document.removeEventListener("visibilitychange", advanceWhenVisible);
      window.removeEventListener("pageshow", advanceWhenVisible);
      window.removeEventListener("focus", advanceWhenVisible);
    };
  }, [commitAnswer]);

  useEffect(() => {
    const onKey = (event) => {
      if (picked !== null) return;
      const number = parseInt(event.key, 10);
      if (number >= 1 && number <= options.length) choose(options[number - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [options, picked]);

  const choose = (option) => {
    if (picked !== null || pendingAnswer.current || !option || !question) return;
    const isCorrect = isCorrectReviewAnswer(question, option);
    const correctOption = question.options.find((candidate) => candidate.id === question.correctAnswerId);
    const answerDetails = { question_type: mode, user_answer: option.value, correct_answer: correctOption?.value, rating: isCorrect ? 4 : 0, response_time_ms: Date.now() - startedAt.current };
    const token = ++answerToken.current;
    const delay = mode === "r3" ? 1600 : 700;
    pendingAnswer.current = { token, card, correct: isCorrect, details: answerDetails, dueAt: Date.now() + delay, committed: false };
    setPicked(option.id);
    setCorrect(isCorrect);
    const feedback = answerFeedbackPlan(mode, isCorrect);
    const chimed = playReviewSound(feedback.sound);
    if (feedback.pronounceDelayMs !== null && expr) {
      if (pronounceTimer.current) clearTimeout(pronounceTimer.current);
      if (chimed) pronounceTimer.current = setTimeout(() => { pronounceTimer.current = null; speak(expr); }, feedback.pronounceDelayMs);
      else speak(expr);
    }
    if (isCorrect) autoTimer.current = scheduleReviewAutoAdvance(mode, () => commitAnswer(token));
    else setShowAnswer(true);
  };

  const continueAfterWrong = () => {
    setShowAnswer(false);
    commitAnswer(pendingAnswer.current?.token);
  };

  if (showAnswer && !correct) {
    return <WordDetailOverlay vocabulary={card} onContinue={continueAfterWrong} returnContext="review" onBury={onBury} onRestore={onRestore} />;
  }

  const answerClass = (option, revealed) => {
    if (!revealed) return "border-white/10 bg-background-elev text-foreground hover:border-mint/40 hover:bg-background-elev/80";
    if (option.id === question?.correctAnswerId) return "border-mint bg-mint/15 text-foreground";
    if (picked === option.id) return "border-rose-400/50 bg-rose-500/10 text-rose-200";
    return "border-white/10 bg-background-elev text-muted-foreground/50";
  };

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col px-3 pb-3 md:min-h-0 md:px-0">
      <div className="mb-1 flex items-center justify-center gap-3 text-[10px] text-muted-foreground/50 md:mb-2"><span>键盘 1-4 快速选答案</span><button type="button" onClick={() => { const next = !soundOn; setReviewSoundEnabled(next); setSoundOn(next); if (next) playReviewSound("correct"); }} aria-pressed={soundOn} aria-label={soundOn ? "关闭答题音效" : "开启答题音效"} className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 hover:text-mint">{soundOn ? <Volume2 size={11} /> : <VolumeX size={11} />}音效{soundOn ? "开" : "关"}</button></div>
      <div className="flex flex-col rounded-2xl border border-white/10 bg-card p-4 md:min-h-[340px] md:flex-none md:p-6">
        <p className="text-[11px] uppercase tracking-luxe text-mint/80">{card.source_movie_title || "语料复习"} · {mode === "r1" ? "第一轮 · 英译中" : mode === "r2" ? "第二轮 · 中译英" : "第三轮 · 听音选词"}</p>
        {mode === "r1" && <><div className="mt-3 flex items-center justify-between gap-3 md:mt-4"><h3 style={{ "--review-font-scale": fontScale }} className="break-words font-display text-[calc(1.5rem*var(--review-font-scale))] font-bold leading-snug text-foreground md:text-[calc(1.875rem*var(--review-font-scale))]">{expr}</h3><button onClick={() => speak(expr)} className="rounded-full border border-white/10 p-2.5 text-muted-foreground hover:border-mint/40 hover:text-mint" aria-label="朗读"><Volume2 size={18} /></button></div>{ts && <p className="mt-1.5 font-mono text-[11px] text-mint/70">{ts}</p>}<p style={{ "--review-font-scale": fontScale }} className="mt-3 text-[calc(0.875rem*var(--review-font-scale))] text-muted-foreground md:mt-4">选择正确的中文词义</p></>}
        {mode === "r2" && <><h3 style={{ "--review-font-scale": fontScale }} className="mt-3 break-words font-display text-[calc(1.5rem*var(--review-font-scale))] font-bold leading-snug text-foreground md:mt-4 md:text-[calc(1.875rem*var(--review-font-scale))]">{meaning}</h3>{ts && <p className="mt-1.5 font-mono text-[11px] text-mint/70">{ts}</p>}<p style={{ "--review-font-scale": fontScale }} className="mt-3 text-[calc(0.875rem*var(--review-font-scale))] text-muted-foreground md:mt-4">选择对应的英文表达</p></>}
        {mode === "r3" && <><button onClick={() => speak(expr)} className="mt-3 flex w-full flex-col items-center justify-center rounded-xl border border-mint/30 bg-mint/5 py-4 text-mint hover:bg-mint/10 md:mt-6 md:py-8"><Volume2 size={26} /><span className="mt-2 text-sm">重新播放英文，再选择中文释义</span></button></>}
        {hasCompleteOptions ? <div className="mt-4 grid grid-cols-2 gap-2 pt-1 md:mt-4 md:gap-3 md:pt-0">
          {options.map((option, index) => <button key={`${questionKey}:${option.id}`} onClick={(event) => { choose(option); if (event.detail > 0) event.currentTarget.blur(); }} disabled={picked !== null} style={{ "--review-font-scale": fontScale }} className={`min-h-[4.25rem] touch-manipulation rounded-xl border p-3 transition-colors [-webkit-tap-highlight-color:transparent] focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper ${answerClass(option, picked !== null)} ${mode === "r2" ? "text-center font-display text-[calc(1rem*var(--review-font-scale))]" : "text-left text-[calc(0.875rem*var(--review-font-scale))]"}`}><span className="mr-1.5 text-[10px] text-muted-foreground/40">{index + 1}</span>{option.value || "—"}</button>)}
        </div> : <div className="mt-4 rounded-xl border border-mint/20 bg-mint/5 p-5 text-center text-sm text-muted-foreground">正在准备相近干扰项，请稍候…</div>}
        {mode === "r3" && picked !== null && correct && <div className="mt-4 rounded-xl border border-mint/20 bg-mint/5 p-4">
          <div className="flex items-center gap-2 text-sm text-mint"><Check size={16} />回答正确</div>
          <p className="mt-2 font-display text-lg text-foreground">{expr}</p>
          {presentation.phonetic && <p className="mt-1 font-mono text-sm text-muted-foreground">{presentation.phonetic}</p>}
          <p className="mt-1 text-sm text-muted-foreground">{presentation.answerText}</p>
        </div>}
        {picked !== null && correct && !showAnswer && <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-mint"><p className="flex items-center gap-1.5"><Check size={16} />回答正确</p><button type="button" onClick={() => commitAnswer(pendingAnswer.current?.token)} className="rounded-full bg-mint px-4 py-2 font-medium text-background hover:bg-mint/90">下一张</button></div>}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 md:mt-5">
        <button type="button" onClick={() => onBack?.()} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-white/15 px-4 py-2 text-sm text-muted-foreground touch-manipulation hover:border-mint/40 hover:text-mint"><ArrowLeft size={14} /> 上一张</button>
        <BuryButton card={card} onBury={onBury} onRestore={onRestore} className="inline-flex min-h-11 items-center rounded-full border border-copper/50 px-4 py-2 text-sm font-medium text-copper touch-manipulation [-webkit-tap-highlight-color:transparent] hover:bg-copper/10" />
      </div>
    </div>
  );
}
