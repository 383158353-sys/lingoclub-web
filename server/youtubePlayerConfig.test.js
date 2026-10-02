import test from "node:test";
import assert from "node:assert/strict";
import { createYouTubeEmbedUrl, createYouTubePlayerVars } from "../src/lib/youtubePlayerConfig.js";

test("YouTube API and iframe fallback use matching origin and playback parameters", () => {
  const origin = "https://lingoclub.vercel.app";
  const playerVars = createYouTubePlayerVars(origin);
  const embed = new URL(createYouTubeEmbedUrl("7zUI6Ko9qsU", origin));
  assert.equal(embed.origin, "https://www.youtube.com");
  assert.equal(embed.searchParams.get("origin"), origin);
  for (const [key, value] of Object.entries(playerVars)) assert.equal(embed.searchParams.get(key), String(value));
  assert.equal(playerVars.enablejsapi, 1);
});
