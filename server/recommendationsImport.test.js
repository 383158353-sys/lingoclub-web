import assert from "node:assert/strict";
import test from "node:test";
import {
  handleRecommendationsImport,
  normalizeItem,
  recommendationsImportApi,
  tokenMatches,
  validateImportPayload,
} from "./recommendationsImport.js";

const USER_ID = "11111111-2222-4333-8444-555555555555";
const ENV = { RECOMMENDATIONS_IMPORT_TOKEN: "secret-token", RECOMMENDATIONS_IMPORT_USER_ID: USER_ID };

function response() {
  return { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = JSON.parse(body); } };
}

function fakeSupabase({ existing = [], lookupError = null, upsertError = null } = {}) {
  const calls = { filters: [], upserts: [] };
  const query = {
    select() { return query; },
    eq(column, value) { calls.filters.push([column, value]); return query; },
    in(column, values) { calls.filters.push([column, values]); return Promise.resolve({ data: existing.map((youtube_id) => ({ youtube_id })), error: lookupError }); },
    upsert(records, options) { calls.upserts.push({ records, options }); return Promise.resolve({ error: upsertError }); },
  };
  return { calls, client: { from(table) { calls.table = table; return query; } } };
}

const validBody = {
  date: "2026-10-11",
  source: "morning_read",
  items: [
    { url: "https://youtu.be/dQw4w9WgXcQ?si=abc", title: "Video A", duration_seconds: 212, level: "B1", tags: ["listening", " work ", "listening"], summary_zh: "要点", why_relevant: "原因" },
    { youtube_id: "arj7oStGLkU", title: "Video B", source: "digest" },
  ],
};

test("token comparison is exact and rejects empty values", () => {
  assert.equal(tokenMatches("secret-token", "secret-token"), true);
  assert.equal(tokenMatches("secret-tokem", "secret-token"), false);
  assert.equal(tokenMatches("secret", "secret-token"), false);
  assert.equal(tokenMatches("", "secret-token"), false);
  assert.equal(tokenMatches("x", ""), false);
});

test("normalizeItem extracts youtube_id from url and canonicalizes fields", () => {
  const { row } = normalizeItem(validBody.items[0], "morning_read");
  assert.equal(row.youtube_id, "dQw4w9WgXcQ");
  assert.equal(row.url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.deepEqual(row.tags, ["listening", "work"]);
  assert.equal(row.source, "morning_read");
  assert.equal(row.duration_seconds, 212);
  const shorts = normalizeItem({ url: "https://www.youtube.com/shorts/arj7oStGLkU", title: "s" }, "digest");
  assert.equal(shorts.row.youtube_id, "arj7oStGLkU");
});

test("normalizeItem rejects invalid items", () => {
  for (const [item, pattern] of [
    [{ title: "x" }, /url or youtube_id/],
    [{ url: "https://example.com/video", title: "x" }, /not a YouTube/],
    [{ youtube_id: "short", title: "x" }, /youtube_id is invalid/],
    [{ url: "https://youtu.be/dQw4w9WgXcQ", youtube_id: "arj7oStGLkU", title: "x" }, /does not match/],
    [{ youtube_id: "dQw4w9WgXcQ" }, /title is required/],
    [{ youtube_id: "dQw4w9WgXcQ", title: "x", duration_seconds: -1 }, /duration_seconds/],
    [{ youtube_id: "dQw4w9WgXcQ", title: "x", tags: "a,b" }, /tags/],
    [{ youtube_id: "dQw4w9WgXcQ", title: "x", source: "other" }, /source/],
  ]) {
    const result = normalizeItem(item, "digest");
    assert.match(result.error || "", pattern, JSON.stringify(item));
  }
  assert.match(normalizeItem({ youtube_id: "dQw4w9WgXcQ", title: "x" }, undefined).error, /source/);
});

test("validateImportPayload checks date, item count, and duplicates", () => {
  assert.match(validateImportPayload({ date: "2026-02-30", items: [{}] }).error, /date/);
  assert.match(validateImportPayload({ date: "2026-10-11", items: [] }).error, /items/);
  assert.match(validateImportPayload({ date: "2026-10-11", items: Array(51).fill({}) }).error, /at most/);
  const result = validateImportPayload({ date: "2026-10-11", source: "digest", items: [
    { youtube_id: "dQw4w9WgXcQ", title: "a" },
    { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "dup" },
  ] });
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rejected, [{ index: 1, error: "duplicate youtube_id in this request" }]);
});

test("import requires configuration and a valid bearer token", async () => {
  let res = response();
  await handleRecommendationsImport({ headers: { authorization: "Bearer secret-token" } }, res, validBody, {});
  assert.equal(res.statusCode, 503);

  for (const authorization of [undefined, "secret-token", "Bearer wrong", "Basic secret-token"]) {
    res = response();
    await handleRecommendationsImport({ headers: { authorization } }, res, validBody, ENV, { createSupabase: () => { throw new Error("must not reach database"); } });
    assert.equal(res.statusCode, 401, String(authorization));
  }
});

test("import upserts valid rows for the configured user and reports counts", async () => {
  const db = fakeSupabase({ existing: ["arj7oStGLkU"] });
  const res = response();
  const body = { ...validBody, items: [...validBody.items, { title: "missing url" }] };
  await handleRecommendationsImport({ headers: { authorization: "Bearer secret-token" } }, res, body, ENV, { createSupabase: () => db.client, checkEmbeddable: async (id) => id !== "arj7oStGLkU", warmTranscript: async (id) => (id === "dQw4w9WgXcQ" ? "stored" : "cached") });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.items, [{ youtube_id: "dQw4w9WgXcQ", embeddable: true, transcript: "stored" }, { youtube_id: "arj7oStGLkU", embeddable: false, transcript: "cached" }]);
  assert.deepEqual({ ...res.body, rejected: res.body.rejected.length, items: undefined }, { ok: true, date: "2026-10-11", received: 3, inserted: 1, updated: 1, rejected: 1, items: undefined });
  assert.equal(db.calls.table, "daily_recommendations");
  assert.deepEqual(db.calls.filters.slice(0, 2), [["user_id", USER_ID], ["rec_date", "2026-10-11"]]);
  const [{ records, options }] = db.calls.upserts;
  assert.equal(options.onConflict, "user_id,rec_date,youtube_id");
  assert.equal(records.length, 2);
  for (const record of records) {
    assert.equal(record.user_id, USER_ID);
    assert.equal(record.rec_date, "2026-10-11");
    assert.ok(!("watched_at" in record) && !("favorited" in record), "status columns must not be overwritten");
  }
  assert.equal(records[1].source, "digest");
});

test("import returns 400 when no item is valid", async () => {
  const res = response();
  await handleRecommendationsImport({ headers: { authorization: "Bearer secret-token" } }, res, { date: "2026-10-11", source: "digest", items: [{ title: "x" }] }, ENV, { createSupabase: () => fakeSupabase().client, checkEmbeddable: async () => true });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.rejected.length, 1);
});

test("API wrapper enforces POST, parses JSON, and hides database errors", async () => {
  const api = recommendationsImportApi(async () => { throw Object.assign(new Error("private db detail"), { code: "DATABASE_ERROR" }); });
  for (const [req, status] of [[{ method: "GET" }, 405], [{ method: "POST", body: "{" }, 400], [{ method: "POST", body: "{}" }, 502]]) {
    const res = response();
    await api(req, res);
    assert.equal(res.statusCode, status);
    assert.equal(res.headers["Cache-Control"], "no-store");
    assert.ok(!JSON.stringify(res.body).includes("private db detail"));
  }
});
