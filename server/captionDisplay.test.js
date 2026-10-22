import test from "node:test";
import assert from "node:assert/strict";
import { captionWindowsFromEvents, displayLinesFromTimedCues } from "../src/lib/captionDisplayCues.js";
import { mergeFragments } from "../src/lib/subtitleCleaner.js";
import { selectSentenceCue } from "../src/lib/sourceSentenceFocus.js";
import { findCueAtTime, toSec } from "../src/lib/timecode.js";
import { getStudyCueLoopRange } from "../src/lib/studyCueNavigation.js";
import { resolveVocabularySourceCue, youtubePlaybackUrl } from "../src/lib/vocabularySourceCue.js";
import { linesFromEvents } from "./transcript/youtubeTranscriptService.js";

// Supadata rolling lines from https://www.youtube.com/watch?v=83hYhbknuJc
const supadata83h = [
  { text_en: "In previous episodes, we covered", time_start: "0:14.080", time_end: "0:20.960" },
  { text_en: "composition, animation, and sound.", time_start: "0:16.400", time_end: "0:23.359" },
  { text_en: "In this episode, we will dive into the", time_start: "0:20.960", time_end: "0:26.400" },
  { text_en: "world of production design.", time_start: "0:23.359", time_end: "0:27.680" },
  { text_en: "You walk onto these sets and it", time_start: "0:26.400", time_end: "0:29.119" },
  { text_en: "instantly just brings a smile to your", time_start: "0:27.680", time_end: "0:30.850" },
  { text_en: "face.", time_start: "0:29.119", time_end: "0:33.680" },
  { text_en: "[Music]", time_start: "0:30.850", time_end: "0:39.719" },
  { text_en: "This is episode 19 of the shot list", time_start: "0:33.680", time_end: "0:39.719" },
  { text_en: "production design.", time_start: "0:40.640", time_end: "0:44.200" },
  { text_en: "Production design refers to the physical", time_start: "0:56.800", time_end: "1:01.039" },
  { text_en: "appearance of a film world. It", time_start: "0:58.800", time_end: "1:03.760" },
  { text_en: "establishes location and time period and", time_start: "1:01.039", time_end: "1:08.400" },
  { text_en: "deeply influences tone, mood, story, and", time_start: "1:03.760", time_end: "1:10.000" },
  { text_en: "character.", time_start: "1:08.400", time_end: "1:12.080" },
  { text_en: "The field is massively important to how", time_start: "1:10.000", time_end: "1:14.479" },
  { text_en: "a film looks. And yet, it is often", time_start: "1:12.080", time_end: "1:17.040" },
  { text_en: "underdised and appreciated.", time_start: "1:14.479", time_end: "1:19.040" },
];

const playerFlashes = [
  { text_en: "that everything we see is part of the mise en scene yes everything", time_start: "0:12.000", time_end: "0:15.400" },
  { text_en: "so now let's put them to practice", time_start: "0:15.400", time_end: "0:17.800" },
  { text_en: "there are two basic traditions in mise en scene", time_start: "0:17.800", time_end: "0:20.200" },
];

test("study list keeps each on-screen caption and its start time", () => {
  const shown = displayLinesFromTimedCues(playerFlashes);
  assert.deepEqual(shown.map((line) => line.text_en), playerFlashes.map((line) => line.text_en));
  assert.deepEqual(shown.map((line) => line.time_start), playerFlashes.map((line) => line.time_start));
  assert.deepEqual(shown.map((line) => line.time_end), playerFlashes.map((line) => line.time_end));
  assert.notDeepEqual(mergeFragments(playerFlashes).map((line) => line.text_en), shown.map((line) => line.text_en));
});

test("playback highlight and close-reading loop follow the caption that is on screen", () => {
  const shown = displayLinesFromTimedCues(playerFlashes);
  assert.equal(findCueAtTime(shown, 12.2)?.text_en, playerFlashes[0].text_en);
  assert.equal(findCueAtTime(shown, 15.45)?.text_en, playerFlashes[1].text_en);
  assert.equal(findCueAtTime(shown, 18.1)?.text_en, playerFlashes[2].text_en);
  const loop = getStudyCueLoopRange(shown[1], shown);
  assert.equal(loop.start, toSec(shown[1].time_start));
  assert.ok(loop.end <= toSec(shown[2].time_start));
  assert.ok(loop.end > loop.start);
});

