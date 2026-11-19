// 复习会话断点续学：把当前队列/索引/阶段/对错记录存 localStorage，
// 用户退出后再次进入「开始复习」时自动恢复到上次中断的位置。
import { advanceReviewQuestion } from "./reviewFlow.js";
import { notifyLocalStateChanged, scopedStorageKey } from "./userStorage.js";

const KEY = "lingoclub_review_session_v1";

export function loadSession() {
  try {
    const raw = localStorage.getItem(scopedStorageKey(KEY));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveSession(state) {
  try {
    const saved = { ...state, savedAt: new Date().toISOString() };
    localStorage.setItem(scopedStorageKey(KEY), JSON.stringify(saved));
    notifyLocalStateChanged();
    return saved;
  } catch { /* noop */ }
  return null;
}

export function clearSession() {
  try { localStorage.removeItem(scopedStorageKey(KEY)); notifyLocalStateChanged(); } catch { /* noop */ }
}

// A checkpoint remains resumable until it is completed or its cards disappear.
export function isResumable(session, vocabIds) {
  if (!session || session.completed || session.phase === "done" || !Array.isArray(session.queue) || !session.queue.length) return false;
  if (Number(session.idx || 0) >= session.queue.length) return false;
  const idSet = new Set(vocabIds);
  return session.queue.every((id) => idSet.has(id));
}

export function canResumeSession(session, vocabIds, mode) {
  if (!isResumable(session, vocabIds)) return false;
  return mode === "resume" || (session.reviewMode || "daily") === mode;
}

function dropId(list, id) {
  return Array.isArray(list) ? list.filter((item) => item !== id) : list;
}

// 斩：从当天队列拿掉这张卡。当前题被拿掉时下一张顶上，不把整轮打回第一题。
// 断点是否可恢复仍只由 isResumable 判断。
export function buryCardInSession(session, id) {
  if (!session || id == null) return session;
  const dailyQueue = session.dailyQueue ? {
    ...session.dailyQueue,
    ids: dropId(session.dailyQueue.ids, id),
    completedIds: [...new Set([...(session.dailyQueue.completedIds || []), id])],
    sourceIds: session.dailyQueue.sourceIds
      ? Object.fromEntries(Object.entries(session.dailyQueue.sourceIds).map(([name, list]) => [name, dropId(list, id)]))
      : session.dailyQueue.sourceIds,
  } : session.dailyQueue;
  const completedIds = [...new Set([...(session.completedIds || []), id])];
  if (!Array.isArray(session.queue) || !session.queue.includes(id)) {
    return { ...session, dailyQueue, completedIds };
  }
  const position = session.queue.indexOf(id);
  const queue = dropId(session.queue, id);
  const originalQueue = dropId(session.originalQueue || session.queue, id);
  let idx = Number(session.idx || 0);
  if (position >= 0 && position < idx) idx -= 1;
  if (idx < queue.length) {
    return { ...session, dailyQueue, completedIds, queue, originalQueue, idx };
  }
  const advanced = advanceReviewQuestion({ phase: session.phase || "r1", idx: 0, queueLength: 0 });
  return {
    ...session,
    dailyQueue,
    completedIds,
    originalQueue,
    queue: advanced.phase === "done" ? queue : [...originalQueue],
    idx: 0,
    phase: advanced.phase,
    completed: advanced.done || Boolean(session.completed),
  };
}

export function deleteCardFromSession(session, id) {
  if (!session || id == null) return session;
  const removeCardResult = (values) => {
    if (!values || typeof values !== "object") return values;
    const next = { ...values };
    delete next[id];
    return next;
  };
  const dailyQueue = session.dailyQueue ? {
    ...session.dailyQueue,
    ids: dropId(session.dailyQueue.ids, id),
    completedIds: dropId(session.dailyQueue.completedIds, id),
    sourceIds: session.dailyQueue.sourceIds
      ? Object.fromEntries(Object.entries(session.dailyQueue.sourceIds).map(([name, list]) => [name, dropId(list, id)]))
      : session.dailyQueue.sourceIds,
  } : session.dailyQueue;
  const completedIds = dropId(session.completedIds, id);
  const queue = dropId(session.queue, id);
  const originalQueue = dropId(session.originalQueue || session.queue, id);
  const position = Array.isArray(session.queue) ? session.queue.indexOf(id) : -1;
  const next = {
    ...session, dailyQueue, completedIds, queue, originalQueue,
    r1Res: removeCardResult(session.r1Res),
    r2Res: removeCardResult(session.r2Res),
    r3Res: removeCardResult(session.r3Res),
    retried: removeCardResult(session.retried),
  };
  if (!originalQueue.length) return { ...next, idx: 0, phase: "done", completed: true };
  if (position < 0) return next;

  let idx = Number(session.idx || 0);
  if (position < idx) idx -= 1;
  if (idx < queue.length) return { ...next, idx };

  const advanced = advanceReviewQuestion({ phase: session.phase || "r1", idx: 0, queueLength: 0 });
  return {
    ...next,
    queue: advanced.done ? queue : [...originalQueue],
    idx: 0,
    phase: advanced.phase,
    reviewed: 0,
    retried: {},
    completed: advanced.done || Boolean(session.completed),
  };
}
