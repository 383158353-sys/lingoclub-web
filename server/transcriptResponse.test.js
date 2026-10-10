import assert from "node:assert/strict";
import test from "node:test";
import { transcriptServiceToFrontend } from "./transcriptResponse.js";
import { createTranscriptHttpServer } from "./transcript/httpService.js";
import { handleYouTubeTranscript } from "./youtubeTranscript.js";

async function callHandler(runtime) {
  const res = { statusCode: 200, end(body) { this.body = JSON.parse(body); } };
  await handleYouTubeTranscript({}, res, { url: "https://youtu.be/LCAY3PGHZyw" }, runtime);
  return res;
}

const enabledService = {
  TRANSCRIPT_SERVICE_ENABLED: "true", TRANSCRIPT_SERVICE_URL: "https://service.example",
  TRANSCRIPT_SERVICE_TOKEN: "private-test-service-key",
};

test("enabled API uses the service once, preserves timing and keeps credentials server-side", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return Response.json({ videoId: "LCAY3PGHZyw", language: "en", subtitles: [{ start: 1.125, duration: 2.25, text: "A service cue" }] });
  };
  try {
    const res = await callHandler(enabledService);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.lines, [{ text_en: "A service cue", time_start: "0:01.125", time_end: "0:03.375" }]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://service.example/transcript");
    assert.equal(calls[0].options.headers.Authorization, `Bearer ${enabledService.TRANSCRIPT_SERVICE_TOKEN}`);
    assert.deepEqual(JSON.parse(calls[0].options.body), { videoId: "LCAY3PGHZyw" });
    assert.ok(!JSON.stringify(res.body).includes(enabledService.TRANSCRIPT_SERVICE_TOKEN));
  } finally { globalThis.fetch = originalFetch; }
});

test("service failures distinguish auth, YouTube rejection, no captions, bad responses and timeout without legacy retries", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const [upstream, status, code, payload] of [
      [401, 502, "TRANSCRIPT_SERVICE_AUTH", { error: "secret upstream text" }],
      [502, 502, "YOUTUBE_BLOCKED", { diagnostics: { loginRequired: true } }],
      [404, 404, "TRANSCRIPT_NO_CAPTIONS", { stage: "subtitle_discovery" }],
      [429, 429, "TRANSCRIPT_RATE_LIMIT", {}],
      [200, 502, "TRANSCRIPT_SERVICE_RESPONSE", { subtitles: [] }],
    ]) {
      let calls = 0;
      globalThis.fetch = async () => { calls += 1; return Response.json(payload, { status: upstream }); };
      const res = await callHandler(enabledService);
      assert.equal(res.statusCode, status);
      assert.equal(res.body.code, code);
      assert.equal(calls, 1);
      assert.ok(!JSON.stringify(res.body).includes("secret upstream text"));
    }
    globalThis.fetch = async () => { throw new DOMException("timeout", "TimeoutError"); };
    assert.equal((await callHandler(enabledService)).body.code, "TRANSCRIPT_SERVICE_TIMEOUT");
    globalThis.fetch = () => { throw new Error("must not fetch without configuration"); };
    assert.equal((await callHandler({ ...enabledService, TRANSCRIPT_SERVICE_TOKEN: "" })).body.code, "TRANSCRIPT_SERVICE_CONFIG");
  } finally { globalThis.fetch = originalFetch; }
});

test("a configured URL alone does not activate the service or change the original path", async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).includes("youtubei/")) return Response.json({ playabilityStatus: { status: "LOGIN_REQUIRED" } });
    return new Response("Sign in to confirm you're not a bot");
  };
  try {
    const res = await callHandler({ ...enabledService, TRANSCRIPT_SERVICE_ENABLED: "false" });
    assert.equal(res.body.code, "YOUTUBE_BLOCKED");
    assert.ok(urls.length > 1);
    assert.ok(urls.every((url) => !url.includes("service.example")));
  } finally { globalThis.fetch = originalFetch; }
});

test("service adapter preserves text and millisecond timing in the single frontend contract", () => {
  assert.deepEqual(transcriptServiceToFrontend({ videoId: "LCAY3PGHZyw", subtitles: [
    { start: 1.125, duration: 2.25, text: "An English subtitle." },
  ] }), { lines: [{ text_en: "An English subtitle.", time_start: "0:01.125", time_end: "0:03.375" }] });
  assert.equal(transcriptServiceToFrontend({ subtitles: [
    { start: 0, duration: 1, text: "Opening line" },
  ] }).lines[0].time_start, "0:00.000");
  for (const payload of [{}, { subtitles: [] }, { subtitles: [{ start: 2, duration: -1, text: "bad" }] }]) {
    assert.throws(() => transcriptServiceToFrontend(payload));
  }
});

test("health responds without credentials or any YouTube fetch", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => { calls += 1; throw new Error("Unexpected upstream request"); };
  const server = createTranscriptHttpServer();
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const response = await originalFetch(`http://127.0.0.1:${server.address().port}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
});
