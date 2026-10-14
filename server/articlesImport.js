import { tokenMatches, isValidDate, getImportSupabase } from "./recommendationsImport.js";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMITS = { source_url: 2048, title: 300, author: 120, outlet: 120, level: 32, summary_zh: 4000, body_en: 50000 };
const send = (res, status, payload) => { res.statusCode = status; res.end(JSON.stringify(payload)); };

export function normalizeArticle(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return { error: "item must be an object" };
  const row = {};
  for (const [field, max] of Object.entries(LIMITS)) {
    const value = item[field];
    if (value != null && typeof value !== "string") return { error: `${field} must be a string` };
    const text = (value || "").trim();
    if (text.length > max) return { error: `${field} is too long` };
    if (["source_url", "title", "body_en"].includes(field) && !text) return { error: `${field} is required` };
    row[field] = field === "level" ? text || null : text;
  }
  try {
    const url = new URL(row.source_url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    row.source_url = url.href;
  } catch { return { error: "source_url must be an http(s) URL without credentials" }; }
  if (item.tags !== undefined && (!Array.isArray(item.tags) || item.tags.length > 20
    || item.tags.some((tag) => typeof tag !== "string" || tag.trim().length > 40))) return { error: "tags must contain at most 20 strings of 40 characters" };
  row.tags = [...new Set((item.tags || []).map((tag) => tag.trim()).filter(Boolean))];
  if (item.analysis !== undefined && (!item.analysis || typeof item.analysis !== "object" || Array.isArray(item.analysis))) return { error: "analysis must be an object" };
  try {
    const serialized = JSON.stringify(item.analysis ?? {});
    if (serialized.length > 200000) return { error: "analysis is too long" };
    row.analysis = JSON.parse(serialized);
  } catch { return { error: "analysis must be JSON serializable" }; }
  return { row };
}

export function validateArticlesPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "JSON object required" };
  if (!isValidDate(body.date)) return { error: "date must be YYYY-MM-DD" };
  if (body.source !== undefined && !["morning_read", "digest"].includes(body.source)) return { error: "source must be morning_read or digest" };
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 10) return { error: "items must contain 1–10 articles" };
  const rows = [], rejected = [], seen = new Set();
  body.items.forEach((item, index) => {
    const result = normalizeArticle(item);
    if (result.error) { rejected.push({ index, error: result.error }); return; }
    if (seen.has(result.row.source_url)) { rejected.push({ index, error: "duplicate source_url in this request" }); return; }
    seen.add(result.row.source_url);
    rows.push(result.row);
  });
  return { date: body.date, rows, rejected };
}

export async function handleArticlesImport(req, res, body, env = process.env, { createSupabase = getImportSupabase } = {}) {
  const token = String(env.RECOMMENDATIONS_IMPORT_TOKEN || "");
  const userId = String(env.RECOMMENDATIONS_IMPORT_USER_ID || "").trim();
  if (!token || !UUID_RX.test(userId)) return send(res, 503, { error: "Article import is not configured", code: "IMPORT_NOT_CONFIGURED" });
  const provided = String(req.headers?.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  if (!tokenMatches(provided, token)) return send(res, 401, { error: "Invalid import token", code: "UNAUTHORIZED" });
  const parsed = validateArticlesPayload(body);
  if (parsed.error) return send(res, 400, { error: parsed.error, code: "INVALID_PAYLOAD" });
  if (!parsed.rows.length) return send(res, 400, { ok: false, date: parsed.date, received: body.items.length, inserted: 0, updated: 0, rejected: parsed.rejected, code: "INVALID_PAYLOAD" });
  const client = createSupabase(env);
  if (!client) return send(res, 503, { error: "Supabase service role is not configured", code: "IMPORT_NOT_CONFIGURED" });
  const urls = parsed.rows.map((row) => row.source_url);
  const existing = await client.from("daily_articles").select("source_url").eq("user_id", userId).eq("rec_date", parsed.date).in("source_url", urls);
  if (existing.error) throw Object.assign(new Error("Article lookup failed"), { code: "DATABASE_ERROR" });
  const known = new Set((existing.data || []).map((row) => row.source_url));
  // 只 upsert 内容字段，不发送 read_at/favorited，保留已有阅读与收藏状态。
  const records = parsed.rows.map((row) => ({ ...row, user_id: userId, rec_date: parsed.date, updated_at: new Date().toISOString() }));
  const { error } = await client.from("daily_articles").upsert(records, { onConflict: "user_id,rec_date,source_url" });
  if (error) throw Object.assign(new Error("Article upsert failed"), { code: "DATABASE_ERROR" });
  const updated = urls.filter((url) => known.has(url)).length;
  return send(res, 200, { ok: true, date: parsed.date, received: body.items.length, inserted: urls.length - updated, updated, rejected: parsed.rejected });
}

export function articlesImportApi(handle = handleArticlesImport, env = process.env) {
  return async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    if (String(req.method || "").toUpperCase() !== "POST") { res.setHeader("Allow", "POST"); return send(res, 405, { error: "Method not allowed" }); }
    let body;
    try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
    catch { return send(res, 400, { error: "Invalid JSON", code: "INVALID_PAYLOAD" }); }
    try { await handle(req, res, body, env); }
    catch (error) {
      console.error("[/api/articles/import] failed", error?.code || "IMPORT_FAILED");
      send(res, 502, { error: "Import failed, please retry later", code: error?.code === "DATABASE_ERROR" ? "DATABASE_ERROR" : "IMPORT_FAILED" });
    }
  };
}
