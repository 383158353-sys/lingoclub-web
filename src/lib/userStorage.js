const USER_PREFIX = "lingoclub_user_";
let activeUserId = null;

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
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("lingoclub:local-state-changed"));
}
