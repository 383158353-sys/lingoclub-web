const AI_CACHE_TASKS = new Set(["word_lookup", "translate_sentence", "vocabulary_analysis", "generate_distractors", "subtitle_batch"]);
const AI_CACHE_PREFIX = "lingoclub:ai:v1:";
const AI_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const aiInflight = new Map();

function hashKey(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function aiCacheKey(task, payload) {
  if (!AI_CACHE_TASKS.has(task)) return null;
  const videoId = String(payload.video_id || "local").trim();
  const subtitleText = String(payload.subtitle_text || payload.text_en || payload.expression_en || "").trim();
  if (!subtitleText) return null;
  const expression = String(payload.expression_en || "").trim();
  return `${AI_CACHE_PREFIX}${hashKey(`${task}|${videoId}|${payload.cache_key || subtitleText}|${expression}`)}`;
}

function readAiCache(key) {
  if (!key) return null;
  try {
    if (typeof localStorage === "undefined") return null;
    const cached = JSON.parse(localStorage.getItem(key) || "null");
    if (!cached?.savedAt || Date.now() - cached.savedAt > AI_CACHE_TTL_MS || !cached.response) return null;
    return cached.response;
  } catch {
    return null;
  }
}

function writeAiCache(key, response) {
  if (!key || !response) return;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), response }));
  } catch { /* storage is optional */ }
}

async function postJson(path, body, { signal, timeoutMs = 26000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reasons = Array.isArray(data?.errors) ? data.errors.map((item) => `${item.extractor}: ${item.message}`).join("；") : "";
      const error = new Error([data?.error || `请求失败 (${response.status})`, reasons].filter(Boolean).join("："));
      error.status = response.status;
      error.details = data;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export async function invokeAI(task, payload = {}, options = {}) {
  const cacheKey = aiCacheKey(task, payload);
  const cached = readAiCache(cacheKey);
  if (cached) return cached;
  if (cacheKey && aiInflight.has(cacheKey)) return aiInflight.get(cacheKey);
  const request = postJson("/api/ai", { task, ...payload }, options)
    .then((response) => { writeAiCache(cacheKey, response); return response; })
    .finally(() => { if (cacheKey) aiInflight.delete(cacheKey); });
  if (cacheKey) aiInflight.set(cacheKey, request);
  return request;
}

export const fetchYouTubeTranscript = (url, options) =>
  postJson("/api/youtube-transcript", { url }, options);

export async function fetchYouTubeMeta(url, { signal } = {}) {
  const endpoint = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
  const response = await fetch(endpoint, { signal });
  if (!response.ok) throw new Error("无法获取 YouTube 视频信息");
  const data = await response.json();
  return { title: data?.title || "", thumbnail_url: data?.thumbnail_url || "" };
}
