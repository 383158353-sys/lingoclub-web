import test from "node:test";
import assert from "node:assert/strict";
import { handleAI } from "./ai.js";
import { classifyAIError, sendAIError } from "./aiErrorResponse.js";

function recorder() { return { statusCode: 200, body: "", end(value) { this.body = value; } }; }

test("AI is not configured without an account credential id and never falls back to AI_* env", async () => {
  const res = recorder();
  await handleAI({}, res, { task: "word_lookup", expression_en: "quiet" }, { AI_BASE_URL: "https://legacy.invalid", AI_API_KEY: "must-not-use", AI_MODEL: "legacy" });
  assert.equal(res.statusCode, 503);
  assert.deepEqual(JSON.parse(res.body), { error: "AI_NOT_CONFIGURED", code: "AI_NOT_CONFIGURED" });
  assert.doesNotMatch(res.body, /must-not-use|AI_API_KEY|BASE_URL/);
});

test("OpenAI-compatible relay request loads only the selected credential and never returns its key", async () => {
  const oldFetch = globalThis.fetch;
  let observed;
  globalThis.fetch = async (url, options) => {
    observed = { url, options };
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"meaning":"安静的","pos":"形容词","phonetic_us":"/kwaɪət/"}' } }] }), { status: 200 });
  };
  try {
    const res = recorder();
    await handleAI({}, res, { credential_id: "credential-1", task: "word_lookup", expression_en: "quiet" }, {
      NODE_ENV: "test",
      __AI_CREDENTIAL_LOOKUP_TEST_ONLY: async (_req, id) => { assert.equal(id, "credential-1"); return { id, type: "relay", provider: "openai-compatible", base_url: "https://relay.invalid/v1", api_key: "private-key", model: "test-model", fast_model: "" }; },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(observed.url, "https://relay.invalid/v1/chat/completions");
    assert.equal(observed.options.headers.Authorization, "Bearer private-key");
    assert.equal(JSON.parse(res.body).profile.meaning, "安静的");
    assert.doesNotMatch(res.body, /private-key/);
  } finally { globalThis.fetch = oldFetch; }
});

test("OpenAI-compatible relay stays on Chat Completions regardless of model name", async () => {
  const oldFetch = globalThis.fetch;
  let observed;
  globalThis.fetch = async (url, options) => {
    observed = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200 });
  };
  try {
    const res = recorder();
    await handleAI({}, res, { credential_id: "active-credential", task: "ai_connection_test" }, {
      NODE_ENV: "test",
      __AI_CREDENTIAL_LOOKUP_TEST_ONLY: async (_req, id) => ({ id, type: "relay", provider: "openai-compatible", base_url: "https://api.lk888.ai/v1", api_key: "test-only-secret", model: "gem-3.5-flash-lite", fast_model: "" }),
    });
    assert.equal(res.statusCode, 200);
    assert.equal(observed.url, "https://api.lk888.ai/v1/chat/completions");
    assert.deepEqual(observed.body, { model: "gem-3.5-flash-lite", messages: [{ role: "user", content: "Reply only with OK" }] });
    assert.equal(JSON.parse(res.body).connection.provider, "openai-compatible");
    assert.equal(JSON.parse(res.body).diagnostic.endpoint, "https://api.lk888.ai/v1/chat/completions");
    assert.doesNotMatch(res.body, /test-only-secret/);
  } finally { globalThis.fetch = oldFetch; }
});

