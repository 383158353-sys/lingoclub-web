const OFFICIAL_BASE_URLS = Object.freeze({ openai: "https://api.openai.com/v1", gemini: "https://generativelanguage.googleapis.com" });
let credentials = [];
let activeCredentialId = null;
let loadPromise = null;

async function request(path, method = "GET", body) {
  const { supabase } = await import("./supabaseClient.js");
  const { data } = await supabase?.auth.getSession() || { data: { session: null } };
  const token = data?.session?.access_token;
  if (!token) { const error = new Error("请先登录"); error.code = "AUTH_REQUIRED"; throw error; }
  const response = await fetch(path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(payload.error || "AI 配置暂时不可用"); error.code = payload.code; error.status = response.status; throw error; }
  return payload;
}

export function getAICredentials() { return credentials.map((item) => ({ ...item })); }
export function getActiveAICredentialId() { return activeCredentialId; }

export async function loadAICredentials({ force = false } = {}) {
  if (!force && loadPromise) return loadPromise;
  if (force && typeof window !== "undefined") {
    credentials = [];
    activeCredentialId = null;
    window.dispatchEvent(new CustomEvent("lingoclub:ai-credentials-changed"));
  }
  loadPromise = request("/api/ai-credentials").then((result) => {
    credentials = Array.isArray(result.credentials) ? result.credentials : [];
    activeCredentialId = result.activeCredentialId || null;
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("lingoclub:ai-credentials-changed"));
    return getAICredentials();
  }).finally(() => { loadPromise = null; });
  return loadPromise;
}

export async function createAICredential(config) {
  const result = await request("/api/ai-credentials", "POST", config);
  if (result.credential) credentials = [...credentials, result.credential];
  if (result.activeCredentialId) activeCredentialId = result.activeCredentialId;
  window.dispatchEvent(new CustomEvent("lingoclub:ai-credentials-changed"));
  return result;
}

export async function updateAICredential(credentialId, patch) {
  const result = await request("/api/ai-credentials", "PATCH", { credentialId, ...patch });
  if (result.credential) credentials = credentials.map((item) => item.id === credentialId ? result.credential : item);
  window.dispatchEvent(new CustomEvent("lingoclub:ai-credentials-changed"));
  return result.credential;
}

async function callCredentialAI(credentialId, task, extra = {}) {
  const { supabase } = await import("./supabaseClient.js");
  const { data } = await supabase?.auth.getSession() || { data: { session: null } };
  const token = data?.session?.access_token;
  if (!token) { const error = new Error("请先登录"); error.code = "AUTH_REQUIRED"; error.status = 401; throw error; }
  const response = await fetch("/api/ai", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ credential_id: credentialId, task, ...extra }), cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(payload.error || "AI 请求失败"); Object.assign(error, { code: payload.code, status: response.status, upstreamStatus: payload.upstreamStatus || payload.diagnostic?.upstreamStatus, upstreamCode: payload.upstreamCode || payload.diagnostic?.upstreamCode, availableModels: payload.availableModels, model: payload.model, modelsStatus: payload.modelsStatus, modelsEndpoint: payload.modelsEndpoint, endpoint: payload.endpoint || payload.diagnostic?.endpoint, diagnostic: payload.diagnostic }); throw error; }
  return { status: response.status, payload, diagnostic: payload.diagnostic };
}

export async function listAICredentialModels(credentialId) {
  const result = await callCredentialAI(credentialId, "gemini_list_models");
  return result.payload;
}

export async function testActiveCredentialAI(credentialId) {
  try { return { connection: await callCredentialAI(credentialId, "ai_connection_test") }; }
  catch (error) { return { connection: { status: error.status, error: error.message, code: error.code, upstreamStatus: error.upstreamStatus, upstreamCode: error.upstreamCode, endpoint: error.endpoint } }; }
}

