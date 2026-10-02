import assert from "node:assert/strict";
import test from "node:test";
import { endpoint, handleAI, normalizeAnalysisResult, parseJsonContent } from "./ai.js";
import { handleYouTubeTranscript, linesFromEvents, videoId } from "./youtubeTranscript.js";
import { buildLocalDistractors, buildReviewOptions, buildReviewQuestion, isCorrectReviewAnswer } from "../src/lib/reviewDistractors.js";
import { createTranscriptHttpServer, extractWithRetries } from "./transcript/httpService.js";

function responseRecorder() {
  return {
    statusCode: 0,
    body: "",
    end(value = "") { this.body = String(value); },
  };
}

test("OpenAI-compatible endpoint is normalized", () => {
  assert.equal(endpoint("https://api.example.com/v1/"), "https://api.example.com/v1/chat/completions");
  assert.equal(endpoint("https://api.example.com/v1/chat/completions"), "https://api.example.com/v1/chat/completions");
  assert.deepEqual(parseJsonContent("```json\n{\"ok\":true}\n```"), { ok: true });
});

test("AI handler reads credentials from server env and returns a profile", async () => {
  const previousFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"meaning":"测试","pos":"名词","phonetic_us":"/test/"}' } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const res = responseRecorder();
    await handleAI({}, res, { credential_id: "cred", task: "word_lookup", expression_en: "test" }, {
      NODE_ENV: "test", __AI_CREDENTIAL_LOOKUP_TEST_ONLY: async () => ({ type: "relay", provider: "openai-compatible", base_url: "https://api.example.com/v1", api_key: "server-only-key", model: "test-model" }),
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body).profile.meaning, "测试");
    assert.equal(request.url, "https://api.example.com/v1/chat/completions");
    assert.equal(request.options.headers.Authorization, "Bearer server-only-key");
    assert.equal(JSON.parse(request.options.body).model, "test-model");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("AI handler supports every local learning task", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 });
  try {
    const cases = [
      [{ task: "word_lookup", expression_en: "test" }, "profile"],
      [{ task: "vocabulary_analysis", expression_en: "test" }, "profile"],
      [{ task: "translate_sentence", text_en: "This is a test." }, "analysis"],
      [{ task: "subtitle_batch", video_id: "v", cues: [{ cueId: "c1", text: "Call me." , target: true }] }, "batch"],
      [{ task: "subtitle_translate_batch", video_id: "v", cues: [{ cueId: "c1", text: "Call me.", target: true }] }, "translation_batch"],
      [{ task: "subtitle_learning_batch", video_id: "v", cues: [{ cueId: "c1", text: "Call me.", target: true }] }, "learning_batch"],
      [{ task: "generate_distractors", expression_en: "test", meaning_zh: "测试" }, "distractors"],
    ];
    for (const [body, responseKey] of cases) {
      const res = responseRecorder();
      await handleAI({}, res, { ...body, credential_id: "cred" }, { NODE_ENV: "test", __AI_CREDENTIAL_LOOKUP_TEST_ONLY: async () => ({ type: "relay", provider: "openai-compatible", base_url: "https://api.example.com/v1", api_key: "key", model: "model" }) });
      assert.equal(res.statusCode, 200);
      assert.ok(responseKey in JSON.parse(res.body));
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("subtitle translation batch uses Fast Model and returns translations only", async () => {
  const previousFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"cues":[{"cueId":"c1","translation":"给我打电话。"}]}' }] } }] }), { status: 200 });
  };
  try {
    const res = responseRecorder();
    await handleAI({}, res, { credential_id: "subtitle-fast", task: "subtitle_translate_batch", video_id: "v", subtitle_hash: "h", block_id: "b0", cues: [{ cueId: "ctx", text: "Earlier line.", target: false }, { cueId: "c1", text: "Call me.", target: true }] }, {
      NODE_ENV: "test",
      __AI_CREDENTIAL_LOOKUP_TEST_ONLY: async () => ({ type: "official", provider: "gemini", base_url: "https://generativelanguage.googleapis.com", api_key: "key", model: "main-model", fast_model: "fast-model" }),
    });
    const body = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.match(request.url, /fast-model/);
    assert.deepEqual(Object.keys(body.translation_batch.cues[0]).sort(), ["cueId", "translation"]);
    assert.deepEqual(Object.keys(request.body.generationConfig.responseSchema.properties), ["cues"]);
    const prompt = request.body.contents[0].parts[0].text;
    assert.match(prompt, /CONTEXT \[ctx\]/);
    assert.match(prompt, /Do not analyze vocabulary/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("nearby subtitle learning batch uses Fast Model and requests only cached words and phrases", async () => {
  const previousFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"cues":[{"cueId":"c1","difficultWords":[],"phrases":[]}]}' }] } }] }), { status: 200 });
  };
  try {
    const res = responseRecorder();
    await handleAI({}, res, { credential_id: "subtitle-learning", task: "subtitle_learning_batch", video_id: "v", subtitle_hash: "h", block_id: "l0", cues: [{ cueId: "c1", text: "Call me.", target: true }] }, {
      NODE_ENV: "test",
      __AI_CREDENTIAL_LOOKUP_TEST_ONLY: async () => ({ type: "official", provider: "gemini", base_url: "https://generativelanguage.googleapis.com", api_key: "key", model: "main-model", fast_model: "fast-model" }),
    });
    const body = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.match(request.url, /fast-model/);
    assert.deepEqual(Object.keys(body.learning_batch.cues[0]).sort(), ["cueId", "difficultWords", "phrases"]);
    assert.deepEqual(Object.keys(request.body.generationConfig.responseSchema.properties), ["cues"]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("analysis normalizes shifted words and removes basic words", () => {
  const result = normalizeAnalysisResult({
    translation: "这很恶心。",
    words: [
      { word: "disgusting is an adjective meaning causing strong dislike", expression: "disgusting", meaning: "令人作呕的", contextMeaning: "这里表示反感", phonetic: "/dɪsˈɡʌstɪŋ/", partOfSpeech: "形容词" },
      { word: "know", meaning: "知道" },
      { word: "I", meaning: "我" },
      { word: "thought", meaning: "认为" },
    ],
  });
  assert.deepEqual(result.words.map((word) => word.word), ["disgusting", "thought"]);
  assert.equal(result.words[0].contextMeaning, "这里表示反感");
  assert.equal(result.words[0].partOfSpeech, "形容词");
});

test("official Gemini translate_sentence uses the primary model and structured schema without thinking config", async () => {
  const previousFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"translation":"测试"}' }] } }] }), { status: 200 });
  };
  try {
    const res = responseRecorder();
    await handleAI({}, res, { credential_id: "gem", task: "translate_sentence", text_en: "This is a test.", video_id: "video-1" }, {
      NODE_ENV: "test", __AI_CREDENTIAL_LOOKUP_TEST_ONLY: async () => ({ type: "official", provider: "gemini", base_url: "https://generativelanguage.googleapis.com", api_key: "server-only-key", model: "gem-3.8-flash", fast_model: "gem-3.5-flash-lite" }),
    });
    assert.equal(res.statusCode, 200);
    assert.match(request.url, /gem-3\.8-flash/);
    assert.equal(request.body.generationConfig.thinkingConfig, undefined);
    assert.equal(request.body.generationConfig.responseMimeType, "application/json");
    assert.equal(request.body.generationConfig.responseSchema.type, "OBJECT");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Word Detail profile schema is minimal and starts with the configured primary model", async () => {
  const previousFetch = globalThis.fetch;
  let responseSchema;
  let requestUrl;
  globalThis.fetch = async (url, options) => {
    requestUrl = String(url);
    responseSchema = JSON.parse(options.body).generationConfig.responseSchema;
    const profile = {
      expression_type: "word", phonetic_us: "/weɪk/", phonetic_uk: "/weɪk/",
      senses: [{ pos: "v.", meanings: ["醒来", "唤醒"] }, { pos: "n.", meanings: ["守夜", "尾流"] }],
      roots: [], synthesis: "",
    };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(profile) }] } }] }), { status: 200 });
  };
  try {
    const res = responseRecorder();
    await handleAI({}, res, { credential_id: "gem-profile", task: "vocabulary_analysis", expression_en: "wake", expression_type: "word" }, {
      NODE_ENV: "test", __AI_CREDENTIAL_LOOKUP_TEST_ONLY: async () => ({ type: "official", provider: "gemini", base_url: "https://generativelanguage.googleapis.com", api_key: "server-only-key", model: "gemini-main", fast_model: "gemini-fast" }),
    });
    const result = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.match(requestUrl, /gemini-main/);
    assert.ok(responseSchema.required.includes("senses"));
    assert.deepEqual(responseSchema.properties.senses.items.required, ["pos", "meanings"]);
    assert.deepEqual(Object.keys(responseSchema.properties).sort(), ["expression_type", "phonetic_uk", "phonetic_us", "roots", "senses", "synthesis"]);
    assert.ok(!("synonyms" in responseSchema.properties));
    assert.ok(!("examples" in responseSchema.properties));
    assert.deepEqual(result.profile.senses.map((sense) => sense.pos), ["v.", "n."]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("phrase profile request asks only for expression type and POS senses", async () => {
  const previousFetch = globalThis.fetch;
  let schema;
  globalThis.fetch = async (_url, options) => {
    schema = JSON.parse(options.body).generationConfig.responseSchema;
    const profile = { expression_type: "phrase", senses: [{ pos: "phr.", meanings: ["停止自责；别再责怪自己"] }] };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(profile) }] } }] }), { status: 200 });
  };
  try {
    const res = responseRecorder();
    await handleAI({}, res, { credential_id: "phrase-profile", task: "vocabulary_analysis", expression_en: "stop beating oneself up", expression_type: "phrase" }, {
      NODE_ENV: "test", __AI_CREDENTIAL_LOOKUP_TEST_ONLY: async () => ({ type: "official", provider: "gemini", base_url: "https://generativelanguage.googleapis.com", api_key: "server-only-key", model: "main", fast_model: "fast" }),
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(Object.keys(schema.properties).sort(), ["expression_type", "senses"]);
    assert.deepEqual(JSON.parse(res.body).profile.senses[0].meanings, ["停止自责；别再责怪自己"]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Word Detail profile does not retry a failed upstream request", async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response("busy", { status: 503 }); };
  try {
    const res = responseRecorder();
    await assert.rejects(handleAI({}, res, { credential_id: "gem-profile-once", task: "vocabulary_analysis", expression_en: "debate", expression_type: "word" }, {
      NODE_ENV: "test", __AI_CREDENTIAL_LOOKUP_TEST_ONLY: async () => ({ type: "relay", provider: "openai-compatible", base_url: "https://api.example.com/v1", api_key: "server-only-key", model: "main", fast_model: "fast" }),
    }));
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("AI retries one transient upstream failure and deduplicates an in-flight close read", async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response("busy", { status: 503 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"translation":"测试"}' } }] }), { status: 200 });
  };
  try {
    const body = { credential_id: "cred", task: "translate_sentence", text_en: "This is a test.", video_id: "video-dedupe" };
    const [first, second] = await Promise.all([responseRecorder(), responseRecorder()].map(async (res) => {
      await handleAI({}, res, body, { NODE_ENV: "test", __AI_CREDENTIAL_LOOKUP_TEST_ONLY: async () => ({ type: "relay", provider: "openai-compatible", base_url: "https://api.example.com/v1", api_key: "key", model: "model" }) });
      return res;
    }));
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("AI handler rejects missing server configuration", async () => {
  const res = responseRecorder();
  await handleAI({}, res, { task: "word_lookup", expression_en: "test" }, {});
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).code, "AI_NOT_CONFIGURED");
  assert.doesNotMatch(res.body, /AI_API_KEY|AI_MODEL|please configure/i);
});

test("review modes use four answers with related distractors", () => {
  const card = { id: "though", expression_en: "though", meaning_zh: "虽然", profile: { pos: "连词" } };
  const pool = [card, { id: "unrelated", expression_en: "cat", meaning_zh: "猫", profile: { pos: "名词" } }];
  for (const mode of ["r1", "r2", "r3"]) {
    const local = buildLocalDistractors(card, pool, mode);
    const listeningFallback = ["想法", "通过", "彻底的"];
    const options = buildReviewOptions(card, pool, mode, mode === "r3" ? listeningFallback : local);
    assert.equal(options.length, 4);
    const correctValue = mode === "r1" || mode === "r3" ? card.meaning_zh : card.expression_en;
    assert.equal(options.filter((option) => option.value === correctValue).length, 1);
    assert.equal(new Set(options.map((option) => option.id)).size, 4);
    assert.ok(!options.some((option) => option.value === "猫" || option.value === "cat"));
  }
  assert.deepEqual(buildLocalDistractors(card, pool, "r3"), ["想法", "通过", "彻底的"]);
});

test("100 review questions shuffle all three modes and judge every answer position", () => {
  const card = { id: "though", expression_en: "though", meaning_zh: "虽然", profile: { pos: "连词" } };
  const pool = [card];
  const modes = ["r1", "r2", "r3"];
  const distributions = Object.fromEntries(modes.map((mode) => [mode, [0, 0, 0, 0]]));
  const overall = [0, 0, 0, 0];
  let seed = 0x12345678;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  for (let index = 0; index < 100; index += 1) {
    const mode = modes[index % modes.length];
    const r3Distractors = mode === "r3" ? ["想法", "通过", "彻底的"] : buildLocalDistractors(card, pool, mode);
    const question = buildReviewQuestion(card, pool, mode, r3Distractors, random);
    assert.equal(question.options.length, 4, `${mode} should always have four choices`);
    assert.equal(new Set(question.options.map((option) => option.id)).size, 4, `${mode} choices should be unique`);
    const correctIndex = question.options.findIndex((option) => isCorrectReviewAnswer(question, option));
    assert.notEqual(correctIndex, -1, `${mode} should include the saved correct answer`);
    overall[correctIndex] += 1;
    distributions[mode][correctIndex] += 1;
    assert.equal(question.options.filter((option) => isCorrectReviewAnswer(question, option)).length, 1);
    for (const option of question.options) {
      assert.equal(isCorrectReviewAnswer(question, option), option.id === question.correctAnswerId);
    }
  }

  assert.ok(overall.every((count) => count > 0), `all answer positions must appear: ${overall}`);
  for (const [mode, distribution] of Object.entries(distributions)) {
    assert.ok(distribution.every((count) => count > 0), `${mode} must use all positions: ${distribution}`);
  }
});

test("YouTube URL parsing and json3 event conversion preserve timing", () => {
  for (const url of [
    "https://youtu.be/dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?si=xxx",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=shared",
    "https://youtube.com/shorts/dQw4w9WgXcQ?t=12",
    "分享给你 https://youtu.be/dQw4w9WgXcQ?si=xxx 从 00:12 开始",
  ]) assert.equal(videoId(url), "dQw4w9WgXcQ", url);
  assert.equal(videoId("https://example.com/video"), null);
  assert.deepEqual(linesFromEvents([{ tStartMs: 1250, dDurationMs: 2000, segs: [{ utf8: "Hello " }, { utf8: "world" }] }]), [{
    text_en: "Hello world",
    time_start: "0:01.250",
    time_end: "0:03.250",
  }]);
});

test("YouTube handler uses a distinct watch HTML fallback and reports extractor details", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes("youtubei/v1/player")) return new Response("blocked", { status: 403 });
    if (String(url).includes("youtube.com/watch")) return new Response(`<html>"captionTracks":[{"languageCode":"en","kind":"asr","baseUrl":"https://caption.example/timedtext"}]</html>`, { status: 200 });
    if (String(url).startsWith("https://caption.example/timedtext")) return new Response(JSON.stringify({ events: [{ tStartMs: 1500, dDurationMs: 2000, segs: [{ utf8: "Fallback line" }] }] }), { status: 200 });
    return new Response("unexpected", { status: 500 });
  };
  try {
    const res = responseRecorder();
    await handleYouTubeTranscript({}, res, { url: "分享 https://youtu.be/dQw4w9WgXcQ?si=test" });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.lines[0].text_en, "Fallback line");
    assert.equal(body.videoId, "dQw4w9WgXcQ");
    assert.equal(body.language, "en");
    assert.equal(body.isAutoGenerated, true);
    assert.match(body.diagnostics.extractor, /^watch-html-/);
    assert.equal(body.diagnostics.subtitleCount, 1);
    assert.ok(requests.some((request) => request.options.method === "POST"));
    assert.ok(requests.some((request) => request.options.method === undefined));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("YouTube handler prefers the independent transcript service and returns its timed cues", async () => {
  const previousFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    return new Response(JSON.stringify({
      videoId: "LCAY3PGHZyw",
      subtitles: [{ start: 0.24, duration: 4.32, text: "Hello everyone" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const res = responseRecorder();
    await handleYouTubeTranscript({}, res, { url: "https://youtu.be/LCAY3PGHZyw" }, {
      TRANSCRIPT_SERVICE_URL: "https://transcript.example",
      TRANSCRIPT_SERVICE_TOKEN: "temporary-test-token",
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.videoId, "LCAY3PGHZyw");
    assert.deepEqual(body.subtitles, [{ start: 0.24, duration: 4.32, text: "Hello everyone" }]);
    assert.deepEqual(body.lines, [{ text_en: "Hello everyone", time_start: "0:00.240", time_end: "0:04.560" }]);
    assert.equal(body.diagnostics.extractor, "independent-transcript-service");
    assert.equal(request.url, "https://transcript.example/transcript");
    assert.equal(request.options.headers.Authorization, "Bearer temporary-test-token");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("standalone service retries YouTube challenges up to three rounds and stops on success", async () => {
  let calls = 0;
  const waits = [];
  const result = await extractWithRetries("LCAY3PGHZyw", {
    extractor: async () => {
      calls += 1;
      if (calls < 3) {
        const error = new Error("YouTube bot challenge");
        error.reason = "youtube_bot_challenge";
        error.statusCode = 502;
        throw error;
      }
      return { videoId: "LCAY3PGHZyw", subtitles: [{ start: 1, duration: 2, text: "cue" }] };
    },
    wait: async (milliseconds) => waits.push(milliseconds),
  });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1500, 1500]);
  assert.equal(result.attemptCount, 3);
  assert.equal(result.subtitles.length, 1);
  assert.equal(result.attempts.at(-1).status, "success");
});

test("configured production transcript service never falls back to Vercel YouTube requests", async () => {
  const previousFetch = globalThis.fetch;
  const previousVercel = process.env.VERCEL;
  process.env.VERCEL = "1";
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return new Response("Cloudflare origin error", { status: 502, headers: { "Content-Type": "text/html" } });
  };
  try {
    const res = responseRecorder();
    await handleYouTubeTranscript({}, res, { url: "https://youtu.be/LCAY3PGHZyw" }, {
      VERCEL: process.env.VERCEL,
      TRANSCRIPT_SERVICE_URL: "https://transcript.example",
      TRANSCRIPT_SERVICE_TOKEN: "test-token",
    });
    const body = JSON.parse(res.body);
    assert.equal(res.statusCode, 502);
    assert.equal(body.reason, "transcript_tunnel_http_error");
    assert.equal(body.diagnostics.transcriptService.status, 502);
    assert.equal(requestCount, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  }
});

test("standalone transcript HTTP service enforces its token and handles CORS preflight", async () => {
  const previousToken = process.env.TRANSCRIPT_SERVICE_TOKEN;
  process.env.TRANSCRIPT_SERVICE_TOKEN = "http-test-token";
  const server = createTranscriptHttpServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const preflight = await fetch(`${baseUrl}/transcript`, {
      method: "OPTIONS",
      headers: { Origin: "https://lingoclub.vercel.app" },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "https://lingoclub.vercel.app");

    const denied = await fetch(`${baseUrl}/transcript`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer wrong-token" },
      body: JSON.stringify({ url: "https://youtu.be/LCAY3PGHZyw" }),
    });
    assert.equal(denied.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousToken === undefined) delete process.env.TRANSCRIPT_SERVICE_TOKEN;
    else process.env.TRANSCRIPT_SERVICE_TOKEN = previousToken;
  }
});

test("YouTube bot challenge is reported as inaccessible existing transcript, not missing subtitles", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("youtubei/v1/player")) {
      return new Response(JSON.stringify({ playabilityStatus: { status: "LOGIN_REQUIRED", reason: "Sign in to confirm you’re not a bot" } }), { status: 200 });
    }
    return new Response("Sign in to confirm you’re not a bot", { status: 200 });
  };
  try {
    const res = responseRecorder();
    await handleYouTubeTranscript({}, res, { url: "https://youtu.be/oX7OduG1YmI" });
    assert.equal(res.statusCode, 502);
    const body = JSON.parse(res.body);
    assert.equal(body.reason, "youtube_bot_challenge");
    assert.match(body.error, /Vercel 服务器被 YouTube bot challenge 拦截/);
    assert.equal(body.diagnostics.subtitleCount, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
