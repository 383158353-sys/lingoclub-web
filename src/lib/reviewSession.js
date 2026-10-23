// 复习会话断点续学：把当前队列/索引/阶段/对错记录存 localStorage，
// 用户退出后再次进入「开始复习」时自动恢复到上次中断的位置。
import { advanceReviewQuestion } from "./reviewFlow.js";
import { notifyLocalStateChanged, scopedStorageKey } from "./userStorage.js";
import { localDateKey } from "./srs.js";

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

// 会话是否仍可恢复：同一天 + 队列 id 仍存在于当前词库（避免删除/迁移后恢复到无效卡片）。
export function isResumable(session, vocabIds, now = Date.now()) {
  if (!session || session.completed || session.phase === "done" || !Array.isArray(session.queue) || !session.queue.length) return false;
  if (session.date !== localDateKey(now) || Number(session.idx || 0) >= session.queue.length) return false;
  const idSet = new Set(vocabIds);
  return session.queue.every((id) => idSet.has(id));
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
