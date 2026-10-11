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

test("101/150 message distinguishes bot check from disabled embedding", async () => {
  const { describeYouTubeEmbedError } = await import("../src/lib/youtubePlayerConfig.js");
  assert.match(describeYouTubeEmbedError(150, true), /允许嵌入.*换个 VPN 节点/);
  assert.equal(describeYouTubeEmbedError(101, false), "该视频不允许嵌入播放。");
  assert.match(describeYouTubeEmbedError(150, null), /VPN 节点被 YouTube 要求验证.*也可能是该视频不允许嵌入/);
  assert.match(describeYouTubeEmbedError(153), /153/);
  assert.match(describeYouTubeEmbedError(null), /VPN/);
});
