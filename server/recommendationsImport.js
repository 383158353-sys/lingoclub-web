import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { videoId as extractVideoId } from "./transcript/youtubeTranscriptService.js";
import { checkOEmbed } from "./youtubeMeta.js";

// oEmbed answers 401/403 when the owner disabled embedding: such videos cannot
// play inside the app (only "在 YouTube 上观看"), though subtitles still work.
async function defaultCheckEmbeddable(youtubeId) {
  return (await checkOEmbed(youtubeId, { timeoutMs: 4000 })).embeddable;
}

// POST /api/recommendations/import
// Authorization: Bearer <RECOMMENDATIONS_IMPORT_TOKEN>
// Body: { "date": "YYYY-MM-DD", "source"?: "digest" | "morning_read", "items": [ ... ] }
// See README.md「每日推荐导入接口」 for the full schema and an example.

export const MAX_ITEMS = 50;
export const SOURCES = ["digest", "morning_read"];
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMITS = { title: 300, level: 32, summary_zh: 4000, why_relevant: 4000, tag: 40, tags: 20, url: 2048 };

function send(res, status, body) {
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function digest(value) {
  return createHash("sha256").update(String(value), "utf8").digest();
}

// Hash both sides first so the comparison is constant-time regardless of length.
export function tokenMatches(provided, expected) {
  if (!expected || !provided) return false;
  return timingSafeEqual(digest(provided), digest(expected));
}

export function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function optionalText(value, max) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  return value.trim().slice(0, max);
}

// Returns { row } or { error } for one item. `row` excludes user_id/rec_date.
export function normalizeItem(item, defaultSource) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return { error: "item must be an object" };

  const rawUrl = typeof item.url === "string" ? item.url.trim() : "";
  const rawId = typeof item.youtube_id === "string" ? item.youtube_id.trim() : "";
  if (!rawUrl && !rawId) return { error: "url or youtube_id is required" };
  if (rawUrl.length > LIMITS.url) return { error: "url is too long" };
  const idFromUrl = rawUrl ? extractVideoId(rawUrl) : null;
  if (rawUrl && !idFromUrl) return { error: "url is not a YouTube video link" };
  if (rawId && !/^[A-Za-z0-9_-]{11}$/.test(rawId)) return { error: "youtube_id is invalid" };
  if (rawId && idFromUrl && rawId !== idFromUrl) return { error: "youtube_id does not match url" };
  const youtubeId = rawId || idFromUrl;

  const title = optionalText(item.title, LIMITS.title);
  if (!title) return { error: "title is required" };

  let durationSeconds = null;
  if (item.duration_seconds !== undefined && item.duration_seconds !== null) {
    const value = Number(item.duration_seconds);
    if (!Number.isInteger(value) || value < 0 || value > 86_400) return { error: "duration_seconds must be an integer between 0 and 86400" };
    durationSeconds = value;
  }

  const level = optionalText(item.level, LIMITS.level);
  if (level === null) return { error: "level must be a string" };

  let tags = [];
  if (item.tags !== undefined && item.tags !== null) {
    if (!Array.isArray(item.tags) || item.tags.some((tag) => typeof tag !== "string")) return { error: "tags must be an array of strings" };
    tags = [...new Set(item.tags.map((tag) => tag.trim().slice(0, LIMITS.tag)).filter(Boolean))].slice(0, LIMITS.tags);
  }

  const summaryZh = optionalText(item.summary_zh, LIMITS.summary_zh);
  if (summaryZh === null) return { error: "summary_zh must be a string" };
  const whyRelevant = optionalText(item.why_relevant, LIMITS.why_relevant);
  if (whyRelevant === null) return { error: "why_relevant must be a string" };

  const source = item.source ?? defaultSource;
  if (!SOURCES.includes(source)) return { error: `source must be one of ${SOURCES.join(", ")}` };

  return {
    row: {
      youtube_id: youtubeId,
      url: `https://www.youtube.com/watch?v=${youtubeId}`,
      title,
      duration_seconds: durationSeconds,
      level: level || null,
      tags,
      summary_zh: summaryZh,
      why_relevant: whyRelevant,
      source,
    },
  };
}