test("json3 events stay one row per caption window, including an appended line", () => {
  const lines = linesFromEvents([
    { tStartMs: 1000, dDurationMs: 2400, segs: [{ utf8: "So now,\n" }, { utf8: "let's put them to practice." }] },
    { tStartMs: 1800, dDurationMs: 1600, wWinId: 1, aAppend: 1, segs: [{ utf8: " Yes, everything." }] },
    { tStartMs: 3600, dDurationMs: 2200, segs: [{ utf8: "There are two basic traditions." }] },
  ]);
  assert.deepEqual(lines.map((line) => line.text_en), [
    "So now, let's put them to practice. Yes, everything.",
    "There are two basic traditions.",
  ]);
  assert.equal(lines[0].time_start, "0:01.000");
  assert.equal(lines[0].time_end, "0:03.400");
  assert.equal(lines[1].time_start, "0:03.600");
  assert.equal(findCueAtTime(lines, 3.7)?.text_en, lines[1].text_en);
});

test("supadata rolling lines join into the on-screen sentence and stop at the period", () => {
  const shown = displayLinesFromTimedCues(supadata83h);
  assert.deepEqual(displayLinesFromTimedCues(shown), shown);
  assert.equal(
    shown.find((line) => line.text_en.startsWith("You walk onto"))?.text_en,
    "You walk onto these sets and it instantly just brings a smile to your face.",
  );
  assert.equal(shown.filter((line) => /walk onto|brings a smile|^face\.$/.test(line.text_en)).length, 1);
  const production = shown.find((line) => line.text_en.startsWith("Production design refers"));
  assert.equal(production.text_en, "Production design refers to the physical appearance of a film world.");
  const itContinues = shown[shown.indexOf(production) + 1];
  assert.match(itContinues.text_en, /^It establishes/);
  assert.match(itContinues.text_en, /character\.$/);
  const touched = shown.filter((line) => line.text_en === "This is episode 19 of the shot list" || line.text_en === "production design.");
  assert.deepEqual(touched.map((line) => line.text_en), ["This is episode 19 of the shot list", "production design."]);
  assert.equal(shown.some((line) => line.text_en === "[Music]"), false);
  assert.equal(shown.some((line) => /In previous episodes, we covered composition/.test(line.text_en)), true);
  assert.equal(findCueAtTime(shown, 59)?.text_en, production.text_en);
  const productionLoop = getStudyCueLoopRange(production, shown);
  assert.equal(productionLoop.start, toSec(production.time_start));
  assert.ok(productionLoop.end <= toSec(itContinues.time_start));
  assert.ok(productionLoop.end > productionLoop.start);
});

test("a YouTube word-card timestamp loops the merged cue that contains the word", () => {
  const shown = displayLinesFromTimedCues(supadata83h);
  const cue = selectSentenceCue({
    source_timestamp_seconds: 70,
    source_timestamp_text: "1:10.000",
    source_sentence_en: "The field is massively important to how",
  }, shown, "massively");
  assert.equal(cue.text_en, "The field is massively important to how a film looks.");
  assert.equal(findCueAtTime(shown, 70)?.text_en, cue.text_en);
  assert.notEqual(resolveVocabularySourceCue({ source_timestamp_seconds: 70 }, shown).textEn, "character.");
  const loop = getStudyCueLoopRange(cue, shown);
  const next = shown[shown.indexOf(cue) + 1];
  assert.equal(loop.start, toSec("1:10.000"));
  assert.ok(loop.end <= toSec(next.time_start));
  assert.match(next.text_en, /^And yet/);
  assert.equal(youtubePlaybackUrl("", "83hYhbknuJc"), "https://www.youtube.com/watch?v=83hYhbknuJc");
});

test("a caption clear does not become a row and does not keep appending", () => {
  const windows = captionWindowsFromEvents([
    { tStartMs: 0, dDurationMs: 4000, segs: [{ utf8: "when we see directors on set" }] },
    { tStartMs: 1500, dDurationMs: 500, segs: [{ utf8: "\n" }] },
    { tStartMs: 1600, dDurationMs: 2000, aAppend: 1, segs: [{ utf8: "what are they often doing" }] },
  ]);
  assert.deepEqual(windows.map((cue) => cue.text), [
    "when we see directors on set",
    "what are they often doing",
  ]);
  assert.equal(windows[0].endMs, 1500);
});
