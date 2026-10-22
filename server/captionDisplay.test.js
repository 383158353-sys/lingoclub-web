import test from "node:test";
import assert from "node:assert/strict";
import { captionWindowsFromEvents, displayLinesFromTimedCues } from "../src/lib/captionDisplayCues.js";
import { mergeFragments } from "../src/lib/subtitleCleaner.js";
import { findCueAtTime, toSec } from "../src/lib/timecode.js";
import { getStudyCueLoopRange } from "../src/lib/studyCueNavigation.js";
import { linesFromEvents } from "./transcript/youtubeTranscriptService.js";

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
