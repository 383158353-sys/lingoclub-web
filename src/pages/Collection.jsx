import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { guestVocab } from "@/lib/guestVocab";
import { useToast } from "@/components/ui/use-toast";
import Flashcard from "@/components/study/Flashcard";
import { scheduleStage, buildDailyQueue, dailyQueueSnapshot, restoreDailyQueue, localDateKey, STAGE_LABELS, stageOf } from "@/lib/srs";
import { loadSession, saveSession, isResumable } from "@/lib/reviewSession";
import { Flame, BookMarked, Brain, Layers, ArrowRight, Trash2, RotateCw, AlertTriangle } from "lucide-react";

const MASTERY = {
  new: { label: "未学", className: "text-muted-foreground bg-background-elev" },
  learning: { label: "学习中", className: "text-amber-300/90 bg-amber-400/10" },
  familiar: { label: "熟悉", className: "text-sky-300/90 bg-sky-400/10" },
  mastered: { label: "已掌握", className: "text-emerald-300/90 bg-emerald-400/10" },
};

const todayISO = () => localDateKey();

// 三阶段复习:①英译中 ②中译英 ③听音选词；选错的本卡追加到本阶段队尾再练一次。
export default function Collection() {
  const [vocab, setVocab] = useState([]);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState("list");

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
  const { toast } = useToast();
  const VocabApi = guestVocab;

  const reload = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    // 安全超时:接口卡死 12 秒后自动降级,避免列表一直空白/加载不出。
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 12000));
    try {
      Promise.race([VocabApi.list("-created_date", 500), timeout])
        .then((v) => setVocab(v || []))
        .catch(() => { setVocab([]); setLoadError(true); })
        .finally(() => setLoading(false));
    } catch {
      setVocab([]); setLoadError(true);
      setLoading(false);
    }
  }, [VocabApi]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const refreshSession = () => setSavedSession(loadSession());
    window.addEventListener("lingoclub:local-state-changed", refreshSession);
    return () => window.removeEventListener("lingoclub:local-state-changed", refreshSession);
  }, []);

  useEffect(() => {
    setNotes([]);
  }, []);

  const byId = useMemo(() => Object.fromEntries(vocab.map((c) => [c.id, c])), [vocab]);

  // 每日首次生成的 ID 快照固定保存；词库后续变动只补充显示对象，不重抽当天队列。
  const dailyQ = useMemo(() => {
    const restored = restoreDailyQueue(savedSession?.dailyQueue, vocab);
    return restored || buildDailyQueue(vocab);
  }, [savedSession, vocab]);

  // 保存同一天的队列快照和当前断点。完成后保留快照，避免当天再次抽题。
  useEffect(() => {
    if (tab === "review" && phase !== "done" && queue.length) {
      const snapshot = savedSession?.dailyQueue?.date === todayISO()
        ? savedSession.dailyQueue
        : dailyQueueSnapshot(dailyQ);
      const completed = [...new Set([...(snapshot.completedIds || []), ...completedIds])];
      setSavedSession(saveSession({ date: todayISO(), dailyQueue: { ...snapshot, completedIds: completed }, originalQueue, queue, idx, reviewed, phase, r1Res, r2Res, r3Res, retried, completedIds: completed }) || null);
    }
    if (tab === "review" && phase === "done") {
      const snapshot = savedSession?.dailyQueue?.date === todayISO() ? savedSession.dailyQueue : dailyQueueSnapshot(dailyQ);
      const completed = [...new Set([...(snapshot.completedIds || []), ...originalQueue])];
      setSavedSession(saveSession({ date: todayISO(), dailyQueue: { ...snapshot, completedIds: completed }, originalQueue, queue, idx, reviewed, phase, r1Res, r2Res, r3Res, retried, completedIds: completed, completed: true }) || null);
    }
  // savedSession is deliberately omitted: saveSession emits a local-state event.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, queue, idx, reviewed, phase, r1Res, r2Res, r3Res, retried, originalQueue, completedIds]);

  const sectionWords = useMemo(() => vocab.filter((c) => (c.type || "phrase") !== "sentence"), [vocab]);
  const sectionSentences = useMemo(() => vocab.filter((c) => c.type === "sentence"), [vocab]);
  const errorWords = useMemo(() => vocab.filter((c) => (c.error_count || 0) >= 2).sort((a, b) => (b.error_count || 0) - (a.error_count || 0)), [vocab]);
  const resumable = isResumable(savedSession, vocab.map((c) => c.id));
  const todaysCompletedIds = savedSession?.dailyQueue?.date === todayISO()
    ? (savedSession.dailyQueue.completedIds || savedSession.completedIds || [])
    : [];
  const remainingDailyCount = dailyQ.ids.filter((id) => !todaysCompletedIds.includes(id)).length;
  const poolSummary = `今日总任务 ${dailyQ.ids.length} · 新词 ${dailyQ.newCount} · 到期 ${dailyQ.dueCount} · 薄弱 ${dailyQ.weakCount} · 未首次复习积压 ${dailyQ.backlogCount}`;

  const startReview = () => {
    // 断点续学：同一天且队列 id 仍存在 → 恢复上次中断的进度
    const session = loadSession();
    if (isResumable(session, vocab.map((c) => c.id))) {
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
      setSessionMeta(null);
      setTab("review");
      return;
    }
    const existingSnapshot = restoreDailyQueue(session?.dailyQueue, vocab);
    if (session?.dailyQueue?.date === todayISO() && (session.completed || session.phase === "done")) {
      toast({ title: "今日复习已完成", description: "明天会生成新的每日队列。" });
      return;
    }
    const generated = existingSnapshot || buildDailyQueue(vocab);
    const snapshot = existingSnapshot ? session.dailyQueue : dailyQueueSnapshot(generated);
    const finishedIds = new Set(snapshot.completedIds || session?.completedIds || []);
    const ids = generated.ids.filter((id) => !finishedIds.has(id));
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
      date: todayISO(), dailyQueue: snapshot, originalQueue: validIds, queue: [...validIds], idx: 0,
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
    setTab("review");
  };

  const enterPhase = (p) => {
    setQueue([...originalQueue]);
    setIdx(0);
    setReviewed(0);
    setRetried({});
    setPhase(p);
  };

  const onAnswer = (card, correct) => {
    const id = card.id;
    const map = phase === "r1" ? r1Res : phase === "r2" ? r2Res : r3Res;
    const isFirst = map[id] === undefined;
    if (isFirst) {
      if (phase === "r1") setR1Res((m) => ({ ...m, [id]: correct }));
      else if (phase === "r2") setR2Res((m) => ({ ...m, [id]: correct }));
      else setR3Res((m) => ({ ...m, [id]: correct }));
    }

    // 听音阶段首答结算学习计划；三阶段全对才视为本轮掌握。
    // 合并 profile/audio_url/meaning_zh 到同一次 update，减少 API 调用次数。
    if (phase === "r3" && isFirst) {
      const known = !!(r1Res[id] && r2Res[id] && correct);
      const fields = scheduleStage(card, known);
      VocabApi.update(id, fields).catch(() => {});
      setVocab((vs) => vs.map((c) => (c.id === id ? { ...c, ...fields } : c)));
    }

    // 选错(首答)且队尾还有题且本轮未重排 → 追加到队尾再练一次。
    let nextQueue = queue;
    const willAppend = isFirst && !correct && !retried[id] && idx < queue.length - 1;
    if (willAppend) {
      nextQueue = [...queue, id];
      setQueue(nextQueue);
      setRetried((m) => ({ ...m, [id]: true }));
    }

    if (phase === "r3" && !willAppend && !completedIds.includes(id)) {
      setCompletedIds((ids) => ids.includes(id) ? ids : [...ids, id]);
    }

    setReviewed((r) => r + 1);
    const next = idx + 1;
    if (next < nextQueue.length) {
      setIdx(next);
    } else if (phase === "r1") {
      enterPhase("r2");
    } else if (phase === "r2") {
      enterPhase("r3");
    } else {
      setPhase("done");
    }
  };

  const goBack = () => setIdx((i) => Math.max(0, i - 1));

  if (tab === "review" && phase !== "done" && queue[idx] !== undefined) {
    const activeCard = byId[queue[idx]] || { id: queue[idx] };
    const totalErrors = vocab.reduce((s, c) => s + (c.error_count || 0), 0);
    const totalReviews = vocab.reduce((s, c) => s + (c.review_count || 0), 0);
    const errorRate = totalReviews ? Math.round((totalErrors / totalReviews) * 100) : 0;
    return (
      <div className="mx-auto max-w-7xl px-5 lg:px-8 pt-28 pb-20">
        <ReviewHeader reviewed={reviewed} total={originalQueue.length} phase={phase} stage={stageOf(activeCard)} errorRate={errorRate} onExit={() => { setTab("list"); }} />
        {sessionMeta && (sessionMeta.newCount > 0 || sessionMeta.reviewCount > 0) && (
          <p className="mt-2 text-[11px] text-muted-foreground/70">今日队列：复习 {sessionMeta.reviewCount} · 新词 {sessionMeta.newCount}{sessionMeta.deferred > 0 ? ` · 顺延 ${sessionMeta.deferred} 至明日` : ""}</p>
        )}
        <div className="mt-10">
          <Flashcard
            key={queue[idx]}
            mode={phase}
            card={activeCard}
            pool={vocab}
            onAnswer={onAnswer}
            onBack={goBack}
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
    <div className="mx-auto max-w-7xl px-4 lg:px-8 pt-20 pb-16 md:pt-28 md:pb-20">
      <header className="max-w-2xl">
        <p className="mb-2 text-[10px] uppercase tracking-luxe text-copper/80 md:mb-3 md:text-[11px]">语料库</p>
        <h1 className="font-display text-2xl leading-tight text-foreground md:text-5xl">语料库</h1>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground md:mt-3 md:text-sm">收藏你喜欢的单词、短语与台词，按节奏复习复盘——像百词斩那样，但属于电影。</p>
      </header>

      <div className="mt-4 grid grid-cols-4 gap-2 md:mt-8 md:gap-4">
        <Stat icon={BookMarked} value={vocab.length} label="收藏" />
        <Stat icon={Brain} value={dailyQ.ids.length} label="今日任务" highlight />
        <Stat icon={Layers} value={vocab.filter((c) => c.mastery_level === "mastered").length} label="已掌握" />
        <Stat icon={Flame} value={streak(vocab)} label="天数" />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 md:mt-8 md:gap-3">
        <button onClick={startReview} className="inline-flex items-center gap-1.5 rounded-full bg-copper px-4 py-1.5 text-xs font-medium text-copper-foreground transition-transform hover:scale-[1.02] md:px-6 md:py-2.5 md:text-sm">
          <RotateCw size={13} className="md:size-[15px]" /> {resumable ? "继续复习" : "开始复习"} ({remainingDailyCount})
        </button>
        <div className="flex items-center gap-1.5 rounded-full border border-border p-1">
          <Seg active={tab === "list"} onClick={() => setTab("list")}>语料库</Seg>
          <Seg active={tab === "errors"} onClick={() => setTab("errors")}>错词本</Seg>
          <Seg active={tab === "notes"} onClick={() => setTab("notes")}>学习记录</Seg>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground/70">{poolSummary}{dailyQ.deferred > 0 ? ` · 顺延 ${dailyQ.deferred} 至明日` : ""}</p>

      {loading && vocab.length === 0 ? (
        <p className="mt-10 text-sm text-muted-foreground">加载…</p>
      ) : loadError && vocab.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted-foreground">加载失败，可能是网络或速率限制问题。</p>
          <button onClick={reload} className="mt-4 inline-flex items-center gap-1.5 text-sm text-copper hover:underline">
            <RotateCw size={14} /> 重试
          </button>
        </div>
      ) : tab === "notes" ? (
        <NotesList notes={notes} />
      ) : tab === "errors" ? (
        errorWords.length === 0 ? (
          <div className="mt-10 rounded-xl border border-dashed border-border py-12 text-center">
            <AlertTriangle size={22} className="mx-auto text-muted-foreground/60" />
            <p className="mt-3 text-sm text-muted-foreground">还没有高频错词。复习中答错 2 次以上的词会出现在这里。</p>
          </div>
        ) : (
          <div className="mt-6 md:mt-8">
            <h2 className="font-display text-base text-foreground md:text-lg">高频错词 <span className="text-xs font-body text-muted-foreground md:text-sm">· {errorWords.length}</span></h2>
            <div className="mt-3 grid grid-cols-2 gap-2 md:mt-4 md:gap-3 sm:grid-cols-4">
              {errorWords.map((c) => <VocabCard key={c.id} c={c} onGone={reload} onDelete={(id) => VocabApi.delete(id)} />)}
            </div>
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
                {sectionWords.map((c) => <VocabCard key={c.id} c={c} onGone={reload} onDelete={(id) => VocabApi.delete(id)} />)}
              </div>
            </section>
          )}
          {sectionSentences.length > 0 && (
            <section>
              <h2 className="font-display text-base text-foreground md:text-lg">句子 <span className="text-xs font-body text-muted-foreground md:text-sm">· {sectionSentences.length}</span></h2>
              <div className="mt-3 grid grid-cols-2 gap-2 md:mt-4 md:gap-3 sm:grid-cols-4">
                {sectionSentences.map((c) => <VocabCard key={c.id} c={c} onGone={reload} onDelete={(id) => VocabApi.delete(id)} />)}
              </div>
            </section>
          )}
          {sectionWords.length === 0 && sectionSentences.length === 0 && <Empty />}
        </div>
      )}
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

function Stat({ icon: Icon, value, label, highlight }) {
  return (
    <div className={`rounded-lg border md:rounded-xl ${highlight ? "border-copper/40 bg-copper/8" : "border-border/60 bg-card"} px-1.5 py-2 md:px-4 md:py-4`}>
      <Icon size={11} className={highlight ? "text-copper" : "text-muted-foreground"} />
      <p className="mt-0.5 font-display text-sm text-foreground md:mt-1.5 md:text-2xl">{value}</p>
      <p className="text-[9px] uppercase tracking-luxe text-muted-foreground md:text-[11px]">{label}</p>
    </div>
  );
}

function Seg({ active, onClick, children }) {
  return (
    <button onClick={onClick} className={`rounded-full px-4 py-1 text-[13px] transition-colors ${active ? "bg-copper text-copper-foreground" : "text-muted-foreground hover:text-foreground"}`}>{children}</button>
  );
}

function VocabCard({ c, onGone, onDelete }) {
  const m = MASTERY[c.mastery_level] || MASTERY.new;
  return (
    <div className="group rounded-lg border border-border/60 bg-card p-2 md:rounded-xl md:p-4">
      <div className="flex items-start justify-between gap-1.5">
        <p className="font-display text-xs leading-snug text-foreground md:text-base">{c.expression_en || c.text_en}</p>
        <DeleteChip id={c.id} onGone={onGone} onDelete={onDelete} />
      </div>
      {(c.meaning_zh || c.text_zh) && <p className="mt-0.5 text-[11px] text-muted-foreground md:text-sm">{c.meaning_zh || c.text_zh}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[9px] md:mt-2.5 md:gap-1.5 md:text-[11px]">
        <span className={`rounded-full px-1 py-0.5 md:px-2 ${m.className}`}>{m.label}</span>
        {c.type && <span className="rounded-full bg-background-elev px-1 py-0.5 md:px-2">{typeLabel(c.type)}</span>}
        {(c.error_count || 0) >= 1 && <span className="rounded-full bg-rose-500/10 px-1 py-0.5 text-rose-300/90 md:px-2">错 {c.error_count}</span>}
        {(c.stage || 0) > 0 && <span className="rounded-full bg-mint/10 px-1 py-0.5 text-mint/90 md:px-2">{STAGE_LABELS[c.stage] || ""}</span>}
        {c.timestamp && <span className="font-mono text-copper/70">{c.timestamp}</span>}
      </div>
      {c.source_movie_title && <p className="mt-1 text-[9px] text-muted-foreground/70 md:mt-1.5 md:text-[11px]">— {c.source_movie_title}</p>}
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

function NotesList({ notes }) {
  if (notes.length === 0) return <p className="mt-10 text-sm text-muted-foreground">还没有学习记录。在场景里写下的笔记会出现在这里。</p>;
  return (
    <ul className="mt-8 space-y-3">
      {notes.map((n) => (
        <li key={n.id} className="rounded-xl border border-border/60 bg-card p-5">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{n.movie_title || "学习记录"}</span>
            <span className="font-mono text-copper/70">{n.timestamp}</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{n.content}</p>
        </li>
      ))}
    </ul>
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
        <button onClick={onExit} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-copper">
          退出 <ArrowRight size={14} />
        </button>
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
