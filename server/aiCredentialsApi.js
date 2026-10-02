import { authenticatedUser, encryptCredentialSecret, isSafeProviderUrl } from "./aiCredentials.js";
import { classifyCredentialFailure } from "./aiCredentialErrors.js";

function send(res, status, body) {
  res.statusCode = status;
  const payload = body?.code && !body?.stage ? { ...body, stage: "credential_endpoint" } : body;
  res.end(JSON.stringify(payload));
}
function publicCredential(row, activeId) {
  return { id: row.id, name: row.name, type: row.provider_type, provider: row.provider, baseUrl: row.base_url || "", model: row.model, fastModel: row.fast_model || "", maskedApiKey: row.key_hint ? `••••••••${row.key_hint}` : "", active: row.id === activeId, updatedAt: row.updated_at };
}

export async function handleAICredentials(req, res, body = {}, env = process.env) {
  const { client, user } = await authenticatedUser(req, env);
  const method = String(req.method || "GET").toUpperCase();
  let prefs;
  try { prefs = await client.from("user_ai_preferences").select("active_credential_id").eq("user_id", user.id).maybeSingle(); }
  catch (error) { throw Object.assign(new Error("Supabase request failed"), classifyCredentialFailure(error, "supabase_connection")); }
  if (prefs.error) throw Object.assign(new Error("Supabase request failed"), classifyCredentialFailure(prefs.error, "supabase_connection"));
  const activeId = prefs.data?.active_credential_id || null;

  if (method === "GET") {
    const { data, error } = await client.from("user_ai_credentials").select("id,name,provider_type,provider,base_url,model,fast_model,key_hint,updated_at").eq("user_id", user.id).order("created_at", { ascending: true });
    if (error) throw Object.assign(new Error("Credential lookup failed"), classifyCredentialFailure(error, "supabase_connection"));
    return send(res, 200, { credentials: (data || []).map((row) => publicCredential(row, activeId)), activeCredentialId: activeId });
  }

  if (method === "POST") {
    const name = String(body.name || "").trim().slice(0, 80);
    const type = body.type === "official" ? "official" : body.type === "relay" ? "relay" : "";
    const provider = String(body.provider || "").toLowerCase();
    const apiKey = String(body.apiKey || "");
    const model = String(body.model || "").trim();
    const fastModel = String(body.fastModel || "").trim();
    let baseUrl = "";
    if (!name || !type || !apiKey || !model) return send(res, 400, { code: "AI_CREDENTIAL_INVALID" });
    if (type === "official" && provider === "openai") baseUrl = "https://api.openai.com/v1";
    else if (type === "official" && provider === "gemini") baseUrl = "https://generativelanguage.googleapis.com";
    else if (type === "relay" && ["gemini", "openai-compatible", "openai"].includes(provider) && isSafeProviderUrl(body.baseUrl)) baseUrl = String(body.baseUrl).trim().replace(/\/+$/, "");
    else return send(res, 400, { code: "AI_CREDENTIAL_INVALID" });
    let encrypted;
    try { encrypted = encryptCredentialSecret(apiKey, env); }
    catch { const error = new Error("Credential encryption failed"); error.code = "ENCRYPTION_FAILED"; error.stage = "encryption"; throw error; }
    const row = { user_id: user.id, name, provider_type: type, provider, base_url: baseUrl, encrypted_api_key: encrypted, key_hint: apiKey.slice(-2), model, fast_model: fastModel };
    const { data, error } = await client.from("user_ai_credentials").insert(row).select("id,name,provider_type,provider,base_url,model,fast_model,key_hint,updated_at").single();
    if (error) throw Object.assign(new Error("Credential insert failed"), classifyCredentialFailure(error, "insert_update"));
    if (!activeId) {
      const { error: prefError } = await client.from("user_ai_preferences").upsert({ user_id: user.id, active_credential_id: data.id, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (prefError) throw Object.assign(new Error("Credential preference update failed"), classifyCredentialFailure(prefError, "insert_update"));
    }
    return send(res, 201, { credential: publicCredential(data, activeId || data.id), activeCredentialId: activeId || data.id });
  }

  if (method === "PATCH") {
    const id = String(body.credentialId || "");
    if (body.action === "activate") {
      if (id) {
        const owned = await client.from("user_ai_credentials").select("id").eq("id", id).eq("user_id", user.id).maybeSingle();
        if (owned.error) throw Object.assign(new Error("Credential ownership lookup failed"), classifyCredentialFailure(owned.error, "supabase_connection"));
        if (!owned.data) return send(res, 404, { code: "AI_CREDENTIAL_NOT_FOUND" });
      }
      const { error } = await client.from("user_ai_preferences").upsert({ user_id: user.id, active_credential_id: id || null, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) throw Object.assign(new Error("Credential preference update failed"), classifyCredentialFailure(error, "insert_update"));
      return send(res, 200, { activeCredentialId: id || null });
    }
    if (!id) return send(res, 400, { code: "AI_CREDENTIAL_INVALID" });
    const update = {};
    if (body.name !== undefined) update.name = String(body.name).trim().slice(0, 80);
    if (body.provider !== undefined) {
      const nextProvider = String(body.provider || "").toLowerCase();
      if (!["gemini", "openai-compatible", "openai"].includes(nextProvider)) return send(res, 400, { code: "AI_CREDENTIAL_INVALID" });
      update.provider = nextProvider;
    }
    if (body.model !== undefined) update.model = String(body.model).trim();
    if (body.fastModel !== undefined) update.fast_model = String(body.fastModel).trim();
    if (body.apiKey) {
      try { update.encrypted_api_key = encryptCredentialSecret(String(body.apiKey), env); }
      catch { const error = new Error("Credential encryption failed"); error.code = "ENCRYPTION_FAILED"; error.stage = "encryption"; throw error; }
      update.key_hint = String(body.apiKey).slice(-2);
    }
    if (body.baseUrl !== undefined) {
      if (!isSafeProviderUrl(body.baseUrl)) return send(res, 400, { code: "AI_CREDENTIAL_INVALID" });
      update.base_url = String(body.baseUrl).trim().replace(/\/+$/, "");
    }
    update.updated_at = new Date().toISOString();
    const { data, error } = await client.from("user_ai_credentials").update(update).eq("id", id).eq("user_id", user.id).select("id,name,provider_type,provider,base_url,model,fast_model,key_hint,updated_at").single();
    if (error) throw Object.assign(new Error("Credential update failed"), classifyCredentialFailure(error, "insert_update"));
    return send(res, 200, { credential: publicCredential(data, activeId) });
  }

  if (method === "DELETE") {
    const id = String(body.credentialId || "");
    if (!id) return send(res, 400, { code: "AI_CREDENTIAL_INVALID" });
    if (activeId === id) {
      const { error: prefError } = await client.from("user_ai_preferences").upsert({ user_id: user.id, active_credential_id: null, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (prefError) throw prefError;
    }
    const { error } = await client.from("user_ai_credentials").delete().eq("id", id).eq("user_id", user.id);
    if (error) throw error;
    const nextActive = activeId === id ? null : activeId;
    if (activeId === id) {
      const first = await client.from("user_ai_credentials").select("id").eq("user_id", user.id).order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (first.error) throw first.error;
      const next = first.data?.id || null;
      const { error: prefError } = await client.from("user_ai_preferences").upsert({ user_id: user.id, active_credential_id: next, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (prefError) throw prefError;
      return send(res, 200, { activeCredentialId: next });
    }
    return send(res, 200, { activeCredentialId: nextActive });
  }

  res.setHeader("Allow", "GET, POST, PATCH, DELETE");
  return send(res, 405, { code: "METHOD_NOT_ALLOWED" });
}