test("official Gemini checks the account model list before a minimal native generateContent call", async () => {
  const oldFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    if (options.method === "GET") return new Response(JSON.stringify({ models: [
      { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent", "countTokens"] },
      { name: "models/text-embedding-test", supportedGenerationMethods: ["embedContent"] },
    ] }), { status: 200 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "OK" }] } }] }), { status: 200 });
  };
  try {
    const res = recorder();
    await handleAI({}, res, { credential_id: "official-gemini", task: "ai_connection_test" }, {
      NODE_ENV: "test",
      __AI_CREDENTIAL_LOOKUP_TEST_ONLY: async () => ({ id: "official-gemini", provider_type: "official", provider: "gemini", base_url: "https://generativelanguage.googleapis.com/v1beta/", api_key: "private-gemini-key", model: "gemini-2.5-flash", fast_model: "gemini-2.5-flash" }),
    });
    assert.equal(res.statusCode, 200);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, "https://generativelanguage.googleapis.com/v1beta/models");
    assert.equal(requests[0].options.method, "GET");
    assert.equal(requests[1].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
    assert.deepEqual(requests[1].body, { contents: [{ role: "user", parts: [{ text: "Reply only with OK" }] }] });
    assert.equal(requests[1].options.headers["x-goog-api-key"], "private-gemini-key");
    assert.equal(requests[1].options.headers.Authorization, undefined);
    const payload = JSON.parse(res.body);
    assert.equal(payload.connection.modelsStatus, 200);
    assert.equal(payload.connection.generateStatus, 200);
    assert.deepEqual(payload.connection.availableModels, ["gemini-2.5-flash"]);
    assert.doesNotMatch(res.body, /private-gemini-key|chat\/completions/);
  } finally { globalThis.fetch = oldFetch; }
});

test("official Gemini returns MODEL_NOT_AVAILABLE without calling generateContent", async () => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ models: [{ name: "models/gemini-2.0-flash", supportedGenerationMethods: ["generateContent"] }] }), { status: 200 });
  };
  try {
    const res = recorder();
    await handleAI({}, res, { credential_id: "official-gemini", task: "ai_connection_test" }, {
      NODE_ENV: "test",
      __AI_CREDENTIAL_LOOKUP_TEST_ONLY: async () => ({ id: "official-gemini", provider_type: "official", provider: "gemini", base_url: "https://generativelanguage.googleapis.com", api_key: "private-gemini-key", model: "gemini-2.5-flash", fast_model: "" }),
    });
    assert.equal(res.statusCode, 409);
    assert.equal(calls, 1);
    assert.deepEqual(JSON.parse(res.body).availableModels, ["gemini-2.0-flash"]);
    assert.equal(JSON.parse(res.body).code, "MODEL_NOT_AVAILABLE");
    assert.doesNotMatch(res.body, /private-gemini-key|chat\/completions/);
  } finally { globalThis.fetch = oldFetch; }
});

test("official Gemini lists only models with generateContent support", async () => {
  const oldFetch = globalThis.fetch;
  let observedUrl;
  globalThis.fetch = async (url, options) => {
    observedUrl = url;
    assert.equal(options.method, "GET");
    return new Response(JSON.stringify({ models: [
      { name: "models/gemini-3-flash", displayName: "Flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-embedding", supportedGenerationMethods: ["embedContent"] },
    ] }), { status: 200 });
  };
  try {
    const res = recorder();
    await handleAI({}, res, { credential_id: "official-gemini", task: "gemini_list_models" }, {
      NODE_ENV: "test",
      __AI_CREDENTIAL_LOOKUP_TEST_ONLY: async () => ({ id: "official-gemini", provider_type: "official", provider: "gemini", base_url: "https://generativelanguage.googleapis.com/", api_key: "secret", model: "", fast_model: "" }),
    });
    assert.equal(res.statusCode, 200);
    assert.equal(observedUrl, "https://generativelanguage.googleapis.com/v1beta/models");
    assert.deepEqual(JSON.parse(res.body).modelIds, ["gemini-3-flash"]);
    assert.doesNotMatch(res.body, /secret|chat\/completions/);
  } finally { globalThis.fetch = oldFetch; }
});

test("official Gemini model list excludes TTS and audio-only output models", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ models: [
    { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"], supportedOutputModalities: ["TEXT"] },
    { name: "models/gemini-3.8-flash-tts", displayName: "Flash TTS", supportedGenerationMethods: ["generateContent"], supportedOutputModalities: ["AUDIO"] },
    { name: "models/gemini-audio-only", supportedGenerationMethods: ["generateContent"], outputModalities: ["AUDIO"] },
    { name: "models/gemini-embedding", supportedGenerationMethods: ["embedContent"] },
  ] }), { status: 200 });
  try {
    const res = recorder();
    await handleAI({}, res, { credential_id: "official-gemini", task: "gemini_list_models" }, {
      NODE_ENV: "test",
      __AI_CREDENTIAL_LOOKUP_TEST_ONLY: async () => ({ id: "official-gemini", type: "official", provider: "gemini", api_key: "secret", model: "", fast_model: "" }),
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body).modelIds, ["gemini-3.8-flash"]);
  } finally { globalThis.fetch = oldFetch; }
});

