import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function masterKey(env) {
  const raw = String(env.AI_CREDENTIALS_MASTER_KEY || "");
  if (!raw) { const error = new Error("AI credentials encryption is not configured"); error.code = "ENCRYPTION_KEY_MISSING"; error.stage = "encryption"; throw error; }
  if (/^[a-f\d]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  try { const decoded = Buffer.from(raw, "base64"); if (decoded.length === 32) return decoded; } catch { /* use stable derivation for env strings */ }
  return createHash("sha256").update(raw).digest();
}

export function encryptCredentialSecret(secret, env = process.env) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(env), iv);
  const ciphertext = Buffer.concat([cipher.update(String(secret), "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptCredentialSecret(encrypted, env = process.env) {
  const [version, ivPart, tagPart, textPart] = String(encrypted || "").split(".");
  if (version !== "v1" || !ivPart || !tagPart || !textPart) throw new Error("Invalid encrypted AI credential");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(env), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(textPart, "base64url")), decipher.final()]).toString("utf8");
}

function supabaseUrl(env) {
  return String(env.VITE_SUPABASE_URL || "").trim();
}

function supabaseHost(env) {
  try { return new URL(supabaseUrl(env)).host; }
  catch { return ""; }
}

export function serviceRoleProjectMatches(env = process.env) {
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const encodedPayload = key.split(".")[1];
  if (!encodedPayload) return null;
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    const projectRef = supabaseHost(env).split(".")[0];
    return typeof payload?.ref === "string" && Boolean(projectRef) ? payload.ref === projectRef : null;
  } catch { return null; }
}

export function getAuthSupabase(env = process.env) {
  const url = supabaseUrl(env);
  const key = String(env.VITE_SUPABASE_PUBLISHABLE_KEY || "").trim();
  if (!url || !key) { const error = new Error("Supabase authentication is not configured"); error.code = "SERVER_ENV_MISSING"; error.stage = "missing_server_env"; throw error; }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function getServerSupabase(env = process.env) {
  const url = supabaseUrl(env);
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) { const error = new Error("AI credentials storage is not configured"); error.code = "SERVER_ENV_MISSING"; error.stage = "missing_server_env"; throw error; }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function authenticatedUser(req, env = process.env) {
  const auth = String(req.headers?.authorization || "");
  const token = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const diagnostic = {
    bearerPresent: Boolean(token),
    tokenLength: token?.length || 0,
    supabaseHost: supabaseHost(env),
    authErrorCode: null,
    authErrorStatus: null,
    userResolved: false,
    serviceRoleClientInitialized: false,
    serviceRoleProjectMatches: serviceRoleProjectMatches(env),
  };
  if (!token) {
    console.info("[/api/ai-credentials] auth diagnostic", diagnostic);
    const error = new Error("Authentication required"); error.status = 401; error.code = "AUTH_REQUIRED"; error.stage = "auth"; throw error;
  }
  let authClient;
  let client;
  try {
    authClient = getAuthSupabase(env);
    client = getServerSupabase(env);
    diagnostic.serviceRoleClientInitialized = true;
  } catch (error) {
    diagnostic.authErrorCode = String(error?.code || "CLIENT_INIT_FAILED");
    diagnostic.authErrorStatus = Number.isInteger(error?.status) ? error.status : null;
    console.info("[/api/ai-credentials] auth diagnostic", diagnostic);
    throw error;
  }
  let result;
  try { result = await authClient.auth.getUser(token); }
  catch (cause) {
    diagnostic.authErrorCode = String(cause?.code || "SUPABASE_CONNECTION_FAILED");
    diagnostic.authErrorStatus = Number.isInteger(cause?.status) ? cause.status : null;
    console.info("[/api/ai-credentials] auth diagnostic", diagnostic);
    const error = new Error("Supabase authentication request failed"); error.stage = "supabase_connection"; error.code = "SUPABASE_CONNECTION_FAILED"; throw error;
  }
  const { data, error } = result;
  diagnostic.authErrorCode = error?.code ? String(error.code) : null;
  diagnostic.authErrorStatus = Number.isInteger(error?.status) ? error.status : null;
  diagnostic.userResolved = Boolean(data?.user?.id);
  console.info("[/api/ai-credentials] auth diagnostic", diagnostic);
  if (error || !diagnostic.userResolved) { const unauthorized = new Error("Authentication required"); unauthorized.status = 401; unauthorized.code = "AUTH_REQUIRED"; unauthorized.stage = "auth"; throw unauthorized; }
  return { client, user: data.user };
}

export async function getUserCredential(req, env, credentialId) {
  if (env?.NODE_ENV === "test" && typeof env.__AI_CREDENTIAL_LOOKUP_TEST_ONLY === "function") {
    return { credential: await env.__AI_CREDENTIAL_LOOKUP_TEST_ONLY(req, credentialId) };
  }
  const { client, user } = await authenticatedUser(req, env);
  const { data, error } = await client.from("user_ai_credentials").select("*").eq("id", credentialId).eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  if (!data) { const missing = new Error("AI credential not found"); missing.status = 404; throw missing; }
  return { client, user, credential: { ...data, api_key: decryptCredentialSecret(data.encrypted_api_key, env) } };
}

export function maskCredentialSecret(secret) {
  const clean = String(secret || "");
  return clean ? `${clean.slice(0, 3)}••••••••${clean.slice(-2)}` : "";
}

export function isSafeProviderUrl(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return false;
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) return false;
    if (hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80:")) return false;
    const ip = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ip) { const [a, b, c, d] = ip.slice(1).map(Number); if ([a,b,c,d].some((n) => n > 255) || a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false; }
    return true;
  } catch { return false; }
}
