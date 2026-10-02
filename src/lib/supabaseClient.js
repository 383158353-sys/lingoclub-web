import { createClient } from "@supabase/supabase-js";

const url = String(import.meta.env.VITE_SUPABASE_URL || "").trim();
const publishableKey = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "").trim();

const nativeFetch = globalThis.fetch.bind(globalThis);

async function diagnosticFetch(input, init = {}) {
  const request = input instanceof Request ? input : null;
  const url = request?.url || String(input);
  if (!url.includes("/rest/v1/user_state")) return nativeFetch(input, init);

  const method = String(init.method || request?.method || "GET").toUpperCase();
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const headers = new Headers(init.headers || request?.headers);
  const rawBody = init.body ?? (request ? await request.clone().text() : "");
  let payloadUserId = null;
  try {
    const payload = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
    payloadUserId = Array.isArray(payload) ? payload[0]?.user_id : payload?.user_id;
  } catch { /* request may not have a JSON body */ }
  const requestBytes = typeof rawBody === "string" && rawBody ? new TextEncoder().encode(rawBody).byteLength : 0;
  const diagnostic = {
    method,
    httpStatus: null,
    stage: "user_state",
    payloadCount: Array.isArray(rawBody) ? rawBody.length : rawBody ? 1 : 0,
    durationMs: null,
    requestBytes,
    responseBytes: null,
    startedAtMs: Math.round(startedAt),
    completedAtMs: null,
    recordedAt: new Date().toISOString(),
  };
  if (import.meta.env.DEV) Object.assign(diagnostic, {
    requestUrl: url,
    accessTokenAttached: /^Bearer\s+\S+/i.test(headers.get("authorization") || ""),
    payloadUserId: payloadUserId || null,
  });
  if (typeof window !== "undefined") {
    window.__LINGOCLUB_SYNC_DIAGNOSTIC__ = {
      ...(window.__LINGOCLUB_SYNC_DIAGNOSTIC__ || {}),
      ...diagnostic,
    };
    const requests = window.__LINGOCLUB_USER_STATE_REQUESTS__ || [];
    requests.push(diagnostic);
    window.__LINGOCLUB_USER_STATE_REQUESTS__ = requests.slice(-20);
  }

  let response;
  try {
    response = await nativeFetch(input, init);
  } catch (error) {
    diagnostic.networkError = true;
    diagnostic.completedAtMs = Math.round(typeof performance !== "undefined" ? performance.now() : Date.now());
    diagnostic.durationMs = diagnostic.completedAtMs - diagnostic.startedAtMs;
    if (typeof window !== "undefined") console.info("[LingoClub user_state request]", JSON.stringify(diagnostic));
    throw error;
  }
  const endedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  diagnostic.httpStatus = response.status;
  diagnostic.durationMs = Math.round(endedAt - startedAt);
  diagnostic.completedAtMs = Math.round(endedAt);
  const resourceEntries = typeof performance !== "undefined" ? performance.getEntriesByName(url, "resource") : [];
  const resourceEntry = resourceEntries[resourceEntries.length - 1];
  diagnostic.responseBytes = Number(response.headers.get("content-length")) || resourceEntry?.encodedBodySize || null;
  let responseBody = "";
  if (import.meta.env.DEV) { try { responseBody = await response.clone().text(); } catch { /* noop */ } }
  if (import.meta.env.DEV) diagnostic.responseBody = responseBody;
  if (typeof window !== "undefined") console.info("[LingoClub user_state request]", JSON.stringify(diagnostic));
  return response;
}

export const supabaseConfigured = Boolean(url && publishableKey);
export const supabase = supabaseConfigured
  ? createClient(url, publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "lingoclub_supabase_auth",
      },
      global: { fetch: diagnosticFetch },
    })
  : null;