test("manually selected Gemini TTS model is rejected as unsuitable for text analysis", async () => {
  const oldFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => { fetchCount += 1; throw new Error("must not call TTS model"); };
  try {
    const res = recorder();
    await handleAI({}, res, { credential_id: "official-gemini", task: "ai_connection_test" }, {
      NODE_ENV: "test",
      __AI_CREDENTIAL_LOOKUP_TEST_ONLY: async () => ({ id: "official-gemini", type: "official", provider: "gemini", api_key: "secret", model: "gemini-3.8-flash-tts", fast_model: "" }),
    });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).code, "GEMINI_TEXT_MODEL_REQUIRED");
    assert.match(JSON.parse(res.body).error, /不能用于文本分析/);
    assert.equal(fetchCount, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("Gemini-compatible relay uses one native adapter for connection and business tasks", async () => {
  const oldFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url: String(url), options, body });
    const text = body.contents?.[0]?.parts?.[0]?.text || "";
    const responseText = text === "Reply only with OK" ? "OK" : "{}";
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: responseText }] } }] }), { status: 200 });
  };
  try {
    const credential = { id: "relay-credential-7", provider_type: "relay", provider: "gemini", base_url: "https://api.lk888.ai", api_key: "never-return-this-key", key_hint: "XY", model: "gem-3.8-flash", fast_model: "gem-3.5-flash-lite" };
    const tasks = [
      [{ task: "ai_connection_test" }, "OK"],
      [{ task: "word_lookup", expression_en: "debate", subtitle_text: "We had a debate." }, "{}"],
      [{ task: "vocabulary_analysis", expression_en: "debate", expression_type: "word" }, "gem-3.8-flash"],
      [{ task: "subtitle_batch", cues: [{ cueId: "c1", text: "We should go." }] }, "gem-3.8-flash"],
    ];
    const responses = [];
    for (const [body] of tasks) {
      const res = recorder();
      await handleAI({}, res, { credential_id: credential.id, ...body }, {
      NODE_ENV: "test",
      __AI_CREDENTIAL_LOOKUP_TEST_ONLY: async () => credential,
      });
      responses.push(JSON.parse(res.body));
      assert.equal(res.statusCode, 200);
    }
    assert.deepEqual(requests.map((item) => item.url), [
      "https://api.lk888.ai/v1beta/models/gem-3.8-flash:generateContent",
      "https://api.lk888.ai/v1beta/models/gem-3.8-flash:generateContent",
      "https://api.lk888.ai/v1beta/models/gem-3.8-flash:generateContent",
      "https://api.lk888.ai/v1beta/models/gem-3.8-flash:generateContent",
    ]);
    assert.equal(requests[0].options.headers["x-goog-api-key"], "never-return-this-key");
    assert.equal(requests[0].options.headers.Authorization, undefined);
    assert.deepEqual(requests[0].body, { contents: [{ role: "user", parts: [{ text: "Reply only with OK" }] }] });
    for (const request of requests) {
      assert.deepEqual(Object.keys(request.body).sort(), ["contents"]);
      assert.equal(request.options.headers["Content-Type"], "application/json");
      assert.equal(request.options.headers["x-goog-api-key"], "never-return-this-key");
    }
    assert.equal(requests[0].url, requests[1].url, "connection test and cold word_lookup must use the same main model and endpoint");
    assert.equal(requests[0].url, requests[2].url, "connection test and vocabulary_analysis must use the same model and endpoint");
    assert.equal(responses[0].connection.provider, "gemini");
    assert.ok("profile" in responses[1]);
    assert.ok("profile" in responses[2]);
    assert.ok("batch" in responses[3]);
    assert.ok(responses.every((response) => !JSON.stringify(response).includes("never-return-this-key")));
  } finally { globalThis.fetch = oldFetch; }
});

