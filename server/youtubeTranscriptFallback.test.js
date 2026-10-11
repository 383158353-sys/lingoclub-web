import assert from "node:assert/strict";
import test from "node:test";
import { classifyTranscriptFailure, extractYouTubeTranscriptDetailed, pickCaptionTrack, subtitlesFromXml, videoId } from "./transcript/youtubeTranscriptService.js";

function jsonResponse(body, status = 200) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

test("caption download falls back to another client's tracks in the same attempt", async () => {
  const originalFetch = globalThis.fetch;
  const downloads = [];
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.includes("/youtubei/v1/player")) {
      const clientName = JSON.parse(options.body).context.client.clientName;
      if (clientName === "ANDROID_VR") return jsonResponse({ captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: "en", baseUrl: "https://captions.test/vr?x=1" }] } } });
      if (clientName === "ANDROID") {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return jsonResponse({ captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: "en", baseUrl: "https://captions.test/android?x=1" }] } } });
      }
      return jsonResponse({ playabilityStatus: { status: "UNPLAYABLE" } });
    }
    if (href.includes("/watch?")) return jsonResponse("<html></html>");
    if (href.startsWith("https://captions.test/")) {
      downloads.push(href);
      // The first client's signed URL returns an empty body (e.g. missing PO token).
      if (href.includes("/vr")) return jsonResponse("");
      return jsonResponse({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "Hello there" }] }] });
    }
    throw new Error(`unexpected fetch ${href}`);
  };
  try {
    const result = await extractYouTubeTranscriptDetailed("dQw4w9WgXcQ", { attempts: 1 });
    assert.equal(result.extractor, "innertube-android");
    assert.equal(result.subtitles[0].text, "Hello there");
    // vr: json3 then XML fallback (both empty), then android json3 succeeds.
    assert.equal(downloads.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("video id parsing covers pasted share links", () => {
  for (const input of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s",
    "https://youtu.be/dQw4w9WgXcQ?si=AbCdEf123",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share",
    "https://youtube.com/shorts/dQw4w9WgXcQ?feature=share",
    "https://m.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ?si=x",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RD",
    "youtube.com/watch?v=dQw4w9WgXcQ",
    "看这个 https://youtu.be/dQw4w9WgXcQ，很好",
    "dQw4w9WgXcQ",
  ]) assert.equal(videoId(input), "dQw4w9WgXcQ", input);
  for (const input of ["https://example.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/short", ""]) assert.equal(videoId(input), null, input);
});

test("caption track selection prefers English, then translation, then original language", () => {
  const manualEn = { languageCode: "en", baseUrl: "u1" };
  const asrEn = { languageCode: "en", kind: "asr", baseUrl: "u2" };
  assert.equal(pickCaptionTrack([asrEn, manualEn]).track, manualEn);
  assert.deepEqual(pickCaptionTrack([asrEn]), { track: asrEn, translateTo: null });
  const koAsr = { languageCode: "ko", kind: "asr", isTranslatable: true, baseUrl: "u3" };
  const picked = pickCaptionTrack([koAsr]);
  assert.equal(picked.track, koAsr);
  assert.equal(picked.translateTo, "en");
  const de = { languageCode: "de", baseUrl: "u4" };
  assert.deepEqual(pickCaptionTrack([de]), { track: de, translateTo: null });
  assert.equal(pickCaptionTrack([]), null);
});

test("timedtext XML formats are parsed", () => {
  const classic = '<?xml version="1.0"?><transcript><text start="1.5" dur="2">Hello &amp;#39;world&amp;#39;</text><text start="4" dur="1">Bye</text></transcript>';
  assert.deepEqual(subtitlesFromXml(classic).map((item) => [item.start, item.text]), [[1.5, "Hello 'world'"], [4, "Bye"]]);
  const srv3 = '<timedtext format="3"><body><p t="1000" d="1500"><s>Hi</s><s> there</s></p></body></timedtext>';
  assert.deepEqual(subtitlesFromXml(srv3).map((item) => [item.start, item.duration, item.text]), [[1, 1.5, "Hi there"]]);
});

test("failures are classified so the UI can explain them", () => {
  assert.equal(classifyTranscriptFailure([{ step: "caption-tracks", found: 0, playable: true }]).reason, "no_captions");
  assert.equal(classifyTranscriptFailure([{ step: "playability", status: "ERROR", errorBody: "This video is unavailable" }, { step: "caption-tracks", found: 0, playable: false }]).reason, "video_unavailable");
  const bot = classifyTranscriptFailure([{ step: "playability", status: "LOGIN_REQUIRED", errorBody: "Sign in to confirm you’re not a bot" }, { step: "caption-tracks", found: 0, playable: false }]);
  assert.equal(bot.reason, "youtube_bot_challenge");
  assert.equal(bot.statusCode, 503);
  assert.equal(classifyTranscriptFailure([{ step: "caption-tracks", found: 3, playable: true }]).reason, "transcript_unavailable");
});

test("a playable video without captions is not retried", async () => {
  const originalFetch = globalThis.fetch;
  let playerCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/youtubei/v1/player")) { playerCalls += 1; return jsonResponse({ playabilityStatus: { status: "OK" } }); }
    return jsonResponse("<html></html>");
  };
  try {
    await assert.rejects(extractYouTubeTranscriptDetailed("dQw4w9WgXcQ", { attempts: 3, wait: async () => {} }), (error) => error.reason === "no_captions" && error.statusCode === 404);
    assert.equal(playerCalls, 5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