export async function activateAICredential(credentialId) {
  const result = await request("/api/ai-credentials", "PATCH", { action: "activate", credentialId });
  activeCredentialId = result.activeCredentialId;
  credentials = credentials.map((item) => ({ ...item, active: item.id === activeCredentialId }));
  window.dispatchEvent(new CustomEvent("lingoclub:ai-credentials-changed"));
  return result;
}

export async function deleteAICredential(credentialId) {
  const result = await request("/api/ai-credentials", "DELETE", { credentialId });
  credentials = credentials.filter((item) => item.id !== credentialId);
  activeCredentialId = result.activeCredentialId;
  credentials = credentials.map((item) => ({ ...item, active: item.id === activeCredentialId }));
  window.dispatchEvent(new CustomEvent("lingoclub:ai-credentials-changed"));
  return result;
}

export function getActiveAICredential() { return credentials.find((item) => item.id === activeCredentialId) || null; }

export async function getAIRequestContext() {
  if (!credentials.length && !activeCredentialId) await loadAICredentials();
  const active = getActiveAICredential();
  if (!active) {
    const error = new Error("API 尚未配置"); error.code = "AI_NOT_CONFIGURED";
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("lingoclub:ai-not-configured", { detail: { message: error.message } }));
    throw error;
  }
  return { credentialId: active.id, provider: active.provider, model: active.model, fastModel: active.fastModel, baseUrl: active.baseUrl || OFFICIAL_BASE_URLS[active.provider] || "", fingerprint: [active.id, active.provider, active.baseUrl || "official", active.model, active.fastModel].join("|") };
}

export function providerBaseUrl(provider) { return OFFICIAL_BASE_URLS[provider] || ""; }

export function safeAIErrorMessage(error) {
  if (error?.code === "AI_NOT_CONFIGURED" || error?.code === "AI_CREDENTIALS_NOT_CONFIGURED") return "API 尚未配置";
  if (error?.code === "AUTH_REQUIRED" || error?.status === 401) return "请先登录后设置 API";
  if (error?.code === "AI_PROVIDER_AUTH") return "API Key 无效或没有调用权限";
  if (error?.code === "AI_MODEL_UNAVAILABLE") return "模型不可用或当前 Key 无权访问";
  if (error?.code === "AI_MODEL_NOT_FOUND") return error?.message || "中转站未找到此模型";
  if (error?.code === "AI_UPSTREAM_404") return "中转站接口返回 404，请检查接口路径";
  if (error?.code === "AI_REQUEST_FORMAT_INCOMPATIBLE") return `请求格式不兼容${error?.message ? `：${error.message}` : ""}`;
  if (error?.code === "AI_UPSTREAM_BAD_REQUEST") return error?.message || "中转站拒绝了请求格式";
  if (error?.code === "AI_RELAY_UNAVAILABLE") return "中转站服务异常";
  if (error?.code === "AI_REQUEST_FAILED" && error?.upstreamCode) return `AI 请求失败（${error.upstreamCode}）`;
  if (error?.code === "AI_RATE_LIMIT") return "当前 API 调用额度已用完或达到速率限制";
  if (error?.code === "AI_TIMEOUT") return "请求超时";
  if (error?.status === 403) return "API Key 无效或没有调用权限";
  if (error?.status === 404) return "模型不可用或当前 Key 无权访问";
  if (error?.status === 429) return "当前 API 调用额度已用完或达到速率限制";
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "请求超时";
  if (error?.status >= 500) return "服务暂时不可用";
  return "AI 服务暂时不可用，请检查 API 设置";
}

// Remove old browser-stored provider secrets without touching any learning data.
if (typeof window !== "undefined") {
  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (const key of ["lingoclub:ai-settings:v2", "lingoclub:ai-settings:session:v2", "lingoclub:ai-config:v1", "lingoclub:ai-config:session:v1"]) {
      try { storage.removeItem(key); } catch { /* storage can be unavailable */ }
    }
  }
}