test("relay translate_sentence uses the primary model and the minimal Gemini-compatible body", async () => {
  const oldFetch = globalThis.fetch;
  let observed;
  globalThis.fetch = async (url, options) => {
    observed = { url: String(url), headers: options.headers, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"translation":"这句台词。","words":[],"phrases":[],"grammar":"","cultural":""}' }] } }] }), { status: 200 });
  };
  try {
    const res = recorder();
    await handleAI({}, res, {
      credential_id: "relay-credential-7",
      task: "translate_sentence",
      text_en: "I guess I'll stop beating myself up.",
      subtitle_text: "I guess I'll stop beating myself up.",
      previous_cues: [{ text: "This is the previous line." }],
      next_cues: [{ text: "This is the next line." }],
    }, {
      NODE_ENV: "test",
      __AI_CREDENTIAL_LOOKUP_TEST_ONLY: async () => ({ id: "relay-credential-7", provider_type: "relay", provider: "gemini", base_url: "https://api.lk888.ai", api_key: "never-return-this-key", model: "gem-3.8-flash", fast_model: "gem-3.5-flash-lite" }),
    });
    const response = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.equal(observed.url, "https://api.lk888.ai/v1beta/models/gem-3.8-flash:generateContent");
    assert.deepEqual(Object.keys(observed.body).sort(), ["contents"]);
    assert.equal(observed.headers["x-goog-api-key"], "never-return-this-key");
    assert.match(observed.body.contents[0].parts[0].text, /I guess I'll stop beating myself up\./);
    assert.deepEqual(response.analysis, { translation: "这句台词。", words: [], phrases: [], grammar: "", cultural: "", pronunciation: "" });
  } finally { globalThis.fetch = oldFetch; }
});

test("official Gemini structured analysis omits thinkingConfig while using native JSON output", async () => {
  const oldFetch = globalThis.fetch;
  let observed;
  globalThis.fetch = async (url, options) => {
    observed = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"expression_type":"word","phonetic_us":"/weɪk/","phonetic_uk":"/weɪk/","senses":[{"pos":"v.","meanings":["醒来"]}],"roots":[],"synthesis":""}' }] } }] }), { status: 200 });
  };
  try {
    const res = recorder();
    await handleAI({}, res, { credential_id: "official-gemini", task: "vocabulary_analysis", expression_en: "wake", expression_type: "word" }, {
      NODE_ENV: "test",
      __AI_CREDENTIAL_LOOKUP_TEST_ONLY: async () => ({ id: "official-gemini", provider_type: "official", provider: "gemini", base_url: "https://generativelanguage.googleapis.com", api_key: "private-key", model: "gemini-2.5-flash", fast_model: "gemini-2.5-flash" }),
    });
    assert.equal(res.statusCode, 200);
    assert.equal(observed.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
    assert.equal(observed.options.headers["x-goog-api-key"], "private-key");
    assert.ok(observed.body.generationConfig.responseSchema);
    assert.equal(observed.body.generationConfig.thinkingConfig, undefined);
    assert.deepEqual(JSON.parse(res.body).profile.senses[0].meanings, ["醒来"]);
  } finally { globalThis.fetch = oldFetch; }
});

test("official Gemini vocabulary retries one 503 and then falls back to configured Fast Model", async () => {
  const oldFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    const request = { url, body: JSON.parse(options.body) };
    requests.push(request);
    if (requests.length <= 2) return new Response(JSON.stringify({ error: { code: 503, message: "high demand" } }), { status: 503 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"expression_type":"word","senses":[{"pos":"n.","meanings":["辩论"]}],"roots":[],"synthesis":""}' }] } }] }), { status: 200 });
  };
  try {
    const res = recorder();
    await handleAI({}, res, { credential_id: "official-gemini", task: "vocabulary_analysis", expression_en: "debate", expression_type: "word" }, {
      NODE_ENV: "test",
      __AI_CREDENTIAL_LOOKUP_TEST_ONLY: async () => ({ id: "official-gemini", type: "official", provider: "gemini", api_key: "private-key", model: "gemini-3.8-flash", fast_model: "gemini-3.5-flash-lite" }),
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(requests.map((request) => request.url), [
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
    ]);
    assert.equal(JSON.parse(res.body).diagnostic.model, "gemini-3.5-flash-lite");
    assert.deepEqual(JSON.parse(res.body).profile.senses[0].meanings, ["辩论"]);
    assert.doesNotMatch(res.body, /private-key/);
  } finally { globalThis.fetch = oldFetch; }
});

test("AI upstream errors retain a safe actionable category without secrets", () => {
  assert.equal(classifyAIError(Object.assign(new Error(), { status: 401 })).code, "AUTH_ERROR");
  assert.equal(classifyAIError(Object.assign(new Error(), { status: 404, providerMessage: "model gem-3.5-flash-lite not found" })).code, "MODEL_NOT_AVAILABLE");
  assert.equal(classifyAIError(Object.assign(new Error(), { status: 404 })).code, "ENDPOINT_NOT_FOUND");
  assert.equal(classifyAIError(Object.assign(new Error(), { status: 404, officialGemini: true, provider: "gemini" })).error, "Gemini 官方接口返回 404");
  assert.equal(classifyAIError(Object.assign(new Error(), { code: "GEMINI_MODELS_UNAVAILABLE", status: 502, upstreamStatus: 403 })).upstreamStatus, 403);
  assert.equal(classifyAIError(Object.assign(new Error(), { status: 429 })).code, "HTTP_429");
  assert.equal(classifyAIError(Object.assign(new Error(), { status: 400, providerMessage: "response_format not supported" })).code, "REQUEST_FORMAT_ERROR");
  assert.equal(classifyAIError(Object.assign(new Error(), { name: "TimeoutError" })).code, "TIMEOUT");
});

test("AI failure codes preserve network, timeout, upstream HTTP, empty, and parse distinctions", () => {
  assert.equal(classifyAIError(Object.assign(new Error(), { name: "TypeError", code: "FETCH_FAILED" })).code, "NETWORK_ERROR");
  assert.equal(classifyAIError(Object.assign(new Error(), { name: "TimeoutError", timeout: true })).code, "TIMEOUT");
  for (const status of [429, 502, 503, 504]) assert.equal(classifyAIError(Object.assign(new Error(), { status, upstreamStatus: status })).code, `HTTP_${status}`);
  assert.equal(classifyAIError(Object.assign(new Error(), { code: "UPSTREAM_EMPTY_RESPONSE", status: 502, upstreamStatus: 200 })).code, "UPSTREAM_EMPTY_RESPONSE");
  assert.equal(classifyAIError(Object.assign(new Error(), { code: "UPSTREAM_OK_PARSE_FAILED", status: 502, upstreamStatus: 200 })).code, "UPSTREAM_OK_PARSE_FAILED");
});

test("development AI failure log is redacted and includes only requested diagnostics", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousError = console.error;
  const logged = [];
  process.env.NODE_ENV = "development";
  console.error = (...args) => logged.push(args);
  try {
    const response = recorder();
    sendAIError(response, Object.assign(new Error("do not log prompt"), {
      status: 503, upstreamStatus: 503, providerType: "relay", provider: "gemini", model: "gem-3.8-flash",
      endpoint: "https://relay.example/v1beta/models/gem-3.8-flash:generateContent?secret=query-value",
      providerCode: "HIGH_DEMAND", providerMessage: "temporary upstream issue; Bearer token-secret-value",
      durationMs: 812, timeout: false, aborted: false,
    }), { task: "vocabulary_analysis" });
    assert.equal(response.statusCode, 502);
    assert.equal(JSON.parse(response.body).code, "HTTP_503");
    assert.equal(logged.length, 1);
    const [label, diagnostic] = logged[0];
    assert.equal(label, "[/api/ai] request failed");
    assert.deepEqual({ task: diagnostic.task, provider: diagnostic.provider, model: diagnostic.model, httpStatus: diagnostic.httpStatus, upstreamStatus: diagnostic.upstreamStatus, upstreamCode: diagnostic.upstreamCode, durationMs: diagnostic.durationMs, timeout: diagnostic.timeout, aborted: diagnostic.aborted, parseFailed: diagnostic.parseFailed }, {
      task: "vocabulary_analysis", provider: "gemini", model: "gem-3.8-flash", httpStatus: 502, upstreamStatus: 503, upstreamCode: "HIGH_DEMAND", durationMs: 812, timeout: false, aborted: false, parseFailed: false,
    });
    assert.equal(diagnostic.endpoint.includes("query-value"), false);
    assert.equal(diagnostic.upstreamMessage.includes("token-secret-value"), false);
    assert.equal(JSON.stringify(diagnostic).includes("do not log prompt"), false);
  } finally {
    console.error = previousError;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
  }
});

test("relay translate_sentence uses the tested main model and the minimal Gemini body", async () => {
  const oldFetch = globalThis.fetch;
  let observed;
    globalThis.fetch = async (url, options) => { observed = { url, options, body: JSON.parse(options.body) }; return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"translation":"你好。"}' }] } }] }), { status: 200 }); };
  try {
    const res = recorder();
    await handleAI({}, res, { credential_id: "gem-1", task: "translate_sentence", text_en: "Hello" }, {
      NODE_ENV: "test",
      __AI_CREDENTIAL_LOOKUP_TEST_ONLY: async () => ({ id: "gem-1", type: "relay", provider: "gemini", base_url: "https://api.lk888.ai", api_key: "private-key", model: "gem-3.8-flash", fast_model: "gem-3.5-flash-lite" }),
    });
    assert.equal(observed.url, "https://api.lk888.ai/v1beta/models/gem-3.8-flash:generateContent");
    assert.equal(observed.options.headers.Authorization, undefined);
    assert.equal(observed.options.headers["x-goog-api-key"], "private-key");
    assert.equal(observed.body.contents[0].parts[0].text.includes("Hello"), true);
    assert.equal(observed.body.generationConfig, undefined);
    assert.equal(JSON.parse(res.body).analysis.translation, "你好。");
    assert.doesNotMatch(res.body, /private-key/);
  } finally { globalThis.fetch = oldFetch; }
});

test("relay word_lookup uses the same main model as connection_test, not Fast Model", async () => {
  const oldFetch = globalThis.fetch;
  let observed;
  globalThis.fetch = async (url, options) => {
    observed = { url: String(url), options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{\"meaning\":\"辩论\",\"pos\":\"名词\",\"phonetic_us\":\"/dɪˈbeɪt/\"}' }] } }] }), { status: 200 });
  };
  try {
    const res = recorder();
    await handleAI({}, res, { credential_id: "gem-1", task: "word_lookup", expression_en: "debate", quick: true, subtitle_text: "We had a debate." }, {
      NODE_ENV: "test",
      __AI_CREDENTIAL_LOOKUP_TEST_ONLY: async () => ({ id: "gem-1", type: "relay", provider: "gemini", base_url: "https://api.lk888.ai", api_key: "private-key", model: "gem-3.8-flash", fast_model: "gem-3.5-flash-lite" }),
    });
    assert.equal(res.statusCode, 200);
    assert.equal(observed.url, "https://api.lk888.ai/v1beta/models/gem-3.8-flash:generateContent");
    assert.equal(observed.options.headers["x-goog-api-key"], "private-key");
    assert.equal(observed.body.generationConfig, undefined);
    assert.equal(JSON.parse(res.body).profile.meaning, "辩论");
  } finally { globalThis.fetch = oldFetch; }
});

test("official OpenAI uses only Responses API and parses output_text", async () => {
  const oldFetch = globalThis.fetch;
  let observed;
  globalThis.fetch = async (url, options) => {
    observed = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ output_text: "OK" }), { status: 200 });
  };
  try {
    const res = recorder();
    await handleAI({}, res, { credential_id: "official-openai", task: "ai_connection_test" }, {
      NODE_ENV: "test",
      __AI_CREDENTIAL_LOOKUP_TEST_ONLY: async () => ({ id: "official-openai", type: "official", provider: "openai", api_key: "private-openai-key", model: "gpt-test", fast_model: "" }),
    });
    assert.equal(res.statusCode, 200);
    assert.equal(observed.url, "https://api.openai.com/v1/responses");
    assert.deepEqual(observed.body, { model: "gpt-test", input: "Reply only with OK" });
    assert.equal(observed.options.headers.Authorization, "Bearer private-openai-key");
    assert.equal(observed.options.headers["x-goog-api-key"], undefined);
    assert.equal(JSON.parse(res.body).diagnostic.responseShape, "responses.output/output_text");
    assert.doesNotMatch(res.body, /private-openai-key|chat\/completions|generateContent/);
  } finally { globalThis.fetch = oldFetch; }
});
