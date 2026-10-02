import test from "node:test";
import assert from "node:assert/strict";
import { getAdjacentTranscriptCue, getStudyCueLoopRange } from "../src/lib/studyCueNavigation.js";

const cues = [
  { id: "a", time_start: "00:00:01.000", time_end: "00:00:03.000", text_en: "First cue" },
  { id: "b", time_start: "00:00:03.000", time_end: "00:00:05.000", text_en: "Second cue" },
  { id: "c", time_start: "00:00:05.000", time_end: "00:00:07.000", text_en: "Third cue" },
];

test("study loop respects the next cue even when timestamps touch", () => {
  const range = getStudyCueLoopRange(cues[0], cues);
  assert.equal(range.start, 1);
  assert.equal(range.end, 2.95);
  assert.ok(range.end < 3);
});

test("late precision entry still creates a loop confined to its current cue", () => {
  const range = getStudyCueLoopRange(cues[1], cues);
  // The current playhead position does not affect the range; entering at the
  // final 100-200ms still seeks back to this cue's start and ends before cue C.
  assert.deepEqual(range, { start: 3, end: 4.95 });
  assert.ok(range.end < 5);
});

test("loop end uses the earlier of the explicit cue end and next cue boundary", () => {
  const explicitEndBeforeNext = { ...cues[0], time_end: "00:00:02.500" };
  assert.equal(getStudyCueLoopRange(explicitEndBeforeNext, cues).end, 2.5);

  const explicitEndAfterNext = { ...cues[0], time_end: "00:00:04.000" };
  assert.equal(getStudyCueLoopRange(explicitEndAfterNext, cues).end, 2.95);
});

test("missing end uses next start, or estimates only for the final cue", () => {
  const noEnd = { id: "no-end", time_start: "00:00:10.000", text_en: "one two" };
  assert.equal(getStudyCueLoopRange(noEnd, [...cues, { id: "next", time_start: "00:00:12.000" }]).end, 11.95);
  assert.equal(getStudyCueLoopRange(noEnd, [noEnd]).end, 13);
});

test("arrow navigation steps strictly from playback time and stops at list boundaries", () => {
  assert.equal(getAdjacentTranscriptCue(cues, 4.9, 1).id, "c");
  assert.equal(getAdjacentTranscriptCue(cues, 5.1, -1).id, "b");
  assert.equal(getAdjacentTranscriptCue(cues, 1, -1), null);
  assert.equal(getAdjacentTranscriptCue(cues, 7, 1), null);
  assert.equal(getAdjacentTranscriptCue(cues, 0, 1).id, "a");
});

test("arrow navigation handles unsorted cue input by timestamp", () => {
  const unsorted = [cues[2], cues[0], cues[1]];
  assert.equal(getAdjacentTranscriptCue(unsorted, 3, 1).id, "c");
  assert.equal(getAdjacentTranscriptCue(unsorted, 5, -1).id, "b");
});
