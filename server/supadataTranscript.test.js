import assert from "node:assert/strict";
import test from "node:test";
import { fetchSupadataTranscript, SupadataError, subtitlesFromSupadata } from "./transcript/supadataTranscript.js";
import { handleYouTubeTranscript } from "./youtubeTranscript.js";

const ENV = { SUPADATA_API_KEY: "test-key" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

function recorder() {
  return { statusCode: 0, setHeader() {}, end(body) { this.body = JSON.parse(body); } };
}

test("Supadata chunks become timed subtitles", () => {
  assert.deepEqual(subtitlesFromSupadata([{ text: " Hello  world ", offset: 1500, duration: 2000 }, { text: "", offset: 0, duration: 1 }]),
    [{ start: 1.5, duration: 2, text: "Hello world" }]);
});

test("Supadata request uses native mode, English preference, and the API key header", async () => {
  let seen;
  const result = await fetchSupadataTranscript("F3hc7lN2S6k", ENV, {
    fetchImpl: async (url, options) => { seen = { url: new URL(url), headers: options.headers }; return json({ content: [{ text: "Hi", offset: 0, duration: 1000 }], lang: "en", availableLangs: ["en"] }); },
  });
  assert.equal(seen.url.pathname, "/v1/transcript");
  assert.equal(seen.url.searchParams.get("mode"), "native");
  assert.equal(seen.url.searchParams.get("lang"), "en");
  assert.equal(seen.url.searchParams.get("url"), "https://www.youtube.com/watch?v=F3hc7lN2S6k");
  assert.equal(seen.headers["x-api-key"], "test-key");
  assert.equal(result.extractor, "supadata");
  assert.equal(result.subtitles[0].text, "Hi");
});

test("Supadata async jobs are polled", async () => {
  const calls = [];
  const result = await fetchSupadataTranscript("F3hc7lN2S6k", ENV, {
    wait: async () => {},
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (calls.length === 1) return json({ jobId: "job-1" }, 202);
      if (calls.length === 2) return json({ status: "active" });
      return json({ status: "completed", result: { content: [{ text: "Done", offset: 0, duration: 500 }], lang: "en" } });
    },
  });
  assert.match(calls[1], /\/transcript\/job-1$/);
  assert.equal(result.subtitles[0].text, "Done");
});

test("Supadata errors are classified", async () => {
  const run = (status, body) => fetchSupadataTranscript("F3hc7lN2S6k", ENV, { fetchImpl: async () => json(body, status) });
  await assert.rejects(run(206, { error: "transcript-unavailable" }), (error) => error.reason === "no_captions");
  await assert.rejects(run(404, { error: "not-found" }), (error) => error.reason === "video_unavailable");
  await assert.rejects(run(401, { error: "unauthorized" }), (error) => error instanceof SupadataError && error.config);
  await assert.rejects(run(429, { error: "limit-exceeded" }), (error) => error instanceof SupadataError && error.quota);
  await assert.rejects(fetchSupadataTranscript("F3hc7lN2S6k", {}), (error) => error instanceof SupadataError && error.config);
});

test("handler uses Supadata first when configured", async () => {
  const previousFetch = globalThis.fetch;
  const hosts = [];
  globalThis.fetch = async (url) => {
    hosts.push(new URL(String(url)).host);
    return json({ content: [{ text: "From Supadata", offset: 0, duration: 1000 }], lang: "en", availableLangs: ["en"] });
  };
  try {
    const res = recorder();
    await handleYouTubeTranscript({}, res, { url: "https://youtu.be/AAAAAAAAAA1?si=x" }, ENV);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.subtitles[0].text, "From Supadata");
    assert.equal(res.body.diagnostics.extractor, "supadata");
    assert.deepEqual(hosts, ["api.supadata.ai"]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("handler falls back to the direct extractor when Supadata quota is exhausted", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.includes("api.supadata.ai")) return json({ error: "limit-exceeded" }, 429);
    if (href.includes("/youtubei/v1/player")) {
      const client = JSON.parse(options.body).context.client.clientName;
      if (client === "ANDROID") return json({ playabilityStatus: { status: "OK" }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: "en", baseUrl: "https://captions.test/a?x=1" }] } } });
      return json({ playabilityStatus: { status: "LOGIN_REQUIRED", reason: "Sign in to confirm you’re not a bot" } });
    }
    if (href.startsWith("https://captions.test/")) return json({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "Direct" }] }] });
    return new Response("<html></html>", { status: 200 });
  };
  try {
    const res = recorder();
    await handleYouTubeTranscript({}, res, { url: "https://youtu.be/AAAAAAAAAA2" }, ENV);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.subtitles[0].text, "Direct");
    assert.equal(res.body.diagnostics.transcriptService.supadata.reason, "supadata_quota");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Supadata 'no transcript' is reported without trying blocked paths", async () => {
  const previousFetch = globalThis.fetch;
  const hosts = [];
  globalThis.fetch = async (url) => { hosts.push(new URL(String(url)).host); return json({ error: "transcript-unavailable", message: "x", details: "x" }, 206); };
  try {
    const res = recorder();
    await handleYouTubeTranscript({}, res, { url: "https://youtu.be/AAAAAAAAAA3" }, ENV);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.reason, "no_captions");
    assert.deepEqual(hosts, ["api.supadata.ai"]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
