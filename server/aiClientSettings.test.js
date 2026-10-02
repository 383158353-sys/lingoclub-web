import test from "node:test";
import assert from "node:assert/strict";
import { decryptCredentialSecret, encryptCredentialSecret, isSafeProviderUrl, maskCredentialSecret } from "./aiCredentials.js";
import { openAICompatibleRequest } from "./aiProviders/openaiCompatible.js";
import { geminiEndpoint, geminiModelsEndpoint, geminiRequest } from "./aiProviders/gemini.js";
import { openAIResponsesEndpoint, openAIResponsesRequest, readOpenAIResponsesResponse } from "./aiProviders/openaiResponses.js";
import { aiCacheKey, clearAICache } from "../src/lib/localApi.js";

const testEnv = { AI_CREDENTIALS_MASTER_KEY: "unit-test-only-encryption-key" };

test("AI credential secrets use authenticated AES-256-GCM storage envelopes", () => {
  const encrypted = encryptCredentialSecret("provider-secret", testEnv);
  assert.match(encrypted, /^v1\./);
  assert.notEqual(encrypted, "provider-secret");
  assert.equal(decryptCredentialSecret(encrypted, testEnv), "provider-secret");
  assert.throws(() => decryptCredentialSecret(`${encrypted.slice(0, -2)}AA`, testEnv));
});

test("public key masking exposes only a short suffix and no decryptable value", () => {
  assert.equal(maskCredentialSecret("sk-very-secret-XY"), "sk-••••••••XY");
  assert.equal(maskCredentialSecret(""), "");
});

test("official and relay provider adapters use the intended protocol", () => {
  const openai = openAICompatibleRequest("https://api.openai.com/v1", "secret", "gpt-test", "prompt");
  assert.equal(openai.url, "https://api.openai.com/v1/chat/completions");
  assert.match(openai.options.headers.Authorization, /secret/);
  const gemini = geminiRequest("https://generativelanguage.googleapis.com", "secret", "gemini-test", "prompt", { type: "OBJECT" });
  assert.equal(gemini.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent");
  assert.equal(gemini.options.headers["x-goog-api-key"], "secret");
});

test("Gemini base URLs with or without v1beta normalize to one models path", () => {
  for (const baseUrl of ["https://generativelanguage.googleapis.com", "https://generativelanguage.googleapis.com/", "https://generativelanguage.googleapis.com/v1beta", "https://generativelanguage.googleapis.com/v1beta/"]) {
    assert.equal(geminiModelsEndpoint(baseUrl), "https://generativelanguage.googleapis.com/v1beta/models");
    assert.equal(geminiEndpoint(baseUrl, "gemini-2.5-flash"), "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
    assert.doesNotMatch(geminiEndpoint(baseUrl, "gemini-2.5-flash"), /v1beta\/v1beta/);
  }
});

test("Gemini minimal connectivity probe omits schema and generation config", () => {
  const probe = geminiRequest("https://generativelanguage.googleapis.com/v1beta/", "secret", "gemini-2.5-flash", "Reply only with OK", null, { minimal: true });
  assert.equal(probe.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
  assert.deepEqual(JSON.parse(probe.options.body), { contents: [{ role: "user", parts: [{ text: "Reply only with OK" }] }] });
});

test("account connection probe uses only model and messages without JSON-mode parameters", () => {
  const probe = openAICompatibleRequest("https://api.lk888.ai/v1", "secret", "gem-3.5-flash-lite", "Reply with only: OK", { jsonResponse: false });
  assert.equal(probe.url, "https://api.lk888.ai/v1/chat/completions");
  assert.deepEqual(JSON.parse(probe.options.body), { model: "gem-3.5-flash-lite", messages: [{ role: "user", content: "Reply with only: OK" }] });
});

test("official OpenAI Responses adapter uses its own endpoint, request shape, and parsers", () => {
  const request = openAIResponsesRequest("secret", "gpt-test", "Reply only with OK", { minimal: true });
  assert.equal(openAIResponsesEndpoint(), "https://api.openai.com/v1/responses");
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.deepEqual(JSON.parse(request.options.body), { model: "gpt-test", input: "Reply only with OK" });
  assert.equal(request.options.headers.Authorization, "Bearer secret");
  assert.equal(readOpenAIResponsesResponse({ output_text: "OK" }), "OK");
  assert.equal(readOpenAIResponsesResponse({ output: [{ content: [{ type: "output_text", text: "{\"ok\":true}" }] }] }), "{\"ok\":true}");
});

test("custom AI endpoints require public HTTPS and reject local/private hosts", () => {
  assert.equal(isSafeProviderUrl("https://relay.example/v1"), true);
  for (const value of ["http://relay.example", "https://localhost/v1", "https://192.168.1.2/v1", "https://10.0.0.2/v1", "https://172.16.0.1/v1"]) assert.equal(isSafeProviderUrl(value), false, value);
});

test("AI cache partitions by credential/provider/model but never includes the secret", () => {
  const payload = { video_id: "video", subtitle_text: "a line", expression_en: "line" };
  const first = aiCacheKey("word_lookup", payload, "cred-a|openai|gpt-one");
  const second = aiCacheKey("word_lookup", payload, "cred-b|gemini|gemini-two");
  assert.notEqual(first, second);
  assert.doesNotMatch(first, /provider-secret|secret|gpt-one|openai/);
});

test("AI cache clear only removes AI response cache entries", () => {
  const oldLocal = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = { get length() { return values.size; }, key: (i) => [...values.keys()][i] ?? null, removeItem: (key) => values.delete(key), setItem: (key, value) => values.set(key, value), getItem: (key) => values.get(key) ?? null };
  try {
    values.set("lingoclub:ai:v1:a", "cached"); values.set("unrelated:user-setting", "keep");
    assert.equal(clearAICache(), 1);
    assert.equal(values.has("lingoclub:ai:v1:a"), false);
    assert.equal(values.get("unrelated:user-setting"), "keep");
  } finally { if (oldLocal === undefined) delete globalThis.localStorage; else globalThis.localStorage = oldLocal; }
});
