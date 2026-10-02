const USER_PREFIX = "lingoclub_user_";
let activeUserId = null;
let notificationSuppressionDepth = 0;

export function setActiveStorageUser(userId) {
  activeUserId = userId ? String(userId) : null;
}

export function getActiveStorageUser() {
  return activeUserId;
}

export function scopedStorageKey(key, userId = activeUserId) {
  return userId ? `${USER_PREFIX}${userId}_${key}` : key;
}

export function notifyLocalStateChanged() {
  if (notificationSuppressionDepth > 0) return;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("lingoclub:local-state-changed"));
}

export async function withoutLocalStateNotifications(task) {
  notificationSuppressionDepth += 1;
  try {
    return await task();
  } finally {
    notificationSuppressionDepth = Math.max(0, notificationSuppressionDepth - 1);
  }
}
