const AI_CACHE_TASKS = new Set(["word_lookup", "translate_sentence", "subtitle_batch", "subtitle_translate_batch", "subtitle_learning_batch", "vocabulary_analysis", "generate_distractors"]);
const AI_CACHE_PREFIX = "lingoclub:ai:v1:";
const AI_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const aiInflight = new Map();
const responseMetrics = new WeakMap();
import { getAIRequestContext, safeAIErrorMessage } from "./aiSettings.js";

function hashKey(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function aiCacheKey(task, payload, routeFingerprint = "server", cacheVersion = "") {
  if (!AI_CACHE_TASKS.has(task)) return null;
  const videoId = String(payload.video_id || "local").trim();
  const subtitleText = String(payload.subtitle_text || payload.text_en || payload.expression_en || "").trim();
  if (!subtitleText) return null;
  const expression = String(payload.expression_en || "").trim();
  return `${AI_CACHE_PREFIX}${hashKey(`${routeFingerprint}|${task}|schema:${cacheVersion}|${videoId}|${payload.cache_key || subtitleText}|${expression}`)}`;
}

export function clearAICache() {
  try {
    if (typeof localStorage === "undefined") return 0;
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(AI_CACHE_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
    return keys.length;
  } catch { return 0; }
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

async function postJson(path, body, { signal, timeoutMs = 26000, headers = {} } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const parseStartedAt = Date.now();
    const data = await response.json().catch(() => ({}));
    if (data && typeof data === "object") responseMetrics.set(data, { jsonParseMs: Date.now() - parseStartedAt, httpStatus: response.status });
    if (!response.ok) {
      if (data?.code === "AI_NOT_CONFIGURED" && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("lingoclub:ai-not-configured"));
      const error = new Error(safeAIErrorMessage({ status: response.status, code: data?.code, message: data?.error, upstreamCode: data?.upstreamCode }));
      error.status = response.status;
      error.name = "APIResponseError";
      error.code = data?.code;
      error.upstreamCode = data?.upstreamCode;
      error.upstreamStatus = data?.upstreamStatus || data?.diagnostic?.upstreamStatus;
      error.upstreamMessage = data?.diagnostic?.upstreamMessage;
      error.endpoint = data?.endpoint || data?.diagnostic?.endpoint;
      error.model = data?.model || data?.diagnostic?.model;
      error.diagnostic = data?.diagnostic;
      error.details = { status: response.status, code: data?.code, upstreamCode: error.upstreamCode, upstreamStatus: error.upstreamStatus, upstreamMessage: error.upstreamMessage, endpoint: error.endpoint, model: error.model, stage: data?.stage };
      throw error;
    }
    return data;
  } catch (error) {
    if (timedOut) {
      const timeoutError = new Error("Request timed out");
      timeoutError.name = "TimeoutError";
      timeoutError.code = "REQUEST_TIMEOUT";
      timeoutError.status = error?.status;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export async function invokeAI(task, payload = {}, options = {}) {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const report = (diagnostics) => {
    try { options.onDiagnostics?.({ expression: payload.expression_en || "", task, startedAt, ...diagnostics }); } catch { /* diagnostics must not affect AI calls */ }
  };
  let routeContext;
  try {
    routeContext = await getAIRequestContext();
  } catch (error) {
    if (error?.code === "AI_ROUTE_NOT_CONFIGURED" && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("lingoclub:ai-route-incomplete", { detail: { message: error.message } }));
    }
    throw error;
  }
  const model = ["vocabulary_analysis", "vocab-profile", "subtitle_translate_batch", "subtitle_learning_batch"].includes(task) ? routeContext.fastModel || routeContext.model : routeContext.model;
  const cacheKey = options.bypassCache ? null : aiCacheKey(task, payload, routeContext.fingerprint, options.cacheVersion || "");
  const cached = readAiCache(cacheKey);
  if (cached) {
    report({ model, finishedAt: new Date().toISOString(), durationMs: Date.now() - startedAtMs, jsonParseMs: 0, cacheHit: true, deduped: false, networkRequests: 0, status: "success" });
    return cached;
  }
  if (cacheKey && aiInflight.has(cacheKey)) {
    const response = await aiInflight.get(cacheKey);
    report({ model, finishedAt: new Date().toISOString(), durationMs: Date.now() - startedAtMs, jsonParseMs: 0, cacheHit: false, deduped: true, networkRequests: 0, upstreamDurationMs: response?.profile_diagnostics?.upstreamDurationMs ?? null, status: "success" });
    return response;
  }
  const requestOptions = { ...options };
  delete requestOptions.bypassCache;
  delete requestOptions.cacheVersion;
  delete requestOptions.onDiagnostics;
  const { supabase } = await import("./supabaseClient.js");
  const { data: sessionData } = await supabase?.auth.getSession() || { data: { session: null } };
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) { const error = new Error("请先登录后设置 API"); error.code = "AUTH_REQUIRED"; throw error; }
  const requestBody = { task, ...payload, credential_id: routeContext.credentialId };
  const request = postJson("/api/ai", requestBody, { ...requestOptions, headers: { Authorization: `Bearer ${accessToken}` } })
    .then((response) => {
      writeAiCache(cacheKey, response);
      report({ model: response?.profile_diagnostics?.model || model, finishedAt: new Date().toISOString(), durationMs: Date.now() - startedAtMs, jsonParseMs: responseMetrics.get(response)?.jsonParseMs ?? null, httpStatus: responseMetrics.get(response)?.httpStatus ?? null, cacheHit: false, deduped: false, networkRequests: 1, upstreamDurationMs: response?.profile_diagnostics?.upstreamDurationMs ?? null, status: "success" });
      return response;
    })
    .catch((error) => {
      report({ model, finishedAt: new Date().toISOString(), durationMs: Date.now() - startedAtMs, jsonParseMs: null, httpStatus: Number(error?.status) || null, cacheHit: false, deduped: false, networkRequests: 1, status: "error", providerErrorType: error?.upstreamCode || error?.code || error?.name || "request_failed", timeout: error?.name === "TimeoutError" });
      throw error;
    })
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
