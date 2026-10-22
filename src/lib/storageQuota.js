// localStorage 配额保护：只清理可再生的缓存，绝不删除用户数据（影片、收藏、进度）。
export const TRANSCRIPT_CACHE_PREFIX = "lingoclub:youtube-transcript:v3:";
export const TRANSCRIPT_CACHE_MAX_ENTRIES = 10;
export const TRANSCRIPT_CACHE_MAX_CHARS = 750_000; // UTF-16 ≈ 1.5MB
// 已废弃的缓存前缀（版本升级后遗留）。
export const OBSOLETE_PREFIXES = ["lingoclub:youtube-transcript:v1:", "lingoclub:youtube-transcript:v2:", "lingoclub:subtitle-ai:v1:"];
// 可随时删除、可重新生成的缓存前缀。
export const CACHE_PREFIXES = ["lingoclub:youtube-transcript:", "lingoclub:subtitle-ai:", "lingoclub:ai:v1:"];

function storage() {
  try { return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage; } catch { return null; }
}

export function isQuotaError(error) {
  if (!error) return false;
  const name = String(error.name || "");
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED"
    || error.code === 22 || error.code === 1014 || /quota/i.test(String(error.message || ""));
}

function keysWithPrefixes(prefixes) {
  const ls = storage();
  if (!ls) return [];
  const keys = [];
  for (let i = 0; i < ls.length; i += 1) {
    const key = ls.key(i);
    if (key && prefixes.some((p) => key.startsWith(p))) keys.push(key);
  }
  return keys;
}

function removeKeys(keys) {
  const ls = storage();
  let n = 0;
  for (const key of keys) { try { ls.removeItem(key); n += 1; } catch { /* noop */ } }
  return n;
}

/** 启动时清理废弃缓存，返回删除条数。 */
export function cleanupObsoleteStorage() {
  try { return removeKeys(keysWithPrefixes(OBSOLETE_PREFIXES)); } catch { return 0; }
}

/** 清空所有可再生缓存（不碰用户数据）。 */
export function clearRegenerableCaches() {
  try { return removeKeys(keysWithPrefixes(CACHE_PREFIXES)); } catch { return 0; }
}

/** 写入 localStorage；配额满时先清缓存再重试一次，仍失败则抛出原错误。 */
export function setItemWithCacheEviction(key, value) {
  const ls = storage();
  if (!ls) throw new Error("本地存储不可用");
  try {
    ls.setItem(key, value);
  } catch (error) {
    if (!isQuotaError(error)) throw error;
    clearRegenerableCaches();
    ls.setItem(key, value);
  }
}

function transcriptEntries() {
  const ls = storage();
  return keysWithPrefixes([TRANSCRIPT_CACHE_PREFIX]).map((key) => {
    const raw = ls.getItem(key) || "";
    let usedAt = 0;
    try { const v = JSON.parse(raw); usedAt = Number(v?.usedAt || v?.savedAt || 0); } catch { /* corrupt → oldest */ }
    return { key, size: key.length + raw.length, usedAt };
  }).sort((a, b) => a.usedAt - b.usedAt);
}

/** LRU 淘汰：保留最近使用的条目，满足条数和体积上限（为即将写入的条目预留空间）。 */
export function enforceTranscriptCacheLimit(incomingChars = 0, keepKey = null) {
  try {
    const entries = transcriptEntries().filter((e) => e.key !== keepKey);
    let count = entries.length + (incomingChars ? 1 : 0);
    let total = entries.reduce((s, e) => s + e.size, 0) + incomingChars;
    const evict = [];
    for (const e of entries) {
      if (count <= TRANSCRIPT_CACHE_MAX_ENTRIES && total <= TRANSCRIPT_CACHE_MAX_CHARS) break;
      evict.push(e.key); count -= 1; total -= e.size;
    }
    return removeKeys(evict);
  } catch { return 0; }
}

/** 字幕缓存写入：从不抛错。 */
export function writeTranscriptCache(videoId, lines) {
  const ls = storage();
  if (!ls || !videoId) return false;
  const key = `${TRANSCRIPT_CACHE_PREFIX}${videoId}`;
  let value;
  try { value = JSON.stringify({ savedAt: Date.now(), usedAt: Date.now(), lines }); } catch { return false; }
  if (key.length + value.length > TRANSCRIPT_CACHE_MAX_CHARS) return false; // 单条过大，不缓存
  try {
    enforceTranscriptCacheLimit(key.length + value.length, key);
    try { ls.setItem(key, value); } catch (error) {
      if (!isQuotaError(error)) return false;
      removeKeys(keysWithPrefixes([TRANSCRIPT_CACHE_PREFIX]));
      ls.setItem(key, value);
    }
    return true;
  } catch { return false; }
}

export const STORAGE_FULL_MESSAGE = "手机浏览器的本地存储空间已满，已自动清理缓存但仍无法保存。请删除几部不再看的影片后重试，已保存的影片和收藏不受影响。";

let lastToastAt = 0;
let lastToastKey = "";
/** 同一条提示 4 秒内只显示一次。 */
export function shouldShowToast(key, now = Date.now(), windowMs = 4000) {
  if (key === lastToastKey && now - lastToastAt < windowMs) return false;
  lastToastKey = key; lastToastAt = now;
  return true;
}
