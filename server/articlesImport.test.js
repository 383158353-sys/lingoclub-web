import test from "node:test";
import assert from "node:assert/strict";
import { articlesImportApi, handleArticlesImport, normalizeArticle, validateArticlesPayload } from "./articlesImport.js";
import { readFileSync } from "node:fs";

const env = { RECOMMENDATIONS_IMPORT_TOKEN: "test-token", RECOMMENDATIONS_IMPORT_USER_ID: "11111111-2222-4333-8444-555555555555" };
const req = { method: "POST", headers: { authorization: "Bearer test-token" } };
const item = { source_url: "https://example.com/read", title: "A morning read", body_en: "One paragraph.\n\nAnother paragraph." };
const body = { date: "2026-10-14", source: "morning_read", items: [item] };
const response = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(text) { this.body = JSON.parse(text); } });
function database(existing = [], failure = "") {
  const calls = {};
  const query = {
    select() { return query; },
    eq(key, value) { (calls.filters ||= []).push([key, value]); return query; },
    in() { return Promise.resolve({ data: existing.map((source_url) => ({ source_url })), error: failure === "lookup" ? {} : null }); },
    upsert(records, options) { calls.records = records; calls.options = options; return Promise.resolve({ error: failure === "upsert" ? {} : null }); },
  };
  return { calls, client: { from(table) { calls.table = table; return query; } } };
}
test("article validation accepts complete content and defaults analysis", () => {
  assert.deepEqual(normalizeArticle(item).row.analysis, {});
  const analysis = { key_vocab: [{ en: "morning", zh: "早晨" }], extra: { supported: true } };
  assert.deepEqual(normalizeArticle({ ...item, analysis, tags: [" a ", "a"] }).row.analysis, analysis);
  assert.deepEqual(normalizeArticle({ ...item, tags: [" a ", "a"] }).row.tags, ["a"]);
});
test("article validation rejects unsafe URLs, malformed fields and all limits", () => {
  for (const bad of [null, [], { ...item, source_url: "javascript:alert(1)" }, { ...item, source_url: "https://user:pass@example.com" }, { ...item, title: " " }, { ...item, body_en: "" }, { ...item, analysis: [] }, { ...item, analysis: null }, { ...item, analysis: "x" }, { ...item, tags: null }, { ...item, tags: Array(21).fill("a") }, { ...item, tags: ["a".repeat(41)] }]) assert.ok(normalizeArticle(bad).error, JSON.stringify(bad));
  for (const [key, size] of Object.entries({ title: 300, author: 120, outlet: 120, level: 32, summary_zh: 4000, body_en: 50000 })) {
    assert.ok(normalizeArticle({ ...item, [key]: "x".repeat(size) }).row, key);
    assert.ok(normalizeArticle({ ...item, [key]: "x".repeat(size + 1) }).error, key);
    assert.ok(normalizeArticle({ ...item, [key]: 12 }).error, key);
  }
  assert.ok(normalizeArticle({ ...item, source_url: `https://example.com/${"x".repeat(2048)}` }).error);
  assert.ok(normalizeArticle({ ...item, analysis: { x: "x".repeat(200001) } }).error);
});
test("payload validates calendar dates, batches, mixed results and duplicate URLs", () => {
  for (const bad of [null, [], { ...body, date: "2026-02-30" }, { ...body, items: [] }, { ...body, items: Array(11).fill(item) }, { ...body, source: "unknown" }]) assert.ok(validateArticlesPayload(bad).error);
  const parsed = validateArticlesPayload({ ...body, items: [item, { ...item }, { ...item, title: "" }] });
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(parsed.rejected.map((row) => row.index), [1, 2]);
});
test("authentication and configuration are checked before database access", async () => {
  for (const authorization of [undefined, "Basic test-token", "Bearer wrong", "test-token"]) {
    const res = response();
    await handleArticlesImport({ headers: { authorization } }, res, body, env, { createSupabase() { throw new Error("unexpected database access"); } });
    assert.equal(res.statusCode, 401);
  }
  const res = response(); await handleArticlesImport(req, res, body, {}); assert.equal(res.statusCode, 503);
});
test("import upserts only content for configured user and preserves status", async () => {
  const db = database([item.source_url]); const res = response();
  await handleArticlesImport(req, res, { ...body, items: [{ ...item, read_at: "evil", favorited: false }, { ...item, source_url: "https://example.com/new" }, { ...item, title: "" }] }, env, { createSupabase: () => db.client });
  assert.equal(res.statusCode, 200); assert.equal(res.body.updated, 1); assert.equal(res.body.inserted, 1); assert.equal(res.body.rejected.length, 1);
  assert.equal(db.calls.table, "daily_articles"); assert.equal(db.calls.options.onConflict, "user_id,rec_date,source_url");
  assert.deepEqual(db.calls.filters, [["user_id", env.RECOMMENDATIONS_IMPORT_USER_ID], ["rec_date", body.date]]);
  for (const row of db.calls.records) { assert.equal(row.user_id, env.RECOMMENDATIONS_IMPORT_USER_ID); assert.equal("read_at" in row, false); assert.equal("favorited" in row, false); }
});
test("invalid-only payload and unavailable database are rejected", async () => {
  let res = response(); await handleArticlesImport(req, res, { ...body, items: [{}] }, env); assert.equal(res.statusCode, 400);
  res = response(); await handleArticlesImport(req, res, body, env, { createSupabase: () => null }); assert.equal(res.statusCode, 503);
});
test("API enforces POST, JSON and sanitized failure responses", async () => {
  let res = response(); await articlesImportApi()({ method: "GET" }, res); assert.equal(res.statusCode, 405); assert.equal(res.headers.Allow, "POST");
  res = response(); await articlesImportApi()({ ...req, body: "{" }, res); assert.equal(res.statusCode, 400);
  res = response(); await articlesImportApi(async () => { throw Object.assign(new Error("secret"), { code: "DATABASE_ERROR" }); })({ ...req, body }, res);
  assert.equal(res.statusCode, 502); assert.equal(res.body.code, "DATABASE_ERROR"); assert.equal(JSON.stringify(res.body).includes("secret"), false);
  for (const failure of ["lookup", "upsert"]) {
    const db = database([], failure);
    await assert.rejects(handleArticlesImport(req, response(), body, env, { createSupabase: () => db.client }), { code: "DATABASE_ERROR" });
  }
});
test("article migrations restrict browser privileges and grant service role", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261014000000_daily_articles.sql", import.meta.url), "utf8");
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /grant update \(read_at, favorited, updated_at\)/i);
  assert.match(sql, /unique \(user_id, rec_date, source_url\)/i);
  assert.equal(/grant (?:insert|delete|all).*to authenticated/i.test(sql), false);
  assert.match(readFileSync(new URL("../supabase/migrations/20261014010000_daily_articles_service_role_grant.sql", import.meta.url), "utf8"), /grant select, insert, update, delete .* to service_role/);
});
