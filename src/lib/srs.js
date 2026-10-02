// Spaced-repetition (SM-2 simplified) + helpers for the personal review system.

export function difficultyLabel(level) {
  switch (level) {
    case 'beginner': return '入门';
    case 'intermediate': return '进阶';
    case 'advanced': return '高阶';
    default: return '进阶';
  }
}

export function difficultyColor(level) {
  switch (level) {
    case 'beginner': return 'text-emerald-300/90';
    case 'intermediate': return 'text-amber-300/90';
    case 'advanced': return 'text-rose-300/90';
    default: return 'text-amber-300/90';
  }
}

export function categoryLabel(c) {
  switch (c) {
    case 'series': return '剧集';
    case 'film': return '电影';
    case 'animation': return '动画';
    case 'indie': return '独立电影';
    default: return '影视';
  }
}

export function vocabTypeLabel(t) {
  switch (t) {
    case 'word': return '单词';
    case 'phrase': return '短语';
    case 'sentence': return '整句';
    default: return '短语';
  }
}

// quality: 0 Again / 3 Hard / 4 Good / 5 Easy
export function scheduleReview(card, quality) {
  let ef = card.ease_factor ?? 2.5;
  let interval = card.interval_days ?? 0;
  const count = (card.review_count ?? 0) + 1;

  if (quality < 3) {
    interval = 0;
  } else if (interval === 0) {
    interval = 1;
  } else if (interval === 1) {
    interval = 6;
  } else {
    interval = Math.round(interval * ef);
  }

  ef = ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (ef < 1.3) ef = 1.3;
  if (ef > 3.0) ef = 3.0;

  const status =
    quality < 3
      ? 'learning'
      : interval >= 14 && count >= 3
      ? 'mastered'
      : 'learning';

  return {
    ease_factor: Math.round(ef * 100) / 100,
    interval_days: interval,
    review_count: count,
    review_status: status,
    last_reviewed: new Date().toISOString(),
    next_review: new Date(Date.now() + interval * 86400000).toISOString(),
  };
}

export function isDue(vocab) {
  if (!vocab.next_review) return true;
  return new Date(vocab.next_review).getTime() <= Date.now();
}

export function daysBetween(a, b) {
  return Math.floor((new Date(b) - new Date(a)) / 86400000);
}

// Streak handling — stored on user profile via updateMe.
export function bumpStreak(stats, today = new Date()) {
  const last = stats.last_study_date ? new Date(stats.last_study_date) : null;
  const todayStr = today.toISOString().slice(0, 10);
  let streak = stats.streak_count || 0;
  let total = (stats.total_study_days || 0);

  if (!last) {
    streak = 1;
    total = 1;
  } else {
    const lastStr = last.toISOString().slice(0, 10);
    if (lastStr === todayStr) {
      // already studied today; keep streak
    } else {
      const gap = daysBetween(last, today);
      streak = gap === 1 ? streak + 1 : 1;
      total += 1;
    }
  }
  return {
    streak_count: streak,
    last_study_date: today.toISOString(),
    total_study_days: total,
  };
}

export function formatDate(d) {
  if (!d) return '';
  const date = new Date(d);
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

// ===== 5 阶段艾宾浩斯复习调度 =====
// stage 0 当天(10 分钟)→ 1 天 → 2 天 → 4 天 → 7 天 → 15 天及以上(长期记忆)
export const STAGE_INTERVALS = [0, 1, 2, 4, 7, 15];
export const STAGE_LABELS = ["新词", "一轮", "二轮", "三轮", "四轮", "长期记忆"];
export const DAILY_REVIEW_GOAL = 40;
export const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14, 30, 60];
const NORMAL_QUOTA = { new: 20, due: 15, weak: 5 };
const BACKLOG_QUOTA = { new: 24, due: 12, weak: 4 };

export function stageOf(card) {
  const s = Number(card?.stage);
  return Number.isInteger(s) && s >= 0 && s <= 5 ? s : 0;
}

export function localDateKey(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const reviewCountOf = (card) => Number(card?.reviewCount ?? card?.review_count ?? 0);
const correctCountOf = (card) => Number(card?.correctCount ?? card?.correct_count ?? 0);
const wrongCountOf = (card) => Number(card?.wrongCount ?? card?.wrong_count ?? card?.error_count ?? 0);
const nextReviewOf = (card) => card?.nextReviewAt ?? card?.next_review_date ?? card?.next_review ?? null;
const lastReviewedOf = (card) => card?.lastReviewedAt ?? card?.last_reviewed_date ?? card?.last_reviewed ?? null;

function lastWrongAt(card) {
  const history = Array.isArray(card?.review_history) ? card.review_history : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (item?.result === "wrong" || item?.correct === false) return item.date || item.at || null;
  }
  return null;
}