export function validateImportPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "JSON object required" };
  if (!isValidDate(body.date)) return { error: "date must be YYYY-MM-DD" };
  if (body.source !== undefined && !SOURCES.includes(body.source)) return { error: `source must be one of ${SOURCES.join(", ")}` };
  if (!Array.isArray(body.items) || body.items.length === 0) return { error: "items must be a non-empty array" };
  if (body.items.length > MAX_ITEMS) return { error: `at most ${MAX_ITEMS} items per request` };

  const rows = [];
  const rejected = [];
  const seen = new Set();
  body.items.forEach((item, index) => {
    const result = normalizeItem(item, body.source);
    if (result.error) { rejected.push({ index, error: result.error }); return; }
    if (seen.has(result.row.youtube_id)) { rejected.push({ index, error: "duplicate youtube_id in this request" }); return; }
    seen.add(result.row.youtube_id);
    rows.push(result.row);
  });
  return { date: body.date, rows, rejected };
}

export function getImportSupabase(env) {
  const url = String(env.VITE_SUPABASE_URL || env.SUPABASE_URL || "").trim();
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function handleRecommendationsImport(req, res, body, env = process.env, { createSupabase = getImportSupabase, checkEmbeddable = defaultCheckEmbeddable } = {}) {
  const expectedToken = String(env.RECOMMENDATIONS_IMPORT_TOKEN || "");
  const userId = String(env.RECOMMENDATIONS_IMPORT_USER_ID || "").trim();
  if (!expectedToken || !UUID_RX.test(userId)) {
    return send(res, 503, { error: "Recommendations import is not configured", code: "IMPORT_NOT_CONFIGURED" });
  }
  const provided = String(req.headers?.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  if (!tokenMatches(provided, expectedToken)) {
    return send(res, 401, { error: "Invalid import token", code: "UNAUTHORIZED" });
  }

  const parsed = validateImportPayload(body);
  if (parsed.error) return send(res, 400, { error: parsed.error, code: "INVALID_PAYLOAD" });
  if (!parsed.rows.length) {
    return send(res, 400, { error: "no valid items", code: "INVALID_PAYLOAD", received: body.items.length, inserted: 0, updated: 0, rejected: parsed.rejected });
  }

  const client = createSupabase(env);
  if (!client) return send(res, 503, { error: "Supabase service role is not configured", code: "IMPORT_NOT_CONFIGURED" });

  const ids = parsed.rows.map((row) => row.youtube_id);
  const embeddableChecks = Promise.all(ids.map((id) => Promise.resolve().then(() => checkEmbeddable(id)).catch(() => null)));
  const existing = await client
    .from("daily_recommendations")
    .select("youtube_id")
    .eq("user_id", userId)
    .eq("rec_date", parsed.date)
    .in("youtube_id", ids);
  if (existing.error) throw Object.assign(new Error("Recommendation lookup failed"), { code: "DATABASE_ERROR", dbError: existing.error });
  const existingIds = new Set((existing.data || []).map((row) => row.youtube_id));

  // Content columns only: re-imports refresh text but keep watched/favorite state.
  const now = new Date().toISOString();
  const records = parsed.rows.map((row) => ({ ...row, user_id: userId, rec_date: parsed.date, updated_at: now }));
  const { error } = await client
    .from("daily_recommendations")
    .upsert(records, { onConflict: "user_id,rec_date,youtube_id" });
  if (error) throw Object.assign(new Error("Recommendation upsert failed"), { code: "DATABASE_ERROR", dbError: error });

  const updated = ids.filter((id) => existingIds.has(id)).length;
  const embeddable = await embeddableChecks;
  return send(res, 200, {
    ok: true,
    date: parsed.date,
    received: body.items.length,
    inserted: ids.length - updated,
    updated,
    rejected: parsed.rejected,
    // true / false (embedding disabled: watch on YouTube only) / null (unknown)
    items: ids.map((youtube_id, index) => ({ youtube_id, embeddable: embeddable[index] ?? null })),
  });
}

export function recommendationsImportApi(handle = handleRecommendationsImport) {
  return async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    if (String(req.method || "").toUpperCase() !== "POST") {
      res.setHeader("Allow", "POST");
      return send(res, 405, { error: "Method not allowed" });
    }
    let body;
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    } catch {
      return send(res, 400, { error: "Invalid JSON", code: "INVALID_PAYLOAD" });
    }
    try {
      await handle(req, res, body, process.env);
    } catch (error) {
      const db = error?.dbError;
      console.error("[/api/recommendations/import] failed", { code: error?.code || null, message: error?.message || null, dbCode: db?.code || null, dbMessage: db?.message || null, dbDetails: db?.details || null, dbHint: db?.hint || null });
      send(res, 502, { error: "Import failed, please retry later", code: error?.code === "DATABASE_ERROR" ? "DATABASE_ERROR" : "IMPORT_FAILED", ...(db?.code ? { dbCode: db.code } : {}) });
    }
  };
}
