import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { detailBuryControl, listRowBuryControl } from "../src/lib/detailActions.js";
import { buildDailyQueue, isDue, masterVocabulary } from "../src/lib/srs.js";
import {
  armCuePreviewPlayback,
  createYouTubeCueAutoplayVars,
  createYouTubeCueEmbedUrl,
  createYouTubePlayerVars,
  cuePreviewPlaybackConfig,
  shouldRestartCueLoop,
} from "../src/lib/youtubePlayerConfig.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("vocabulary detail and review footers delete words instead of burying them", () => {
  assert.equal(listRowBuryControl(), null);
  const bury = () => {};
  const restore = () => {};
  const remove = () => {};
  assert.deepEqual(detailBuryControl({ mastery_level: "learning" }, { onDelete: remove }), { label: "删除", action: "delete" });
  assert.deepEqual(detailBuryControl({ mastery_level: "mastered" }, { onDelete: remove }), { label: "删除", action: "delete" });
  assert.deepEqual(detailBuryControl({ mastery_level: "learning" }, { onBury: bury, onRestore: restore }), { label: "斩", action: "bury" });

  const collection = read("src/pages/Collection.jsx");
  const card = collection.slice(collection.indexOf("function VocabCard"), collection.indexOf("function ReviewHeader"));
  assert.equal(card.includes("斩"), false);
  assert.equal(card.includes("onBury"), false);
  assert.equal(card.includes("onRestore"), false);
  assert.equal(collection.includes("斩"), false);
  const dialogAt = collection.indexOf("<WordDetailDialog");
  const dialogTag = collection.slice(dialogAt, collection.indexOf("/>", dialogAt));
  assert.match(dialogTag, /onDelete=\{deleteWord\}/);
  const flashAt = collection.indexOf("<Flashcard");
  const flashTag = collection.slice(flashAt, collection.indexOf("/>", flashAt));
  assert.match(flashTag, /onDelete=\{deleteWord\}/);

  const detail = read("src/components/vocab/WordDetailDialog.jsx");
  assert.equal(detail.includes("播放原句"), false);
  assert.match(detail, /预览原句/);
  assert.match(detail, /关闭预览/);
  assert.match(detail, /armCuePreviewPlayback\(\)/);
  assert.equal((detail.match(/<DetailActionFooter/g) || []).length, 2);
  assert.match(detail, /primaryLabel=\{footerLabel\}/);
  assert.match(detail, /primaryLabel="继续复习"/);
  assert.match(detail, /<DeleteWordButton/);

  const flashcard = read("src/components/study/Flashcard.jsx");
  const optionsAt = flashcard.indexOf("options.map");
  const deleteAt = flashcard.indexOf("<DeleteWordButton");
  assert.ok(optionsAt > 0 && deleteAt > optionsAt);
  assert.match(flashcard, /<WordDetailOverlay[\s\S]*onDelete=\{onDelete\}/);
});

test("sentence preview has no 播放原句 and autoplay/loop config stays on the cue", () => {
  const preview = read("src/components/vocab/SourcePreview.jsx");
  const player = read("src/components/study/players/YouTubePlayer.jsx");
  const videoPlayer = read("src/components/study/VideoPlayer.jsx");
  for (const source of [preview, player, videoPlayer]) assert.equal(source.includes("播放原句"), false);
  assert.match(preview, /shouldRestartCueLoop\(time, loop\)/);
  assert.match(preview, /cueAutoplay/);
  assert.match(preview, /正在循环当前原句/);
  assert.match(preview, /关闭原句预览/);
  assert.match(player, /createYouTubeCueEmbedUrl/);
  assert.doesNotMatch(player, /播放原句/);
  assert.match(videoPlayer, /<YouTubePlayer[^>]*cueAutoplay=\{cueAutoplay\}/);
  assert.doesNotMatch(videoPlayer, /<BilibiliPlayer[^>]*cueAutoplay/);
  assert.doesNotMatch(videoPlayer, /<NativeVideoPlayer[^>]*cueAutoplay/);

  const origin = "https://lingoclub.vercel.app";
  const config = cuePreviewPlaybackConfig(origin, 12.8, 15.4);
  assert.equal(config.autoplay, true);
  assert.equal(config.loop, true);
  assert.equal(config.showPlayButton, false);
  assert.equal(config.youtubeLoopParam, false);
  assert.equal(config.controls, false);
  assert.equal(config.playerVars.autoplay, 1);
  assert.equal(config.playerVars.mute, 1);
  assert.equal(config.playerVars.playsinline, 1);
  assert.equal(config.playerVars.controls, 0);
  assert.equal(config.playerVars.loop, undefined);
  assert.equal(config.playerVars.playlist, undefined);
  assert.equal(shouldRestartCueLoop(15.4, { start: 12.2, end: 15.4 }), true);
  assert.equal(shouldRestartCueLoop(13, { start: 12.2, end: 15.4 }), false);
  assert.equal(shouldRestartCueLoop(20, null), false);

  const embed = new URL(createYouTubeCueEmbedUrl("7zUI6Ko9qsU", origin, 12.8));
  assert.equal(embed.searchParams.get("autoplay"), "1");
  assert.equal(embed.searchParams.get("mute"), "1");
  assert.equal(embed.searchParams.get("controls"), "0");
  assert.equal(embed.searchParams.get("start"), "12");
  assert.equal(embed.searchParams.get("playsinline"), "1");
  assert.equal(embed.searchParams.get("loop"), null);
  assert.equal(embed.searchParams.get("playlist"), null);
  const study = createYouTubePlayerVars(origin, { controls: 1 });
  assert.equal(study.autoplay, 0);
  assert.equal(study.controls, 1);
  assert.deepEqual(createYouTubeCueAutoplayVars(origin, 12.8).controls, 0);
  assert.equal(armCuePreviewPlayback(), false);
});

test("斩 still leaves the card out of the daily queue and the due list", () => {
  const card = { id: "diverse", expression_en: "diverse", meaning_zh: "多样的", mastery_level: "learning" };
  const mastered = { ...card, ...masterVocabulary(card) };
  assert.equal(mastered.mastery_level, "mastered");
  assert.equal(isDue(mastered), false);
  const queue = buildDailyQueue([mastered], Date.parse("2026-10-23T00:00:00Z"), 40);
  assert.equal(queue.ids.includes("diverse"), false);
});
