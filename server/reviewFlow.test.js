import test from "node:test";
import assert from "node:assert/strict";
import { advanceReviewQuestion, commitReviewAnswer, createAnswerCommitGate, createReviewQuestionToken, scheduleReviewAutoAdvance } from "../src/lib/reviewFlow.js";

for (const phase of ["r1", "r2", "r3"]) {
  test(`${phase} correct answer automatically advances to the next card`, () => {
    let scheduled;
    let nextPosition;
    scheduleReviewAutoAdvance(phase, () => {
      nextPosition = advanceReviewQuestion({ phase, idx: 0, queueLength: 2 });
    }, (callback, delay) => { scheduled = { callback, delay }; return 1; });
    assert.equal(nextPosition, undefined);
    assert.equal(scheduled.delay, phase === "r3" ? 1600 : 700);
    scheduled.callback();
    assert.deepEqual(nextPosition, { phase, idx: 1, done: false });
  });
}

test("last card in a phase advances to the next phase", () => {
  assert.deepEqual(advanceReviewQuestion({ phase: "r1", idx: 2, queueLength: 3 }), { phase: "r2", idx: 0, done: false });
  assert.deepEqual(advanceReviewQuestion({ phase: "r2", idx: 2, queueLength: 3 }), { phase: "r3", idx: 0, done: false });
  assert.deepEqual(advanceReviewQuestion({ phase: "r3", idx: 2, queueLength: 3 }), { phase: "done", idx: 0, done: true });
});

test("rapid duplicate commits count the same answer only once", () => {
  const gate = createAnswerCommitGate();
  let commits = 0;
  gate.activate("session:r1:0:word-a");
  assert.equal(gate.tryCommit("session:r1:0:word-a"), true);
  commits += 1;
  assert.equal(gate.tryCommit("session:r1:0:word-a"), false);
  assert.equal(gate.tryCommit("session:r1:0:word-a"), false);
  assert.equal(commits, 1);

  gate.activate("session:r1:1:word-b");
  assert.equal(gate.tryCommit("session:r1:1:word-b"), true);
});

test("a thrown answer callback can release its gate and retry without counting twice", () => {
  const gate = createAnswerCommitGate();
  let commits = 0;
  const token = "session:r3:0:word-a";
  gate.activate(token);
  assert.equal(gate.tryCommit(token), true);
  gate.release(token);
  assert.equal(gate.tryCommit(token), true);
  commits += 1;
  assert.equal(gate.tryCommit(token), false);
  assert.equal(commits, 1);
});

test("a thrown parent callback does not permanently lock the pending answer", () => {
  const pending = { token: "answer-1", committed: false, committing: false };
  const failed = commitReviewAnswer(pending, () => { throw new Error("persistence failed synchronously"); });
  assert.equal(failed.committed, false);
  assert.equal(pending.committed, false);
  assert.equal(pending.committing, false);
  const retried = commitReviewAnswer(pending, () => {});
  assert.equal(retried.committed, true);
  assert.equal(commitReviewAnswer(pending, () => {}).duplicate, true);
});

test("revisiting the same card creates a new token so stale timers cannot commit", () => {
  let token = createReviewQuestionToken("session:r1:0:word-a", null);
  const firstVisit = token.token;
  token = createReviewQuestionToken("session:r1:1:word-b", token);
  token = createReviewQuestionToken("session:r1:0:word-a", token);
  assert.notEqual(token.token, firstVisit);
});
