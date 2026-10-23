import test from "node:test";
import assert from "node:assert/strict";
import { buryCardInSession, isResumable } from "../src/lib/reviewSession.js";
import { localDateKey } from "../src/lib/srs.js";

const now = new Date(2026, 0, 5, 12, 0, 0);
const today = localDateKey(now);

function session(overrides = {}) {
  return {
    date: today,
    phase: "r1",
    idx: 1,
    queue: ["a", "b", "c"],
    originalQueue: ["a", "b", "c"],
    completed: false,
    dailyQueue: { date: today, ids: ["a", "b", "c"], sourceIds: { new: ["a"], due: ["b"], weak: ["c"] }, completedIds: [] },
    ...overrides,
  };
}

test("same-day resume rules stay intact", () => {
  const current = session();
  assert.equal(isResumable(current, ["a", "b", "c"], now), true);
  assert.equal(isResumable(current, ["a", "b", "c"], new Date(2026, 0, 6, 12, 0, 0)), false);
  assert.equal(isResumable(session({ phase: "done" }), ["a", "b", "c"], now), false);
  assert.equal(isResumable(session({ completed: true }), ["a", "b", "c"], now), false);
  assert.equal(isResumable(session({ queue: ["a", "missing"], idx: 0 }), ["a"], now), false);
});

test("斩 removes the current card from the saved queue without restarting at the first card", () => {
  const buried = buryCardInSession(session(), "b");
  assert.deepEqual(buried.queue, ["a", "c"]);
  assert.deepEqual(buried.originalQueue, ["a", "c"]);
  assert.equal(buried.idx, 1);
  assert.equal(buried.phase, "r1");
  assert.ok(buried.completedIds.includes("b"));
  assert.deepEqual(buried.dailyQueue.ids, ["a", "c"]);
  assert.equal(isResumable(buried, ["a", "b", "c"], now), true);

  const finishedPhase = buryCardInSession(session({ idx: 2 }), "c");
  assert.equal(finishedPhase.phase, "r2");
  assert.equal(finishedPhase.idx, 0);
  assert.deepEqual(finishedPhase.queue, ["a", "b"]);
  assert.equal(isResumable(finishedPhase, ["a", "b", "c"], now), true);
});
