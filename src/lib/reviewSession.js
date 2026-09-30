// 复习会话断点续学：把当前队列/索引/阶段/对错记录存 localStorage，
// 用户退出后再次进入「开始复习」时自动恢复到上次中断的位置。
import { notifyLocalStateChanged, scopedStorageKey } from "./userStorage";
import { localDateKey } from "./srs";

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
