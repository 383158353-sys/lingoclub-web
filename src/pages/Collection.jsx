import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { vocabRepository } from "@/lib/vocabRepository";
import { useToast } from "@/components/ui/use-toast";
import Flashcard from "@/components/study/Flashcard";
import { scheduleStage, isReviewSetCorrect, buildDailyQueue, dailyQueueSnapshot, restoreDailyQueue, localDateKey, DAILY_QUEUE_VERSION, STAGE_LABELS, stageOf } from "@/lib/srs";
import { loadSession, saveSession, isResumable } from "@/lib/reviewSession";
import { BookMarked, Brain, ArrowRight, Trash2, RotateCw, AlertTriangle } from "lucide-react";
import { appendReviewLog, loadReviewLogs } from "@/lib/reviewLogs";
import { classifyMistakeTiers, classifyReviewPools, normalizeVocabularyProgress } from "@/lib/srs";
import WordDetailDialog from "@/components/vocab/WordDetailDialog";
import { useAuth } from "@/lib/AuthContext";
import { openVocabularySource } from "@/lib/vocabularySourceNavigation";
import { advanceReviewQuestion, createAnswerCommitGate, createReviewQuestionToken } from "@/lib/reviewFlow";

const REVIEW_FONT_SCALES = [0.85, 1, 1.15];
const corpusFontStorageKey = (userId) => `lingoclub:corpus-preview-font-scale:${userId || "guest"}`;

function loadCorpusFontScale(userId) {
  try {
    const saved = Number(localStorage.getItem(corpusFontStorageKey(userId)));
    return REVIEW_FONT_SCALES.includes(saved) ? saved : 1;
  } catch { return 1; }
}

const MASTERY = {
  new: { label: "未学", className: "text-muted-foreground bg-background-elev" },
  learning: { label: "学习中", className: "text-amber-300/90 bg-amber-400/10" },
  familiar: { label: "熟悉", className: "text-sky-300/90 bg-sky-400/10" },
  mastered: { label: "已掌握", className: "text-emerald-300/90 bg-emerald-400/10" },
};

const todayISO = () => localDateKey();
const createSessionId = () => {
  try { return crypto.randomUUID(); } catch { return `00000000-0000-4000-8000-${Date.now().toString(16).slice(-12).padStart(12, "0")}`; }
};

function useProgressiveRenderLimit(total, resetKey, batchSize = 60) {
  const [limit, setLimit] = useState(() => Math.min(batchSize, total));
  const sentinelRef = useRef(null);

  useEffect(() => {
    setLimit(Math.min(batchSize, total));
  }, [batchSize, resetKey, total]);

  useEffect(() => {
    if (limit >= total) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      setLimit(total);
      return undefined;
    }
    const sentinel = sentinelRef.current;
    if (!sentinel) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) setLimit((current) => Math.min(current + batchSize, total));
    }, { rootMargin: "600px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [batchSize, limit, total]);

  return [limit, sentinelRef];
}

