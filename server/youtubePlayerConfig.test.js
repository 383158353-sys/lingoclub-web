import test from "node:test";
import assert from "node:assert/strict";
import { createYouTubeCueAutoplayVars, createYouTubeEmbedUrl, createYouTubePlayerVars } from "../src/lib/youtubePlayerConfig.js";

test("YouTube API and iframe fallback use matching origin and playback parameters", () => {
  const origin = "https://lingoclub.vercel.app";
  const playerVars = createYouTubePlayerVars(origin);
  const embed = new URL(createYouTubeEmbedUrl("7zUI6Ko9qsU", origin));
  assert.equal(embed.origin, "https://www.youtube.com");
  assert.equal(embed.searchParams.get("origin"), origin);
  for (const [key, value] of Object.entries(playerVars)) assert.equal(embed.searchParams.get(key), String(value));
  assert.equal(playerVars.enablejsapi, 1);
});

test("cue recall requests muted inline autoplay at the saved start while study playback stays paused", () => {
  const origin = "https://lingoclub.vercel.app";
  const cue = createYouTubeCueAutoplayVars(origin, 12.8);
  assert.equal(cue.autoplay, 1);
  assert.equal(cue.mute, 1);
  assert.equal(cue.playsinline, 1);
  assert.equal(cue.start, 12);
  assert.equal(cue.controls, 0);
  assert.equal(cue.loop, undefined);
  assert.equal(cue.playlist, undefined);
  assert.equal(cue.enablejsapi, 1);
  const plain = createYouTubePlayerVars(origin);
  assert.equal(plain.controls, undefined);
  assert.equal(plain.autoplay, 0);
  assert.equal(plain.mute, undefined);
  assert.equal(plain.start, undefined);
  const embed = new URL(createYouTubeEmbedUrl("7zUI6Ko9qsU", origin, { autoplay: true, start: 12.2, mute: true }));
  assert.equal(embed.searchParams.get("autoplay"), "1");
  assert.equal(embed.searchParams.get("start"), "12");
  assert.equal(embed.searchParams.get("mute"), "1");
  assert.equal(embed.searchParams.get("playsinline"), "1");
  assert.equal(createYouTubePlayerVars(origin, { autoplay: true, start: 0.4, mute: true }).start, undefined);
});

test("101/150 message distinguishes bot check from disabled embedding", async () => {
  const { describeYouTubeEmbedError } = await import("../src/lib/youtubePlayerConfig.js");
  assert.match(describeYouTubeEmbedError(150, true), /允许嵌入.*换个 VPN 节点/);
  assert.equal(describeYouTubeEmbedError(101, false), "该视频不允许嵌入播放。");
  assert.match(describeYouTubeEmbedError(150, null), /VPN 节点被 YouTube 要求验证.*也可能是该视频不允许嵌入/);
  assert.match(describeYouTubeEmbedError(153), /153/);
  assert.match(describeYouTubeEmbedError(null), /VPN/);
});
