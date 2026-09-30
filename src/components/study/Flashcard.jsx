import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Volume2, X } from "lucide-react";
import { invokeAI } from "@/lib/localApi";
import { buildLocalDistractors, buildReviewQuestion, getReviewQuestionPresentation, isCorrectReviewAnswer } from "@/lib/reviewDistractors";

function speak(text) {
  try {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.92;
    window.speechSynthesis.speak(utterance);
  } catch { /* noop */ }
}

export default function Flashcard({ mode, card, pool, onAnswer, onBack }) {
  const [picked, setPicked] = useState(null);
  const [correct, setCorrect] = useState(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [questionState, setQuestionState] = useState({ key: null, question: null });
  const questionCache = useRef({ key: null, question: null });
  const autoTimer = useRef(null);
  const expr = card.expression_en || card.text_en || "";
  const meaning = card.meaning_zh || card.text_zh || "";
  const ts = card.timestamp || "";
  const presentation = getReviewQuestionPresentation(card, mode, picked !== null);
  const questionKey = JSON.stringify([card.id, mode]);
  const question = questionState.key === questionKey ? questionState.question : null;
  const options = question?.options || [];
  const hasCompleteOptions = options.length === 4;

  useEffect(() => {
    let alive = true;
    if (questionCache.current.key !== questionKey) questionCache.current = { key: questionKey, question: null };
    const getQuestion = (distractors) => {
      const cached = questionCache.current;
      if (cached.key === questionKey && cached.question?.options.length === 4) return cached.question;
      const next = buildReviewQuestion(card, pool, mode, distractors);
      questionCache.current = { key: questionKey, question: next };
      return next;
    };
    const local = buildLocalDistractors(card, pool, mode);
    const initialQuestion = getQuestion(local);
    setQuestionState({ key: questionKey, question: initialQuestion });
    if (initialQuestion.options.length === 4) return () => { alive = false; };
    invokeAI("generate_distractors", {
      expression_en: expr,
      meaning_zh: meaning,
      subtitle_text: expr,
      video_id: card.source_movie_id || "review",
    }).then((res) => {
      if (!alive) return;
      const data = res?.distractors || {};
      const remote = mode === "r1" || mode === "r3" ? data.meaning_options : data.expression_options;
      const nextQuestion = getQuestion([...local, ...(remote || [])]);
      setQuestionState({ key: questionKey, question: nextQuestion });
    }).catch(() => { /* local options remain available */ });
    return () => { alive = false; };
  }, [card.id, mode]);

  useEffect(() => {
    if (mode === "r3" && expr) speak(expr);
  }, [card.id, expr, mode]);

  useEffect(() => {
    setPicked(null);
    setCorrect(null);
    setShowAnswer(false);
    return () => { if (autoTimer.current) clearTimeout(autoTimer.current); };
  }, [card.id, mode]);

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
    if (picked !== null || !option || !question) return;
    const isCorrect = isCorrectReviewAnswer(question, option);
    setPicked(option.id);
    setCorrect(isCorrect);
    if (isCorrect) autoTimer.current = setTimeout(() => onAnswer?.(card, true), mode === "r3" ? 1600 : 700);
    else setShowAnswer(true);
  };

  const continueAfterWrong = () => {
    if (autoTimer.current) clearTimeout(autoTimer.current);
    setShowAnswer(false);
    onAnswer?.(card, false);
  };

  const answerClass = (option, revealed) => {
    if (!revealed) return "border-white/10 bg-background-elev text-foreground hover:border-mint/40 hover:bg-background-elev/80";
    if (option.id === question?.correctAnswerId) return "border-mint bg-mint/15 text-foreground";
    if (picked === option.id) return "border-rose-400/50 bg-rose-500/10 text-rose-200";
    return "border-white/10 bg-background-elev text-muted-foreground/50";
  };

  return (
    <div className="mx-auto w-full max-w-xl">
      <div className="mb-4 flex items-center justify-center gap-2 text-[11px] uppercase tracking-luxe">
        <span className={mode === "r1" ? "text-mint" : "text-muted-foreground/60"}>① 英译中</span><ArrowRight size={11} className="text-muted-foreground/40" />
        <span className={mode === "r2" ? "text-mint" : "text-muted-foreground/60"}>② 中译英</span><ArrowRight size={11} className="text-muted-foreground/40" />
        <span className={mode === "r3" ? "text-mint" : "text-muted-foreground/60"}>③ 听音选词</span>
      </div>
      <p className="mb-2 text-center text-[10px] text-muted-foreground/50">键盘 1-4 快速选答案</p>
      <div className="min-h-[340px] rounded-2xl border border-white/10 bg-card p-6">
        <p className="text-[11px] uppercase tracking-luxe text-mint/80">{card.source_movie_title || "语料复习"} · {mode === "r1" ? "第一轮 · 英译中" : mode === "r2" ? "第二轮 · 中译英" : "第三轮 · 听音选词"}</p>
        {mode === "r1" && <><div className="mt-4 flex items-center justify-between gap-3"><h3 className="break-words font-display text-3xl font-bold leading-snug text-foreground">{expr}</h3><button onClick={() => speak(expr)} className="rounded-full border border-white/10 p-2.5 text-muted-foreground hover:border-mint/40 hover:text-mint" aria-label="朗读"><Volume2 size={18} /></button></div>{ts && <p className="mt-1.5 font-mono text-[11px] text-mint/70">{ts}</p>}<p className="mt-4 text-sm text-muted-foreground">选择正确的中文词义</p></>}
        {mode === "r2" && <><h3 className="mt-4 break-words font-display text-3xl font-bold leading-snug text-foreground">{meaning}</h3>{ts && <p className="mt-1.5 font-mono text-[11px] text-mint/70">{ts}</p>}<p className="mt-4 text-sm text-muted-foreground">选择对应的英文表达</p></>}
        {mode === "r3" && <><button onClick={() => speak(expr)} className="mt-6 flex w-full flex-col items-center justify-center rounded-xl border border-mint/30 bg-mint/5 py-8 text-mint hover:bg-mint/10"><Volume2 size={30} /><span className="mt-2 text-sm">重新播放英文，再选择中文释义</span></button></>}
        {hasCompleteOptions ? <div className="mt-4 grid grid-cols-2 gap-3">
          {options.map((option, index) => <button key={option.id} onClick={() => choose(option)} disabled={picked !== null} className={`rounded-xl border p-4 transition-colors ${answerClass(option, picked !== null)} ${mode === "r2" ? "text-center font-display text-base" : "text-left text-sm"}`}><span className="mr-1.5 text-[10px] text-muted-foreground/40">{index + 1}</span>{option.value || "—"}</button>)}
        </div> : <div className="mt-4 rounded-xl border border-mint/20 bg-mint/5 p-5 text-center text-sm text-muted-foreground">正在准备相近干扰项，请稍候…</div>}
        {mode === "r3" && picked !== null && <div className={`mt-4 rounded-xl border p-4 ${correct ? "border-mint/20 bg-mint/5" : "border-rose-400/20 bg-rose-500/5"}`}>
          <div className={`flex items-center gap-2 text-sm ${correct ? "text-mint" : "text-rose-300"}`}>{correct ? <Check size={16} /> : <X size={16} />}{correct ? "回答正确" : "回答错误 · 正确释义"}</div>
          <p className="mt-2 font-display text-lg text-foreground">{expr}</p>
          {presentation.phonetic && <p className="mt-1 font-mono text-sm text-muted-foreground">{presentation.phonetic}</p>}
          <p className="mt-1 text-sm text-muted-foreground">{presentation.answerText}</p>
          {!correct && <button onClick={continueAfterWrong} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-mint px-4 py-2.5 text-sm font-semibold text-background">继续复习 <ArrowRight size={14} /></button>}
        </div>}
        {showAnswer && mode !== "r3" && <div className="mt-4 rounded-xl border border-rose-400/20 bg-rose-500/5 p-4"><div className="flex items-center gap-2 text-sm text-rose-300"><X size={16} /> 正确答案</div><p className="mt-2 font-display text-lg text-foreground">{mode === "r1" ? meaning : expr}</p><p className="mt-1 text-sm text-muted-foreground">{mode === "r1" ? expr : meaning}</p><button onClick={continueAfterWrong} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-mint px-4 py-2.5 text-sm font-semibold text-background">继续复习 <ArrowRight size={14} /></button></div>}
        {picked !== null && correct && !showAnswer && <p className="mt-4 flex items-center gap-1.5 text-sm text-mint"><Check size={16} /> 正确，即将进入下一张…</p>}
      </div>
      <div className="mt-5 flex items-center justify-between"><button onClick={() => onBack?.()} className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-4 py-2 text-sm text-muted-foreground hover:border-mint/40 hover:text-mint"><ArrowLeft size={14} /> 上一张</button></div>
    </div>
  );
}
