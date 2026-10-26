import test from "node:test";
import assert from "node:assert/strict";
import { findCueAtTime, toSec } from "../src/lib/timecode.js";
import { getStudyCueLoopRange } from "../src/lib/studyCueNavigation.js";
import {
  activeCueForLocalStudy,
  formatSubtitleOffset,
  alignSubtitleOffsetMs,
  nudgeSubtitleOffsetMs,
  parseSubtitleOffsetInput,
  peekSubtitleOffsetMs,
  cueForOffsetPreview,
  previewStillOnParkedFrame,
  snapSampleTime,
  shiftLoopRange,
  subtitleOffsetPreviewSpan,
  shiftPlaybackSeconds,
  subtitleLookupTime,
  writeSubtitleOffsetMs,
} from "../src/lib/subtitleOffset.js";

const cues = [
  { id: "one", time_start: "0:10.000", time_end: "0:12.000", text_en: "I've got number one. We're traveling." },
  { id: "aw", time_start: "0:12.500", time_end: "0:13.200", text_en: "Aw." },
  { id: "fan", time_start: "0:14.000", time_end: "0:16.000", text_en: "I'm actually a really big fan." },
];

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

test("positive offset delays the cue that the playhead highlights", () => {
  assert.equal(activeCueForLocalStudy(cues, 10.2, 0)?.id, "one");
  assert.equal(activeCueForLocalStudy(cues, 14.1, 0)?.id, "fan");
  // Subtitles are 4s early. Delay them so video 14.2 shows the line timestamped 10.2.
  assert.equal(activeCueForLocalStudy(cues, 10.2, 4000), null);
  assert.equal(activeCueForLocalStudy(cues, 14.2, 4000)?.id, "one");
  assert.equal(activeCueForLocalStudy(cues, 18.1, 4000)?.id, "fan");
});

test("negative offset advances cues and click-seek lands on the shifted time", () => {
  assert.equal(activeCueForLocalStudy(cues, 13.6, -500)?.id, "fan");
  assert.equal(shiftPlaybackSeconds(14, 1200), 15.2);
  assert.equal(shiftPlaybackSeconds(14, -500), 13.5);
  assert.equal(shiftPlaybackSeconds(0.2, -1000), 0);
  assert.equal(shiftPlaybackSeconds(14, 0), 14);
});

test("keyboard lookup and close-reading loop use the same shift", () => {
  assert.equal(findCueAtTime(cues, subtitleLookupTime(18.1, 4000))?.id, "fan");
  assert.equal(findCueAtTime(cues, subtitleLookupTime(14.2, 4000))?.id, "one");
  const loop = shiftLoopRange(getStudyCueLoopRange(cues[2], cues), 1200);
  assert.equal(loop.start, 15.2);
  assert.ok(loop.end > loop.start);
  assert.equal(shiftLoopRange(getStudyCueLoopRange(cues[0], cues), 0).start, 10);
});

test("offset label, exact input, nudges, and reset", () => {
  assert.equal(formatSubtitleOffset(1200), "+1.2s");
  assert.equal(formatSubtitleOffset(-500), "-0.5s");
  assert.equal(formatSubtitleOffset(0), "0.0s");
  assert.equal(formatSubtitleOffset(1), "+0.001s");
  assert.equal(parseSubtitleOffsetInput("1.2"), 1200);
  assert.equal(parseSubtitleOffsetInput("-0.5"), -500);
  assert.equal(parseSubtitleOffsetInput("+1.2s"), 1200);
  assert.equal(parseSubtitleOffsetInput("800ms"), 800);
  assert.equal(parseSubtitleOffsetInput("800毫秒"), 800);
  assert.equal(parseSubtitleOffsetInput("1.25 秒"), 1250);
  assert.equal(parseSubtitleOffsetInput(""), null);
  assert.equal(parseSubtitleOffsetInput("soon"), null);
  assert.equal(nudgeSubtitleOffsetMs(0, 100), 100);
  assert.equal(nudgeSubtitleOffsetMs(1200, -500), 700);
  assert.equal(nudgeSubtitleOffsetMs(100, -100), 0);
});

test("offset is stored per video and survives a fresh read", () => {
  const storage = memoryStorage();
  writeSubtitleOffsetMs("movie-a", 1200, storage);
  writeSubtitleOffsetMs("movie-b", -500, storage);
  assert.equal(peekSubtitleOffsetMs("movie-a", { storage }), 1200);
  assert.equal(peekSubtitleOffsetMs("movie-b", { storage }), -500);
  writeSubtitleOffsetMs("movie-a", 0, storage);
  assert.equal(peekSubtitleOffsetMs("movie-a", { storage, movieOffsetMs: 1200 }), 0);
  assert.equal(peekSubtitleOffsetMs("movie-c", { storage, movieOffsetMs: -800 }), -800);
  assert.equal(peekSubtitleOffsetMs("movie-d", { storage, aliasKeys: ["movie-b"] }), -500);
});

test("snap alignment is video time minus the cue's original start", () => {
  assert.equal(alignSubtitleOffsetMs(12.5, 10), 2500);
  assert.equal(alignSubtitleOffsetMs(8, 10), -2000);
  assert.equal(alignSubtitleOffsetMs(10, 10), 0);
  assert.equal(alignSubtitleOffsetMs(Number.NaN, 10), null);
  assert.equal(alignSubtitleOffsetMs(12, Number.NaN), null);
  const offset = alignSubtitleOffsetMs(14.2, 10);
  assert.ok(Math.abs(subtitleLookupTime(14.2, offset) - 10) < 0.002);
  assert.equal(alignSubtitleOffsetMs(12, toSec("0:10.000")), 2000);
  assert.equal(snapSampleTime(11.2, 10), 10);
  assert.equal(snapSampleTime(14, 10), 14);
  assert.equal(snapSampleTime(8, null), 8);
  assert.equal(snapSampleTime(Number.NaN, 10), null);
});

test("offset preview starts at the shifted cue and stays a short listen", () => {
  const cue = { id: "fan", time_start: "0:04.000", time_end: "0:06.000", text_en: "I'm actually a really big fan." };
  const span = subtitleOffsetPreviewSpan(cue, 2000);
  assert.deepEqual({ start: span.start, end: span.end }, { start: 6, end: 8 });
  const longCue = { id: "long", time_start: "0:01.000", time_end: "0:08.000", text_en: "A longer line." };
  const capped = subtitleOffsetPreviewSpan(longCue, -500);
  assert.equal(capped.start, 0.5);
  assert.equal(capped.end, 2.5);
  assert.equal(cueForOffsetPreview([cue, longCue], 6, 2000, cue).id, "fan");
  assert.equal(previewStillOnParkedFrame(6.4, 10, span), true);
  assert.equal(previewStillOnParkedFrame(14, 10, span), false);
  assert.equal(previewStillOnParkedFrame(Number.NaN, 10, span), true);
  const before = cue.time_start;
  subtitleOffsetPreviewSpan(cue, 2000);
  assert.equal(cue.time_start, before);
});

test("stored cue timestamps are not rewritten by the offset", () => {
  const before = cues.map((cue) => cue.time_start);
  activeCueForLocalStudy(cues, 18, 4000);
  shiftPlaybackSeconds(14, 4000);
  assert.deepEqual(cues.map((cue) => cue.time_start), before);
});
