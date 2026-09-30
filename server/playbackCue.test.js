import test from "node:test";
import assert from "node:assert/strict";
import { findCueAtTime } from "../src/lib/timecode.js";

test("close-reading shortcut cue is resolved from playback time, not manual row selection", () => {
  const cues = [
    { id: "a", time_start: "00:10.000", time_end: "00:12.000" },
    { id: "b", time_start: "00:20.000", time_end: "00:22.000" },
  ];
  const manuallySelectedCueId = "b";

  const actualPlaybackCue = findCueAtTime(cues, 11.25);
  assert.equal(manuallySelectedCueId, "b");
  assert.equal(actualPlaybackCue?.id, "a");
  assert.equal(findCueAtTime(cues, 20.5)?.id, "b");
  assert.equal(findCueAtTime(cues, 40), null);
});
