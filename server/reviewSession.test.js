import test from "node:test";
import assert from "node:assert/strict";
import { appendDailyReviewBatch, buryCardInSession, canResumeSession, deleteCardFromSession, isResumable } from "../src/lib/reviewSession.js";
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

test("unfinished review sessions remain resumable across dates", () => {
  const current = session();
  assert.equal(isResumable(current, ["a", "b", "c"]), true);
  assert.equal(isResumable(session({ date: "2026-01-04" }), ["a", "b", "c"]), true);
  assert.equal(isResumable(session({ phase: "done" }), ["a", "b", "c"]), false);
  assert.equal(isResumable(session({ completed: true }), ["a", "b", "c"]), false);
  assert.equal(isResumable(session({ queue: ["a", "missing"], idx: 0 }), ["a"]), false);
});

test("daily review resumes only the active daily session", () => {
  const allContent = session({ reviewMode: "all" });
  assert.equal(canResumeSession(allContent, ["a", "b", "c"], "daily"), false);
  assert.equal(canResumeSession(allContent, ["a", "b", "c"], "all"), true);
  assert.equal(canResumeSession(allContent, ["a", "b", "c"], "resume"), true);
  assert.equal(canResumeSession(session(), ["a", "b", "c"], "daily"), true);

  const expandedQueue = Array.from({ length: 45 }, (_, index) => `word-${index}`);
  assert.equal(canResumeSession(session({
    reviewMode: "daily",
    queue: expandedQueue,
    originalQueue: expandedQueue,
    dailyQueue: { date: today, goal: 40 },
  }), expandedQueue, "daily"), true);
});

test("increased daily goals append only the newly added cards after the existing plan", () => {
  const snapshot = {
    goal: 3,
    ids: ["a", "b", "c"],
    sourceIds: { new: ["a", "b"], due: ["c"], weak: [] },
    completedIds: ["a"],
  };
  const expandedQueue = {
    goal: 5,
    ids: ["a", "b", "c", "d", "e", "f"],
    sourceIds: { new: ["a", "b", "d", "e"], due: ["c", "f"], weak: [] },
    backlogCount: 20,
  };

  const next = appendDailyReviewBatch(snapshot, expandedQueue);
  assert.deepEqual(next.ids, ["d", "e"]);
  assert.deepEqual(next.snapshot.ids, ["a", "b", "c", "d", "e"]);
  assert.deepEqual(next.snapshot.sourceIds, { new: ["a", "b", "d", "e"], due: ["c"], weak: [] });
  assert.equal(next.snapshot.goal, 5);
  assert.deepEqual(next.snapshot.completedIds, ["a"]);
  assert.equal(next.snapshot.backlogAtGeneration, 20);
  assert.equal(appendDailyReviewBatch(next.snapshot, expandedQueue), null);
});

test("斩 removes the current card from the saved queue without restarting at the first card", () => {
  const buried = buryCardInSession(session(), "b");
  assert.deepEqual(buried.queue, ["a", "c"]);
  assert.deepEqual(buried.originalQueue, ["a", "c"]);
  assert.equal(buried.idx, 1);
  assert.equal(buried.phase, "r1");
  assert.ok(buried.completedIds.includes("b"));
  assert.deepEqual(buried.dailyQueue.ids, ["a", "c"]);
  assert.equal(isResumable(buried, ["a", "b", "c"]), true);

  const finishedPhase = buryCardInSession(session({ idx: 2 }), "c");
  assert.equal(finishedPhase.phase, "r2");
  assert.equal(finishedPhase.idx, 0);
  assert.deepEqual(finishedPhase.queue, ["a", "b"]);
  assert.equal(isResumable(finishedPhase, ["a", "b", "c"]), true);
});

test("deleting a word removes it from the review checkpoint and daily snapshot", () => {
  const deleted = deleteCardFromSession(session({
    r1Res: { a: true, b: false }, r2Res: { b: true }, r3Res: { b: false }, retried: { b: true },
  }), "b");
  assert.deepEqual(deleted.queue, ["a", "c"]);
  assert.deepEqual(deleted.originalQueue, ["a", "c"]);
  assert.equal(deleted.idx, 1);
  assert.deepEqual(deleted.dailyQueue.ids, ["a", "c"]);
  assert.deepEqual(deleted.dailyQueue.sourceIds, { new: ["a"], due: [], weak: ["c"] });
  assert.deepEqual(deleted.r1Res, { a: true });
  assert.deepEqual(deleted.r2Res, {});
  assert.deepEqual(deleted.r3Res, {});
  assert.deepEqual(deleted.retried, {});
  assert.equal(isResumable(deleted, ["a", "c"]), true);
});

test("deleting the last active word advances the phase or completes the session", () => {
  const nextPhase = deleteCardFromSession(session({ queue: ["a"], originalQueue: ["a", "b"], idx: 0 }), "a");
  assert.equal(nextPhase.phase, "r2");
  assert.deepEqual(nextPhase.queue, ["b"]);

  const completed = deleteCardFromSession(session({ queue: ["a"], originalQueue: ["a"], idx: 0, phase: "r3" }), "a");
  assert.equal(completed.phase, "done");
  assert.equal(completed.completed, true);
});