function hasRecentWrong(card, now) {
  const wrongCount = wrongCountOf(card);
  if (!wrongCount) return false;
  const lastWrong = lastWrongAt(card) || lastReviewedOf(card);
  const time = Date.parse(lastWrong || "");
  return Number.isFinite(time) && time <= now && now - time <= 7 * 86400000;
}

function hasHighErrorRate(card, now) {
  const history = Array.isArray(card?.review_history) ? card.review_history : [];
  const recent = history.slice(-5);
  if (recent.length >= 2) {
    const wrong = recent.filter((item) => item?.result === "wrong" || item?.correct === false).length;
    return wrong / recent.length >= 0.4;
  }
  const reviews = reviewCountOf(card);
  const last = Date.parse(lastReviewedOf(card) || "");
  return reviews >= 2 && wrongCountOf(card) / reviews >= 0.4
    && Number.isFinite(last) && now - last <= 30 * 86400000;
}

function dailyTieBreak(card, date) {
  // Stable for the current day (including refreshes), but changes the ranking
  // between days so a large pool does not keep serving the same first IDs.
  const input = `${date}:${card?.id || card?.expression_en || ""}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
  return hash >>> 0;
}

export function isNewReviewItem(card) {
  return reviewCountOf(card) <= 0;
}

export function normalizeVocabularyProgress(card = {}) {
  const history = Array.isArray(card.review_history) ? card.review_history : [];
  const historyCorrect = history.filter((item) => item?.result === "correct" || item?.correct === true).length;
  const historyWrong = history.filter((item) => item?.result === "wrong" || item?.correct === false).length;
  const reviewCount = Math.max(reviewCountOf(card), history.length, Number(card.stage) || 0);
  const correctCount = Math.max(correctCountOf(card), historyCorrect);
  const wrongCount = Math.max(wrongCountOf(card), historyWrong);
  const intervalDays = Number(card.intervalDays ?? card.interval_days ?? STAGE_INTERVALS[stageOf(card)] ?? 0);
  const lastReviewedAt = lastReviewedOf(card);
  const nextReviewAt = nextReviewOf(card);
  const mastery = card.mastery_level || card.masteryLevel
    || (intervalDays >= 60 ? "mastered" : intervalDays >= 14 ? "familiar" : reviewCount ? "learning" : "new");
  const status = card.status || card.review_status || mastery;
  return {
    ...card,
    reviewCount,
    correctCount,
    wrongCount,
    lastReviewedAt,
    nextReviewAt,
    intervalDays,
    status,
    review_count: reviewCount,
    correct_count: correctCount,
    error_count: wrongCount,
    last_reviewed_at: lastReviewedAt,
    last_reviewed_date: lastReviewedAt,
    next_review_at: nextReviewAt,
    next_review_date: nextReviewAt,
    interval_days: intervalDays,
    mastery_level: mastery,
    review_status: status,
    review_history: history,
  };
}

function normalizedLogHistory(card, logsByVocabulary) {
  const logs = logsByVocabulary?.get(card.id) || [];
  const history = logs.map((log) => ({
    date: log.reviewed_at,
    result: log.is_correct ? "correct" : "wrong",
    rating: log.rating,
  }));
  if (history.length) return history;
  return Array.isArray(card.review_history) ? card.review_history : [];
}

/** A single historical miss is always included, but the tier decays with recent mastery. */
export function classifyMistakeTiers(vocab, reviewLogs = [], now = Date.now()) {
  const instant = now instanceof Date ? now.getTime() : Number(now);
  const byVocabulary = new Map();
  for (const log of reviewLogs || []) {
    const list = byVocabulary.get(log.vocabulary_id) || [];
    list.push(log);
    byVocabulary.set(log.vocabulary_id, list);
  }
  const tiers = { occasional: [], weak: [], focus: [] };
  for (const card of vocab || []) {
    const history = normalizedLogHistory(card, byVocabulary).slice().sort((a, b) => Date.parse(a.reviewed_at || a.date || 0) - Date.parse(b.reviewed_at || b.date || 0));
    const wrongs = history.filter((item) => item?.result === "wrong" || item?.correct === false);
    if (!wrongs.length && wrongCountOf(card) <= 0) continue;
    const recent = history.slice(-10);
    const recentWrong = recent.filter((item) => item?.result === "wrong" || item?.correct === false).length;
    const recentHard = recent.filter((item) => Number(item?.rating) === 3).length;
    const recentRate = recent.length ? (recent.length - recentWrong) / recent.length : 1;
    let consecutiveWrong = 0;
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (history[i]?.result === "wrong" || history[i]?.correct === false) consecutiveWrong += 1;
      else break;
    }
    const lastReviewed = Date.parse(history.at(-1)?.reviewed_at || history.at(-1)?.date || lastReviewedOf(card) || 0);
    const overdueDays = Date.parse(nextReviewOf(card) || 0) < instant
      ? Math.floor((instant - Date.parse(nextReviewOf(card))) / 86400000)
      : 0;
    const stableNow = recent.length >= 3 && recentRate >= 0.8 && consecutiveWrong === 0
      && (instant - (Number.isFinite(lastReviewed) ? lastReviewed : instant) < 30 * 86400000);
    const item = { ...card, mistakeStats: { totalWrong: Math.max(wrongs.length, wrongCountOf(card)), recent, recentRate, consecutiveWrong, overdueDays } };
    if (stableNow) tiers.occasional.push(item);
    else if (consecutiveWrong >= 2 || (recent.length >= 3 && recentRate < 0.5) || (overdueDays >= 30 && recentRate < 0.8)) tiers.focus.push(item);
    else if (recentWrong > 0 || (recent.length && recentHard / recent.length >= 0.3) || recentRate < 0.8) tiers.weak.push(item);
    else tiers.occasional.push(item);
  }
  return tiers;
}

export function classifyReviewPools(vocab, now = Date.now()) {
  const instant = now instanceof Date ? now.getTime() : Number(now);
  const today = localDateKey(instant);
  const candidates = (vocab || []).filter((card) => (card?.meaning_zh || card?.text_zh) && (card?.expression_en || card?.text_en));
  const pools = { new: [], due: [], weak: [] };
  for (const card of candidates) {
    if (isNewReviewItem(card)) {
      pools.new.push(card);
      continue;
    }
    if (hasRecentWrong(card, instant) || hasHighErrorRate(card, instant)) {
      pools.weak.push(card);
      continue;
    }
    const nextReview = nextReviewOf(card);
    const due = !nextReview || !Date.parse(nextReview) || localDateKey(nextReview) <= today;
    if (due) pools.due.push(card);
  }
  const byDailyTieBreak = (a, b) => dailyTieBreak(a, today) - dailyTieBreak(b, today);
  pools.new.sort(byDailyTieBreak);
  pools.due.sort((a, b) => Date.parse(nextReviewOf(a) || 0) - Date.parse(nextReviewOf(b) || 0) || byDailyTieBreak(a, b));
  pools.weak.sort((a, b) => {
    const aRate = wrongCountOf(a) / Math.max(reviewCountOf(a), 1);
    const bRate = wrongCountOf(b) / Math.max(reviewCountOf(b), 1);
    return bRate - aRate || Date.parse(lastWrongAt(b) || lastReviewedOf(b) || 0) - Date.parse(lastWrongAt(a) || lastReviewedOf(a) || 0) || byDailyTieBreak(a, b);
  });
  return pools;
}

function nextIntervalDays(previous, correct) {
  const interval = Math.max(0, Number(previous) || 0);
  if (correct) return REVIEW_INTERVAL_DAYS.find((days) => days > interval) || REVIEW_INTERVAL_DAYS.at(-1);
  if (interval >= 60) return 14;
  if (interval >= 30) return 7;
  if (interval >= 14) return 3;
  if (interval >= 7) return 1;
  return 1;
}

function stageForInterval(intervalDays) {
  if (intervalDays >= 60) return 5;
  if (intervalDays >= 14) return 4;
  if (intervalDays >= 7) return 3;
  if (intervalDays >= 3) return 2;
  return 1;
}

// 复习在三阶段全部完成时结算一次；兼容旧 snake_case 字段并同时写入规范字段。
export function scheduleStage(card, correct, reviewedAt = new Date()) {
  const at = reviewedAt instanceof Date ? reviewedAt : new Date(reviewedAt);
  const iso = at.toISOString();
  const oldReviewCount = reviewCountOf(card);
  const oldCorrectCount = correctCountOf(card);
  const oldWrongCount = wrongCountOf(card);
  const previousInterval = Number(card?.intervalDays ?? card?.interval_days ?? 0);
  // Each submitted answer is a persisted review event, including answers in
  // different question modes on the same day. Keep the prior due date for the
  // log separately; the vocabulary summary always reflects the latest answer.
  const intervalDays = nextIntervalDays(previousInterval, Boolean(correct));
  const nextReviewAt = new Date(at.getTime() + intervalDays * 86400000).toISOString();
  const reviewCount = oldReviewCount + 1;
  const correctCount = oldCorrectCount + (correct ? 1 : 0);
  const wrongCount = oldWrongCount + (correct ? 0 : 1);
  const status = intervalDays >= 60 ? "mastered" : intervalDays >= 14 ? "review" : "learning";
  const mastery = intervalDays >= 60 ? "mastered" : intervalDays >= 14 ? "familiar" : "learning";
  const history = Array.isArray(card.review_history) ? [...card.review_history] : [];
  history.push({ date: iso, result: correct ? "correct" : "wrong" });
  if (history.length > 50) history.splice(0, history.length - 50);
  const stage = stageForInterval(intervalDays);
  return {
    stage,
    reviewCount,
    correctCount,
    wrongCount,
    lastReviewedAt: iso,
    nextReviewAt,
    intervalDays,
    status,
    review_count: reviewCount,
    correct_count: correctCount,
    wrong_count: wrongCount,
    error_count: wrongCount,
    last_reviewed_date: iso,
    next_review_date: nextReviewAt,
    interval_days: intervalDays,
    review_status: status,
    review_history: history,
    mastery_level: mastery,
    last_reviewed_at: iso,
    next_review_at: nextReviewAt,
  };
}

export function buildDailyQueue(vocab, now = Date.now(), goal = DAILY_REVIEW_GOAL) {
  const pools = classifyReviewPools(vocab, now);
  const backlogMode = pools.new.length > 100;
  const quotas = backlogMode ? BACKLOG_QUOTA : NORMAL_QUOTA;
  const selected = {
    new: pools.new.slice(0, quotas.new),
    due: pools.due.slice(0, quotas.due),
    weak: pools.weak.slice(0, quotas.weak),
  };
  let remaining = Math.max(0, Math.floor(goal) - Object.values(selected).reduce((sum, items) => sum + items.length, 0));
  for (const poolName of ["due", "weak", "new"]) {
    if (!remaining) break;
    const alreadySelected = selected[poolName].length;
    const extra = pools[poolName].slice(alreadySelected, alreadySelected + remaining);
    selected[poolName].push(...extra);
    remaining -= extra.length;
  }
  const sourceIds = Object.fromEntries(Object.entries(selected).map(([name, items]) => [name, items.map((item) => item.id)]));
  const ids = ["new", "due", "weak"].flatMap((name) => sourceIds[name]);
  const byId = new Map((vocab || []).map((item) => [item.id, item]));
  const queue = ids.map((id) => byId.get(id)).filter(Boolean);
  const counts = { new: sourceIds.new.length, due: sourceIds.due.length, weak: sourceIds.weak.length };
  const backlogCount = pools.new.length;
  return {
    date: localDateKey(now),
    goal: Math.floor(goal),
    backlogMode,
    queue,
    ids,
    sourceIds,
    counts,
    newCount: counts.new,
    dueCount: counts.due,
    weakCount: counts.weak,
    reviewCount: counts.due + counts.weak,
    backlogCount,
    totalDue: pools.due.length + pools.weak.length,
    deferred: Math.max(0, pools.new.length + pools.due.length + pools.weak.length - ids.length),
  };
}

export function dailyQueueSnapshot(dailyQueue, now = Date.now()) {
  return {
    date: dailyQueue.date || localDateKey(now),
    goal: dailyQueue.goal || DAILY_REVIEW_GOAL,
    backlogMode: Boolean(dailyQueue.backlogMode),
    ids: [...(dailyQueue.ids || dailyQueue.queue?.map((item) => item.id) || [])],
    sourceIds: {
      new: [...(dailyQueue.sourceIds?.new || [])],
      due: [...(dailyQueue.sourceIds?.due || [])],
      weak: [...(dailyQueue.sourceIds?.weak || [])],
    },
    counts: { ...(dailyQueue.counts || { new: dailyQueue.newCount || 0, due: dailyQueue.dueCount || 0, weak: dailyQueue.weakCount || 0 }) },
    backlogAtGeneration: dailyQueue.backlogCount || 0,
    completedIds: [...(dailyQueue.completedIds || [])],
    generatedAt: dailyQueue.generatedAt || new Date(now instanceof Date ? now.getTime() : Number(now)).toISOString(),
  };
}

export function restoreDailyQueue(snapshot, vocab, now = Date.now()) {
  if (!snapshot || snapshot.date !== localDateKey(now)) return null;
  const byId = new Map((vocab || []).map((item) => [item.id, item]));
  const ids = (snapshot.ids || []).filter((id) => byId.has(id));
  const sourceIds = Object.fromEntries(["new", "due", "weak"].map((name) => [name, (snapshot.sourceIds?.[name] || []).filter((id) => byId.has(id))]));
  const counts = Object.fromEntries(["new", "due", "weak"].map((name) => [name, sourceIds[name].length]));
  const pools = classifyReviewPools(vocab, now);
  return {
    ...snapshot,
    ids,
    sourceIds,
    counts,
    queue: ids.map((id) => byId.get(id)),
    newCount: counts.new,
    dueCount: counts.due,
    weakCount: counts.weak,
    reviewCount: counts.due + counts.weak,
    backlogCount: pools.new.length,
    deferred: Math.max(0, pools.new.length + pools.due.length + pools.weak.length - ids.length),
  };
}
