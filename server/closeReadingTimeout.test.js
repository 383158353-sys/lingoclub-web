import test from "node:test";
import assert from "node:assert/strict";
import { handleAI, requestJson, upstreamTimeoutsForTask } from "./ai.js";
import { classifyAIError } from "./aiErrorResponse.js";
import { CLOSE_READING_CLIENT_TIMEOUT_MS, CLOSE_READING_UPSTREAM_TIMEOUT_MS, describeCloseReadingError, isTransientCloseReadingError, requestCloseReading } from "../src/lib/closeReading.js";
import { readFileSync } from "node:fs";

function recorder() { return { statusCode: 200, body: "", end(value) { this.body = value; } }; }
const relayCredential = async (_req, id) => ({ id, type: "relay", provider: "gemini", base_url: "https://api.lk888.ai", api_key: "test-only-secret", model: "tt-6-luna", fast_model: "tt-6-luna" });

test("close-reading timeouts fit inside the Vercel function limit and the client waits longer than the server", () => {
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const maxDurationMs = vercel.functions["api/*.js"].maxDuration * 1000;
  const { timeoutMs, budgetMs } = upstreamTimeoutsForTask("translate_sentence");
  assert.equal(timeoutMs, CLOSE_READING_UPSTREAM_TIMEOUT_MS);
  assert.ok(timeoutMs > 25_000, "精读 must not be cut at the old 25s");
  assert.ok(budgetMs < maxDurationMs);
  assert.ok(CLOSE_READING_CLIENT_TIMEOUT_MS > budgetMs, "client must outlast the server so it receives the real error");
  assert.ok(CLOSE_READING_CLIENT_TIMEOUT_MS < maxDurationMs + 5_000);
  assert.equal(upstreamTimeoutsForTask("word_lookup").timeoutMs, 25_000);
});

test("requestJson does not start a retry that cannot finish inside the budget", async () => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (_url, { signal }) => { calls += 1; return new Promise((_, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))); };
  try {
    await assert.rejects(requestJson("https://relay.invalid", {}, "", { timeoutMs: 60, budgetMs: 80 }), (error) => error.name === "TimeoutError" && error.timeout === true && error.timeoutMs === 60);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = oldFetch; }
});

test("requestJson still retries a fast 5xx once when budget remains", async () => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return calls === 1 ? new Response(JSON.stringify({ error: { message: "busy" } }), { status: 503 }) : new Response(JSON.stringify({ ok: 1 }), { status: 200 }); };
  try {
    assert.deepEqual(await requestJson("https://relay.invalid", {}, "", { timeoutMs: 1000, budgetMs: 20_000 }), { ok: 1 });
    assert.equal(calls, 2);
  } finally { globalThis.fetch = oldFetch; }
});

test("精读 upstream timeout returns 504 TIMEOUT naming the relay, model and wait, without leaking the key", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (_url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  try {
    const res = recorder();
    let thrown;
    try {
      await handleAI({}, res, { credential_id: "c1", task: "translate_sentence", text_en: "I'll keep that in mind." }, { NODE_ENV: "test", AI_CLOSE_READING_TIMEOUT_MS: "50", AI_FUNCTION_BUDGET_MS: "60", __AI_CREDENTIAL_LOOKUP_TEST_ONLY: relayCredential });
    } catch (error) { thrown = error; }
    assert.ok(thrown);
    const failure = classifyAIError(thrown);
    assert.equal(failure.status, 504);
    assert.equal(failure.code, "TIMEOUT");
    assert.match(failure.error, /中转站/);
    assert.match(failure.error, /tt-6-luna/);
    assert.equal(failure.model, "tt-6-luna");
    assert.doesNotMatch(JSON.stringify(failure), /test-only-secret/);
  } finally { globalThis.fetch = oldFetch; }
});

test("requestCloseReading auto-retries one fast transient failure but never a timeout", async () => {
  let calls = 0;
  const flaky = async (task, _payload, options) => {
    calls += 1;
    assert.equal(task, "translate_sentence");
    assert.equal(options.timeoutMs, CLOSE_READING_CLIENT_TIMEOUT_MS);
    if (calls === 1) throw Object.assign(new Error("中转站服务暂时不可用"), { status: 502, code: "HTTP_503" });
    return { analysis: { translation: "我会记住的" } };
  };
  assert.deepEqual(await requestCloseReading(flaky, { text_en: "x" }, { sleep: async () => {} }), { translation: "我会记住的" });
  assert.equal(calls, 2);

  calls = 0;
  const slow = async () => { calls += 1; throw Object.assign(new Error("Request timed out"), { name: "TimeoutError", code: "REQUEST_TIMEOUT", timeoutMs: 58_000 }); };
  await assert.rejects(requestCloseReading(slow, {}, { sleep: async () => {} }), { code: "REQUEST_TIMEOUT" });
  assert.equal(calls, 1);

  calls = 0;
  const empty = async () => { calls += 1; return {}; };
  await assert.rejects(requestCloseReading(empty, {}, { sleep: async () => {} }), { code: "EMPTY_ANALYSIS" });
  assert.equal(calls, 2);

  assert.equal(isTransientCloseReadingError(Object.assign(new Error("x"), { status: 502, code: "AUTH_ERROR" })), false);
  assert.equal(isTransientCloseReadingError(Object.assign(new Error("x"), { status: 504, code: "TIMEOUT" })), false);
});

test("close-reading errors distinguish slow relay from other failures and surface upstream status", () => {
  const clientTimeout = describeCloseReadingError(Object.assign(new Error("Request timed out"), { name: "TimeoutError", code: "REQUEST_TIMEOUT", timeoutMs: 58_000 }));
  assert.equal(clientTimeout.title, "精读超时");
  assert.match(clientTimeout.description, /58 秒/);
  assert.match(clientTimeout.description, /AI 设置/);

  const serverTimeout = describeCloseReadingError(Object.assign(new Error("中转站 50 秒内没有返回结果（模型 tt-6-luna 可能太慢）"), { name: "APIResponseError", status: 504, code: "TIMEOUT", model: "tt-6-luna" }));
  assert.equal(serverTimeout.title, "精读超时");
  assert.match(serverTimeout.description, /50 秒内.*tt-6-luna/);

  const upstream = describeCloseReadingError(Object.assign(new Error("服务暂时不可用"), { name: "APIResponseError", status: 502, code: "HTTP_503", upstreamStatus: 503, upstreamMessage: "model overloaded" }));
  assert.equal(upstream.title, "AI 解析失败");
  assert.equal(upstream.description, "服务暂时不可用（HTTP 502 · 上游 503：model overloaded）");
});
