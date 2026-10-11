import assert from "node:assert/strict";
import test from "node:test";
import { extractYouTubeTranscriptDetailed } from "./transcript/youtubeTranscriptService.js";

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
    assert.equal(downloads.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