// 三阶段复习:①英译中 ②中译英 ③听音选词；选错的本卡追加到本阶段队尾再练一次。
export default function Collection() {
  const [searchParams] = useSearchParams();
  const [vocab, setVocab] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState(() => searchParams.get("tab") === "errors" ? "errors" : "list");

  // 复习队列(按 id):originalQueue 始终是初始待复习全集;queue 是当前阶段工作队列(含重排追加)。
  const [originalQueue, setOriginalQueue] = useState([]);
  const [queue, setQueue] = useState([]);
  const [idx, setIdx] = useState(0);
  const [reviewed, setReviewed] = useState(0);
  const [phase, setPhase] = useState("r1");
  const [r1Res, setR1Res] = useState({});
  const [r2Res, setR2Res] = useState({});
  const [r3Res, setR3Res] = useState({});
  const [retried, setRetried] = useState({});
  const [completedIds, setCompletedIds] = useState(() => loadSession()?.completedIds || []);
  const [sessionMeta, setSessionMeta] = useState(null);
  const [savedSession, setSavedSession] = useState(() => loadSession());
  const [reviewLogs, setReviewLogs] = useState([]);
  const [reviewMode, setReviewMode] = useState("daily");
  const [selectedWord, setSelectedWord] = useState(null);
  const [mistakeFilter, setMistakeFilter] = useState(() => searchParams.get("filter") || "all");
  const [otherReviewOpen, setOtherReviewOpen] = useState(false);
  const [reviewSessionId, setReviewSessionId] = useState(() => loadSession()?.sessionId || createSessionId());
  const [corpusFontScale, setCorpusFontScale] = useState(1);
  const answerCommitGate = useRef(createAnswerCommitGate());
  const reviewQuestionToken = useRef(null);
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const VocabApi = vocabRepository;

  useEffect(() => {
    setCorpusFontScale(loadCorpusFontScale(user?.id));
  }, [user?.id]);

  const changeCorpusFontScale = (scale) => {
    if (!REVIEW_FONT_SCALES.includes(scale)) return;
    setCorpusFontScale(scale);
    try { localStorage.setItem(corpusFontStorageKey(user?.id), String(scale)); } catch { /* local preference is optional */ }
  };

  const reload = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    // 安全超时:接口卡死 12 秒后自动降级,避免列表一直空白/加载不出。
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 12000));
    try {
      Promise.race([VocabApi.list("-created_date"), timeout])
        .then((v) => setVocab((v || []).map(normalizeVocabularyProgress)))
        .catch(() => { setVocab([]); setLoadError(true); })
        .finally(() => setLoading(false));
    } catch {
      setVocab([]); setLoadError(true);
      setLoading(false);
    }
  }, [VocabApi]);

  useEffect(() => {
    reload();
    window.addEventListener("lingoclub:cloud-state-hydrated", reload);
    return () => window.removeEventListener("lingoclub:cloud-state-hydrated", reload);
  }, [reload]);

  useEffect(() => {
    let alive = true;
    loadReviewLogs().then((logs) => { if (alive) setReviewLogs(logs); }).catch(() => {});
    return () => { alive = false; };
  }, [user?.id]);

  useEffect(() => {
    const refreshSession = () => setSavedSession(loadSession());
    window.addEventListener("lingoclub:local-state-changed", refreshSession);
    return () => window.removeEventListener("lingoclub:local-state-changed", refreshSession);
  }, []);

  const byId = useMemo(() => Object.fromEntries(vocab.map((c) => [c.id, c])), [vocab]);

  // 每日首次生成的 ID 快照固定保存；词库后续变动只补充显示对象，不重抽当天队列。
  const dailyQ = useMemo(() => {
    const restored = restoreDailyQueue(savedSession?.dailyQueue, vocab);
    return restored || buildDailyQueue(vocab);
  }, [savedSession, vocab]);

  useEffect(() => {
    const sameDaySnapshot = savedSession?.dailyQueue?.date === todayISO();
    if (loading || !vocab.length || (sameDaySnapshot && savedSession.dailyQueue.version === DAILY_QUEUE_VERSION)) return;
    const completedIds = (sameDaySnapshot ? savedSession.dailyQueue.completedIds || savedSession.completedIds : [])
      .filter((id) => dailyQ.ids.includes(id));
    const next = saveSession({ date: todayISO(), dailyQueue: dailyQueueSnapshot({ ...dailyQ, completedIds }), completedIds });
    if (next) setSavedSession(next);
  }, [dailyQ, loading, savedSession?.dailyQueue?.date, savedSession?.dailyQueue?.version, savedSession?.completedIds, vocab.length]);

  // 保存同一天的队列快照和当前断点。完成后保留快照，避免当天再次抽题。
  useEffect(() => {
    if (tab === "review" && phase !== "done" && queue.length) {
      if (reviewMode !== "daily") {
        // Autonomous practice is intentionally not written over the daily queue snapshot.
        return;
      }
      const snapshot = savedSession?.dailyQueue?.date === todayISO() && savedSession.dailyQueue.version === DAILY_QUEUE_VERSION
        ? savedSession.dailyQueue
        : dailyQueueSnapshot(dailyQ);
      const completed = [...new Set([...(snapshot.completedIds || []), ...completedIds])];
      setSavedSession(saveSession({ date: todayISO(), dailyQueue: { ...snapshot, completedIds: completed }, reviewMode, sessionId: reviewSessionId, originalQueue, queue, idx, reviewed, phase, r1Res, r2Res, r3Res, retried, completedIds: completed }) || null);
    }
    if (tab === "review" && phase === "done") {
      if (reviewMode !== "daily") {
        return;
      }
      const snapshot = savedSession?.dailyQueue?.date === todayISO() && savedSession.dailyQueue.version === DAILY_QUEUE_VERSION ? savedSession.dailyQueue : dailyQueueSnapshot(dailyQ);
      const completed = [...new Set([...(snapshot.completedIds || []), ...originalQueue])];
      setSavedSession(saveSession({ date: todayISO(), dailyQueue: { ...snapshot, completedIds: completed }, reviewMode, sessionId: reviewSessionId, originalQueue, queue, idx, reviewed, phase, r1Res, r2Res, r3Res, retried, completedIds: completed, completed: true }) || null);
    }
  // savedSession is deliberately omitted: saveSession emits a local-state event.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, queue, idx, reviewed, phase, r1Res, r2Res, r3Res, retried, originalQueue, completedIds, reviewMode, reviewSessionId]);

  const sectionWords = useMemo(() => vocab.filter((c) => (c.type || "phrase") !== "sentence"), [vocab]);
  const sectionSentences = useMemo(() => vocab.filter((c) => c.type === "sentence"), [vocab]);
  const mistakeTiers = useMemo(() => classifyMistakeTiers(vocab, reviewLogs), [vocab, reviewLogs]);
  const errorWords = useMemo(() => [...mistakeTiers.focus, ...mistakeTiers.weak, ...mistakeTiers.occasional], [mistakeTiers]);
  const visibleMistakes = mistakeFilter === "all" ? errorWords : mistakeTiers[mistakeFilter] || [];
  const [visibleWordCount, wordsSentinelRef] = useProgressiveRenderLimit(sectionWords.length, sectionWords.length);
  const [visibleSentenceCount, sentencesSentinelRef] = useProgressiveRenderLimit(sectionSentences.length, sectionSentences.length);
  const [visibleMistakeCount, mistakesSentinelRef] = useProgressiveRenderLimit(visibleMistakes.length, `${mistakeFilter}:${visibleMistakes.length}`);
  const resumable = isResumable(savedSession, vocab.map((c) => c.id));
  const todaysCompletedIds = savedSession?.dailyQueue?.date === todayISO()
    ? (savedSession.dailyQueue.completedIds || savedSession.completedIds || [])
    : [];
  const remainingDailyCount = dailyQ.ids.filter((id) => !todaysCompletedIds.includes(id)).length;
  const todayLogs = reviewLogs.filter((log) => localDateKey(log.reviewed_at) === todayISO());
  const todayAccuracy = todayLogs.length ? Math.round(todayLogs.filter((log) => log.is_correct).length / todayLogs.length * 100) : 0;
  const masteredCount = vocab.filter((card) => card.mastery_level === "mastered").length;
  const todayRecommendedCompleted = Math.min(todaysCompletedIds.length, dailyQ.ids.length);
  const todayProgress = dailyQ.goal ? Math.min(100, Math.round(todayRecommendedCompleted / dailyQ.goal * 100)) : 0;
  const sourceGroups = [...new Set(vocab.flatMap((card) => [card.source_movie_title, ...(card.sources || []).map((source) => source.source_movie_title)]).filter(Boolean))];

  const startReview = (mode = "daily") => {
    // 断点续学：同一天且队列 id 仍存在 → 恢复上次中断的进度
    const session = loadSession();
    if (mode === "daily" && isResumable(session, vocab.map((c) => c.id)) && session.reviewMode !== "manual") {
      setOriginalQueue(session.originalQueue || session.queue);
      setQueue([...session.queue]);
      setIdx(session.idx || 0);
      setReviewed(session.reviewed || 0);
      setPhase(session.phase || "r1");
      setR1Res(session.r1Res || {});
      setR2Res(session.r2Res || {});
      setR3Res(session.r3Res || {});
      setRetried(session.retried || {});
      setCompletedIds(session.completedIds || session.dailyQueue?.completedIds || []);
      setReviewMode(session.reviewMode || "daily");
      setReviewSessionId(session.sessionId || createSessionId());
      setSessionMeta(null);
      setTab("review");
      return;
    }
    const existingSnapshot = restoreDailyQueue(session?.dailyQueue, vocab);
    if (mode === "daily" && existingSnapshot && (session.completed || session.phase === "done")) {
      toast({ title: "今日复习已完成", description: "明天会生成新的每日队列。" });
      return;
    }
    const generated = existingSnapshot || buildDailyQueue(vocab);
    const sameDayCompleted = session?.dailyQueue?.date === todayISO()
      ? session.dailyQueue.completedIds || session.completedIds || []
      : [];
    const snapshot = existingSnapshot ? session.dailyQueue : dailyQueueSnapshot({
      ...generated,
      completedIds: sameDayCompleted.filter((id) => generated.ids.includes(id)),
    });
    const finishedIds = new Set(snapshot.completedIds || session?.completedIds || []);
    let selectedCards;
    const pools = classifyReviewPools(vocab);
    if (mode === "daily") selectedCards = generated.queue.filter((c) => !finishedIds.has(c.id));
    else if (mode === "due") selectedCards = pools.due;
    else if (mode === "weak") selectedCards = [...mistakeTiers.focus, ...mistakeTiers.weak];
    else if (mode === "focus") selectedCards = mistakeTiers.focus;
    else if (mode === "occasional") selectedCards = mistakeTiers.occasional;
    else if (mode === "mistakes") selectedCards = errorWords;
    else if (mode === "new") selectedCards = pools.new;
    else if (mode === "today") selectedCards = vocab.filter((card) => card.created_date && localDateKey(card.created_date) === todayISO());
    else if (mode === "recent") selectedCards = [...vocab].sort((a, b) => Date.parse(b.created_date || 0) - Date.parse(a.created_date || 0));
    else if (mode.startsWith("source:")) {
      const title = mode.slice("source:".length);
      selectedCards = vocab.filter((card) => card.source_movie_title === title || card.sources?.some((source) => source.source_movie_title === title));
    }
    else if (mode === "random") selectedCards = [...vocab].sort(() => Math.random() - 0.5);
    else selectedCards = vocab;
    const ids = selectedCards.map((c) => c.id);
    // 三阶段都需要中英文内容，缺释义的卡自动跳过。
    const idMap = Object.fromEntries(vocab.map((c) => [c.id, c]));
    const validIds = ids.filter((id) => {
      const c = idMap[id];
      return c && (c.meaning_zh || c.text_zh);
    });
    if (validIds.length === 0) {
      toast({ title: "今日暂无需要复习的卡片", description: "明天会生成新的每日队列。" });
      return;
    }
    const initial = {
      date: todayISO(), dailyQueue: snapshot, reviewMode: mode, sessionId: createSessionId(), originalQueue: validIds, queue: [...validIds], idx: 0,
      reviewed: 0, phase: "r1", r1Res: {}, r2Res: {}, r3Res: {}, retried: {},
      completedIds: [...finishedIds], completed: false,
    };
    setSavedSession(saveSession(initial) || initial);
    setOriginalQueue(validIds);
    setQueue([...validIds]);
    setIdx(0);
    setReviewed(0);
    setPhase("r1");
    setR1Res({}); setR2Res({});
    setR3Res({});
    setRetried({});
    setCompletedIds([...finishedIds]);
    setSessionMeta({ newCount: generated.newCount, reviewCount: generated.reviewCount, deferred: generated.deferred });
    setReviewMode(mode);
    setReviewSessionId(initial.sessionId);
    setTab("review");
  };

  const resumeTriggered = React.useRef(false);
  useEffect(() => {
    if (resumeTriggered.current || loading || !searchParams.has("resumeReview")) return;
    resumeTriggered.current = true;
    startReview("daily");
  }, [loading, searchParams, vocab]);

  useEffect(() => {
    if (loading || !searchParams.has("restore")) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem("lingoclub_collection_return") || "null");
      if (saved?.tab === "errors") {
        setTab("errors");
        setMistakeFilter(saved.filter || "all");
      }
      if (Number.isFinite(saved?.scrollY)) requestAnimationFrame(() => window.scrollTo({ top: saved.scrollY, behavior: "instant" }));
      sessionStorage.removeItem("lingoclub_collection_return");
    } catch { /* restore the corpus page with its default position */ }
  }, [loading, searchParams]);

  const enterPhase = (p) => {
    setQueue([...originalQueue]);
    setIdx(0);
    setReviewed(0);
    setRetried({});
    setPhase(p);
  };

  const baseQuestionToken = `${reviewSessionId}:${phase}:${idx}:${queue[idx]}`;
  reviewQuestionToken.current = createReviewQuestionToken(baseQuestionToken, reviewQuestionToken.current);
  const activeQuestionToken = reviewQuestionToken.current.token;
  answerCommitGate.current.activate(activeQuestionToken);

  const onAnswer = (card, correct, answer = {}) => {
    if (!answerCommitGate.current.tryCommit(activeQuestionToken)) return;
    try {
    const id = card.id;
    const map = phase === "r1" ? r1Res : phase === "r2" ? r2Res : r3Res;
    const isFirst = map[id] === undefined;
    if (isFirst) {
      if (phase === "r1") setR1Res((m) => ({ ...m, [id]: correct }));
      else if (phase === "r2") setR2Res((m) => ({ ...m, [id]: correct }));
      else setR3Res((m) => ({ ...m, [id]: correct }));
    }

    const reviewedAt = new Date();
    const fields = phase === "r3" && isFirst
      ? scheduleStage(card, isReviewSetCorrect({ r1: r1Res[id] ?? true, r2: r2Res[id] ?? true, r3: correct }), reviewedAt)
      : null;
    if (fields) {
      const updated = { ...card, ...fields };
      Promise.resolve()
        .then(() => VocabApi.updateReviewState(id, fields))
        .catch(() => toast({ title: "复习进度暂存本机", description: "云端更新稍后重试。" }));
      setVocab((vs) => vs.map((c) => (c.id === id ? updated : c)));
    }
    const logMode = ["daily", "due", "weak", "mistakes", "random", "new", "recent", "today", "all", "focus", "occasional"].includes(reviewMode)
      ? reviewMode
      : reviewMode.startsWith("source:") ? "source" : "manual";
    const source = card.sources?.[card.sources.length - 1] || null;
    const log = appendReviewLog({
      vocabulary_id: id, reviewed_at: reviewedAt.toISOString(), session_id: reviewSessionId,
      source_id: source?.id || null, attempt_type: isFirst ? "first" : "retry",
      question_type: answer.question_type || phase, user_answer: answer.user_answer,
      correct_answer: answer.correct_answer, is_correct: correct, rating: answer.rating ?? (correct ? 4 : 0),
      response_time_ms: answer.response_time_ms, previous_mastery: card.mastery_level || "new",
      previous_interval: card.interval_days ?? card.intervalDays ?? 0, new_interval: fields?.interval_days ?? fields?.intervalDays ?? card.interval_days ?? card.intervalDays ?? 0,
      new_mastery: fields?.mastery_level || card.mastery_level, previous_next_review_at: card.next_review_at || card.next_review_date,
      new_next_review_at: fields?.next_review_at || card.next_review_at || card.next_review_date, review_mode: logMode,
    });
    setReviewLogs((logs) => [...logs, log]);

    // 选错(首答)且队尾还有题且本轮未重排 → 追加到队尾再练一次。
    let nextQueue = queue;
    const willAppend = isFirst && !correct && !retried[id] && idx < queue.length - 1;
    if (willAppend) {
      nextQueue = [...queue, id];
      setQueue(nextQueue);
      setRetried((m) => ({ ...m, [id]: true }));
    }

    if (reviewMode === "daily" && phase === "r3" && !willAppend && !completedIds.includes(id)) {
      setCompletedIds((ids) => ids.includes(id) ? ids : [...ids, id]);
    }

    setReviewed((r) => r + 1);
    const next = advanceReviewQuestion({ phase, idx, queueLength: nextQueue.length });
    if (next.phase === "done") setPhase("done");
    else if (next.phase !== phase) enterPhase(next.phase);
    else setIdx(next.idx);
    } catch (error) {
      answerCommitGate.current.release(activeQuestionToken);
      throw error;
    }
  };

  const goBack = () => setIdx((i) => Math.max(0, i - 1));

  if (tab === "review" && phase !== "done" && queue[idx] !== undefined) {
    const activeCard = byId[queue[idx]] || { id: queue[idx] };
    const hasNextInPhase = idx + 1 < queue.length;
    const nextMode = hasNextInPhase ? phase : phase === "r1" ? "r2" : phase === "r2" ? "r3" : null;
    const nextCardId = hasNextInPhase ? queue[idx + 1] : nextMode ? originalQueue[0] : null;
    const nextCard = nextCardId ? byId[nextCardId] || null : null;
    const totalErrors = vocab.reduce((s, c) => s + (c.error_count || 0), 0);
    const totalReviews = vocab.reduce((s, c) => s + (c.review_count || 0), 0);
    const errorRate = totalReviews ? Math.round((totalErrors / totalReviews) * 100) : 0;
    return (
      <div className="mx-auto flex min-h-[100dvh] max-w-7xl flex-col px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+4.75rem)] sm:px-5 md:min-h-0 md:px-8 md:pb-20 md:pt-28">
        <ReviewHeader reviewed={reviewed} total={originalQueue.length} phase={phase} stage={stageOf(activeCard)} errorRate={errorRate} onExit={() => { setTab("list"); }} />
        {sessionMeta && (sessionMeta.newCount > 0 || sessionMeta.reviewCount > 0) && (
          <p className="mt-2 text-[11px] text-muted-foreground/70">今日队列：复习 {sessionMeta.reviewCount} · 新词 {sessionMeta.newCount}{sessionMeta.deferred > 0 ? ` · 顺延 ${sessionMeta.deferred} 至明日` : ""}</p>
        )}
        <div className="mt-10">
          <Flashcard
            key={`${reviewSessionId}:${phase}:${idx}:${queue[idx]}`}
            mode={phase}
            card={activeCard}
            pool={vocab}
            onAnswer={onAnswer}
            reviewMode={reviewMode}
            onBack={goBack}
            nextCard={nextCard}
            nextMode={nextMode}
          />
        </div>
      </div>
    );
  }
  if (tab === "review" && phase === "done") {
    return (
      <div className="mx-auto max-w-2xl px-5 pt-28 pb-20 text-center">
        <Brain size={40} className="mx-auto text-copper" />
        <h2 className="mt-4 font-display text-2xl text-foreground">复习完成</h2>
        <p className="mt-2 text-sm text-muted-foreground">本轮复习了 {originalQueue.length} 张卡片的英译中、中译英和听音选词。保持节奏，把表达搬进长期记忆。</p>
        <button onClick={() => { setTab("list"); setPhase("r1"); }} className="mt-6 rounded-full border border-border px-5 py-2 text-sm text-muted-foreground hover:text-copper">返回语料库</button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-3 pb-16 pt-20 md:px-8 md:pt-28 md:pb-20">
      <header className="max-w-2xl">
        <p className="mb-2 text-[10px] uppercase tracking-luxe text-copper/80 md:mb-3 md:text-[11px]">语料库</p>
        <h1 className="font-display text-2xl leading-tight text-foreground md:text-5xl">语料库</h1>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground md:mt-3 md:text-sm">从真实影视台词里收藏表达，让每一次复习都回到它出现的语境。</p>
      </header>

      <section aria-label="学习进度" className="mt-4 max-w-3xl md:mt-6">
        <div className="grid grid-cols-2 gap-x-5 gap-y-2 sm:flex sm:items-center sm:gap-6">
          <div className="min-w-0 sm:w-52">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-muted-foreground">今日复习</span>
              <span className="font-medium tabular-nums text-foreground">{todayRecommendedCompleted} / {dailyQ.goal}</span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-background-elev" role="progressbar" aria-label="今日推荐复习进度" aria-valuemin={0} aria-valuemax={dailyQ.goal} aria-valuenow={todayRecommendedCompleted}>
              <div className="h-full rounded-full bg-copper transition-[width]" style={{ width: `${todayProgress}%` }} />
            </div>
          </div>
          <ProgressMetric value={`${todayAccuracy}%`} label="正确率" />
          <ProgressMetric value={classifyReviewPools(vocab).due.length} label="待复习" />
          <ProgressMetric value={masteredCount} label="已掌握" />
        </div>
      </section>

      <div className="mt-5 space-y-2 md:mt-8 md:space-y-3">
        <div className="flex min-h-10 flex-wrap items-center gap-2 md:gap-3">
          <button onClick={() => startReview(tab === "list" ? "daily" : "mistakes")} disabled={tab === "errors" && !errorWords.length} className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-copper px-4 py-2 text-xs font-medium text-copper-foreground transition-transform hover:scale-[1.02] disabled:opacity-50 md:px-6 md:py-2.5 md:text-sm">
            <RotateCw size={13} className="md:size-[15px]" /> {tab === "list" ? (remainingDailyCount ? (resumable ? "继续今日复习" : "开始今日复习") : "今日复习已完成") + (remainingDailyCount > 0 ? ` (${remainingDailyCount})` : "") : `复习错词 (${errorWords.length})`}
          </button>
          <button type="button" aria-expanded={otherReviewOpen} onClick={() => setOtherReviewOpen((value) => !value)} className="min-h-10 rounded-full border border-border px-4 py-2 text-xs text-muted-foreground">复习方式 {otherReviewOpen ? "▴" : "▾"}</button>
        </div>
        <div className="flex min-h-10 items-center gap-1.5">
          <Seg active={tab === "list"} onClick={() => setTab("list")}>语料库</Seg>
          <Seg active={tab === "errors"} onClick={() => setTab("errors")}>错词本 {errorWords.length}</Seg>
          <div role="group" aria-label="语料库预览字号" className="ml-auto flex items-center gap-0.5 rounded-full border border-border p-0.5 text-[11px]">
            {REVIEW_FONT_SCALES.map((scale, index) => {
              const label = ["A−", "A", "A+"][index];
              return <button key={scale} type="button" aria-pressed={corpusFontScale === scale} onClick={() => changeCorpusFontScale(scale)} className={`min-w-7 rounded-full px-2 py-1 ${corpusFontScale === scale ? "bg-copper/20 text-copper" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>;
            })}
          </div>
        </div>
      </div>
      {otherReviewOpen && <div className="mt-3 flex min-h-12 flex-wrap gap-2 rounded-xl border border-border/60 bg-card p-3">
        {(tab === "list" ? [["daily", "今日计划"], ["new", "今天新增"], ["recent", "最近收藏"], ["random", "随机复习"], ["all", "全部内容"]] : [["mistakes", "全部错词"], ["weak", "复习薄弱词"], ["focus", "重点攻克"], ["occasional", "偶尔失误"]]).map(([mode, label]) => <button key={mode} onClick={() => startReview(mode)} className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-copper/50 hover:text-copper">{label}</button>)}
        {tab === "list" && sourceGroups.length > 0 && <select aria-label="按影视来源复习" onChange={(event) => event.target.value && startReview(`source:${event.target.value}`)} defaultValue="" className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground"><option value="">按影视来源复习</option>{sourceGroups.map((title) => <option key={title} value={title}>{title}</option>)}</select>}
      </div>}
      <details className="mt-3 text-xs text-muted-foreground"><summary className="w-fit cursor-pointer select-none">今日计划详情</summary><p className="mt-2">今日总任务 {dailyQ.ids.length} · 错词/薄弱 {dailyQ.weakCount} · 到期旧词 {dailyQ.dueCount} · 新词 {dailyQ.newCount} · 未首次复习积压 {dailyQ.backlogCount} · 错题 {errorWords.length} · 收藏 {vocab.length}（单词/短语 {sectionWords.length}，句子 {sectionSentences.length}）· 已掌握 {vocab.filter((c) => c.mastery_level === "mastered").length} · 连续学习 {streak(vocab)} 天</p></details>

      {loading && vocab.length === 0 ? (
        <p className="mt-10 text-sm text-muted-foreground">加载…</p>
      ) : loadError && vocab.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted-foreground">加载失败，可能是网络或速率限制问题。</p>
          <button onClick={reload} className="mt-4 inline-flex items-center gap-1.5 text-sm text-copper hover:underline">
            <RotateCw size={14} /> 重试
          </button>
        </div>
      ) : tab === "errors" ? (
        errorWords.length === 0 ? (
          <div className="mt-10 rounded-xl border border-dashed border-border py-12 text-center">
            <AlertTriangle size={22} className="mx-auto text-muted-foreground/60" />
            <p className="mt-3 text-sm text-muted-foreground">答错过一次的词会进入错词本，并根据近期表现分层。</p>
          </div>
        ) : (
          <div className="mt-6 md:mt-8">
            <div className="mt-3 flex flex-wrap gap-2">
              {[["all", "\u5168\u90e8", errorWords.length], ["occasional", "\u5076\u5c14\u5931\u8bef", mistakeTiers.occasional.length], ["weak", "\u8584\u5f31", mistakeTiers.weak.length], ["focus", "\u91cd\u70b9\u653b\u514b", mistakeTiers.focus.length]].map(([key, label, count]) => <button type="button" key={key} onClick={() => setMistakeFilter(key)} className={`rounded-full px-3 py-1.5 text-xs ${mistakeFilter === key ? "bg-copper/20 text-copper" : "border border-border text-muted-foreground"}`}>{label} {count}</button>)}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 md:mt-4 md:gap-3 sm:grid-cols-4">
              {visibleMistakes.slice(0, visibleMistakeCount).map((c) => <VocabCard key={c.id} c={c} fontScale={corpusFontScale} onSelect={(item) => setSelectedWord({ ...item, recentReviewLogs: reviewLogs.filter((log) => log.vocabulary_id === item.id) })} onGone={reload} onDelete={(id) => VocabApi.delete(id)} />)}
            </div>
            {visibleMistakeCount < visibleMistakes.length && <div ref={mistakesSentinelRef} className="h-px" aria-hidden="true" />}
          </div>
        )
      ) : vocab.length === 0 ? (
        <Empty />
      ) : (
        <div className="mt-6 space-y-8 md:mt-8 md:space-y-12">
          {sectionWords.length > 0 && (
            <section>
              <h2 className="font-display text-base text-foreground md:text-lg">单词 · 短语 <span className="text-xs font-body text-muted-foreground md:text-sm">· {sectionWords.length}</span></h2>
              <div className="mt-3 grid grid-cols-2 gap-2 md:mt-4 md:gap-3 sm:grid-cols-4">
                {sectionWords.slice(0, visibleWordCount).map((c) => <VocabCard key={c.id} c={c} fontScale={corpusFontScale} onSelect={(item) => setSelectedWord({ ...item, recentReviewLogs: reviewLogs.filter((log) => log.vocabulary_id === item.id) })} onGone={reload} onDelete={(id) => VocabApi.delete(id)} />)}
              </div>
              {visibleWordCount < sectionWords.length && <div ref={wordsSentinelRef} className="h-px" aria-hidden="true" />}
            </section>
          )}
          {sectionSentences.length > 0 && (
            <section>
              <h2 className="font-display text-base text-foreground md:text-lg">句子 <span className="text-xs font-body text-muted-foreground md:text-sm">· {sectionSentences.length}</span></h2>
              <div className="mt-3 grid grid-cols-2 gap-2 md:mt-4 md:gap-3 sm:grid-cols-4">
                {sectionSentences.slice(0, visibleSentenceCount).map((c) => <VocabCard key={c.id} c={c} fontScale={corpusFontScale} onSelect={(item) => setSelectedWord({ ...item, recentReviewLogs: reviewLogs.filter((log) => log.vocabulary_id === item.id) })} onGone={reload} onDelete={(id) => VocabApi.delete(id)} />)}
              </div>
              {visibleSentenceCount < sectionSentences.length && <div ref={sentencesSentinelRef} className="h-px" aria-hidden="true" />}
            </section>
          )}
          {sectionWords.length === 0 && sectionSentences.length === 0 && <Empty />}
        </div>
      )}
      <WordDetailDialog vocabulary={selectedWord} open={Boolean(selectedWord)} onOpenChange={(open) => { if (!open) setSelectedWord(null); }} onReturnToSource={(source) => {
        setSelectedWord(null);
        try { sessionStorage.setItem("lingoclub_collection_return", JSON.stringify({ tab, filter: mistakeFilter, scrollY: window.scrollY })); } catch { /* optional view restoration */ }
        void openVocabularySource(source, navigate, (description) => toast({ title: "原片暂不可用", description }), { returnContext: tab === "errors" ? "mistakes" : "collection" });
      }} />
    </div>
  );
}

function typeLabel(t) {
  if (t === "word") return "单词";
  if (t === "phrase") return "短语";
  if (t === "sentence") return "句子";
  return "表达";
}

function streak(vocab) {
  const days = new Set();
  vocab.forEach((c) => {
    if (c.created_date) days.add((c.created_date).slice(0, 10));
    if (c.last_reviewed_date) days.add(c.last_reviewed_date.slice(0, 10));
  });
  let s = 0; let d = new Date();
  while (days.has(d.toISOString().slice(0, 10))) { s++; d.setDate(d.getDate() - 1); }
  return s;
}

function ProgressMetric({ value, label }) {
  return <div className="flex items-baseline gap-1.5"><span className="text-sm font-medium tabular-nums text-foreground">{value}</span><span className="text-[11px] text-muted-foreground">{label}</span></div>;
}

function Seg({ active, onClick, children }) {
  return (
    <button onClick={onClick} className={`rounded-full px-4 py-1 text-[13px] transition-colors ${active ? "bg-copper text-copper-foreground" : "text-muted-foreground hover:text-foreground"}`}>{children}</button>
  );
}

function VocabCard({ c, onGone, onDelete, onSelect, fontScale = 1 }) {
  const m = MASTERY[c.mastery_level] || MASTERY.new;
  return (
    <div onClick={() => onSelect?.(c)} onKeyDown={(event) => { if (event.key === "Enter") onSelect?.(c); }} role="button" tabIndex={0} className="group cursor-pointer rounded-lg border border-border/60 bg-card p-2 md:rounded-xl md:p-4">
      <div className="flex items-start justify-between gap-1.5">
        <p style={{ "--corpus-font-scale": fontScale }} className="font-display text-[calc(1.25rem*var(--corpus-font-scale))] font-semibold leading-snug text-foreground md:text-[calc(1.5rem*var(--corpus-font-scale))]">{c.expression_en || c.text_en}</p>
        <DeleteChip id={c.id} onGone={onGone} onDelete={onDelete} />
      </div>
      {(c.meaning_zh || c.text_zh) && <p style={{ "--corpus-font-scale": fontScale }} className="mt-1 text-[calc(0.875rem*var(--corpus-font-scale))] leading-snug text-foreground/75 md:text-[calc(1rem*var(--corpus-font-scale))]">{c.meaning_zh || c.text_zh}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px] md:mt-2.5 md:gap-1.5 md:text-xs">
        <span className={`rounded-full px-1.5 py-0.5 md:px-2 ${m.className}`}>{m.label}</span>
        {c.type && <span className="rounded-full bg-background-elev px-1.5 py-0.5 md:px-2">{typeLabel(c.type)}</span>}
        {(c.error_count || 0) >= 1 && <span className="rounded-full bg-rose-500/10 px-1.5 py-0.5 text-rose-300/90 md:px-2">错 {c.error_count}</span>}
        {(c.stage || 0) > 0 && <span className="rounded-full bg-mint/10 px-1.5 py-0.5 text-mint/90 md:px-2">{STAGE_LABELS[c.stage] || ""}</span>}
        {c.timestamp && <span className="font-mono text-copper/70">{c.timestamp}</span>}
      </div>
      {c.source_movie_title && <p className="mt-1 text-[10px] text-muted-foreground/65 md:text-[11px]">— {c.source_movie_title}</p>}
    </div>
  );
}

function DeleteChip({ id, onGone, onDelete }) {
  return (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        if (onDelete) await onDelete(id);
        onGone();
      }}
      className="text-muted-foreground/40 opacity-0 transition-opacity hover:text-rose-300 group-hover:opacity-100"
      aria-label="delete"
    >
      <Trash2 size={14} />
    </button>
  );
}

function ReviewHeader({ reviewed, total, phase, stage, errorRate, onExit }) {
  const pct = total ? Math.min(100, Math.round((reviewed / total) * 100)) : 0;
  const labelMap = { r1: "第一轮 · 英译中", r2: "第二轮 · 中译英", r3: "第三轮 · 听音选词" };
  const label = labelMap[phase] || "复习";
  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-luxe text-copper/80">{label}</p>
          <h2 className="mt-1 font-display text-2xl text-foreground">已复习 {reviewed} / {total}</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">当前单词 · {STAGE_LABELS[stage] || "新词"} · 历史错题率 {errorRate}%</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <button onClick={onExit} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-copper">
            退出 <ArrowRight size={14} />
          </button>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-center gap-3 text-[11px] uppercase tracking-luxe">
        <span className={phase === "r1" ? "text-copper" : "text-muted-foreground/50"}>① 英译中</span>
        <ArrowRight size={11} className="text-muted-foreground/40" />
        <span className={phase === "r2" ? "text-copper" : "text-muted-foreground/50"}>② 中译英</span>
        <ArrowRight size={11} className="text-muted-foreground/40" />
        <span className={phase === "r3" ? "text-copper" : "text-muted-foreground/50"}>③ 听音选词</span>
      </div>
      <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-background-elev">
        <div className="h-full bg-copper transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Empty() {
  return (
    <div className="mt-10 rounded-xl border border-dashed border-border py-16 text-center">
      <BookMarked size={24} className="mx-auto text-copper" />
      <p className="mt-3 text-sm text-muted-foreground">你的语料库还是空的。</p>
      <Link to="/local-study" className="mt-4 inline-flex items-center gap-1.5 text-sm text-copper hover:underline">
        去我的影片收藏一句台词 <ArrowRight size={14} />
      </Link>
    </div>
  );
}
