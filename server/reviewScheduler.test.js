import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDailyQueue,
  dailyQueueSnapshot,
  restoreDailyQueue,
  scheduleStage,
} from "../src/lib/srs.js";

const date = (day) => new Date(2026, 0, day, 12, 0, 0);
const makeCard = (id, fields = {}) => ({
  id,
  expression_en: `word ${id}`,
  meaning_zh: `词 ${id}`,
  created_date: "2025-01-01T00:00:00.000Z",
  ...fields,
});

test("200 new items keep entering daily queues and due items cannot starve the new quota", () => {
  const cards = Array.from({ length: 200 }, (_, i) => makeCard(`new-${i}`));
  const seenNew = new Set();
  for (let day = 1; day <= 5; day += 1) {
    const queue = buildDailyQueue(cards, date(day));
    assert.equal(queue.backlogMode, queue.backlogCount > 100);
    assert.ok(queue.newCount >= (queue.backlogMode ? 24 : 20));
    assert.ok(queue.newCount > 0);
    for (const card of queue.queue.filter((item) => queue.sourceIds.new.includes(item.id))) {
      seenNew.add(card.id);
      const scheduled = scheduleStage(card, true, date(day));
      Object.assign(card, scheduled);
    }
  }
  assert.ok(seenNew.size >= 120);

  const crowded = [
    ...Array.from({ length: 200 }, (_, i) => makeCard(`fresh-${i}`)),
    ...Array.from({ length: 100 }, (_, i) => makeCard(`due-${i}`, {
      reviewCount: 1, correctCount: 1, intervalDays: 1,
      lastReviewedAt: "2026-01-01T12:00:00.000Z", nextReviewAt: "2026-01-02T12:00:00.000Z",
    })),
  ];
  const queue = buildDailyQueue(crowded, date(3));
  assert.equal(queue.newCount, 24);
  assert.equal(queue.dueCount, 16);
});

test("normal and backlog quotas are honored and pool shortages backfill to 40", () => {
  const normal = [
    ...Array.from({ length: 30 }, (_, i) => makeCard(`n-${i}`)),
    ...Array.from({ length: 20 }, (_, i) => makeCard(`d-${i}`, { reviewCount: 1, correctCount: 1, nextReviewAt: "2026-01-01" })),
    ...Array.from({ length: 10 }, (_, i) => makeCard(`w-${i}`, { reviewCount: 2, correctCount: 1, wrongCount: 1, lastReviewedAt: "2026-01-02" })),
  ];
  const normalQueue = buildDailyQueue(normal, date(3));
  assert.deepEqual(normalQueue.counts, { new: 20, due: 15, weak: 5 });
  assert.equal(normalQueue.queue.length, 40);

  const backlog = [...Array.from({ length: 150 }, (_, i) => makeCard(`b-${i}`)), ...normal.slice(30)];
  const backlogQueue = buildDailyQueue(backlog, date(3));
  assert.deepEqual(backlogQueue.counts, { new: 24, due: 12, weak: 4 });
  assert.equal(backlogQueue.queue.length, 40);

  const shortage = buildDailyQueue([makeCard("only-new-1"), makeCard("only-new-2")], date(3));
  assert.equal(shortage.queue.length, 2);
  assert.equal(shortage.newCount, 2);
});

test("daily snapshot is stable on refresh and expires on the next local date", () => {
  const cards = Array.from({ length: 50 }, (_, i) => makeCard(`stable-${i}`));
  const first = buildDailyQueue(cards, date(5));
  const snapshot = dailyQueueSnapshot({ ...first, completedIds: [first.ids[0]] }, date(5));
  const restoredSameDay = restoreDailyQueue(JSON.parse(JSON.stringify(snapshot)), cards, date(5));
  assert.deepEqual(restoredSameDay.ids, first.ids);
  assert.deepEqual(restoredSameDay.completedIds, [first.ids[0]]);
  assert.equal(restoreDailyQueue(snapshot, cards, date(6)), null);
});

test("correct answers advance through 1/3/7/14/30/60 day intervals", () => {
  let card = makeCard("ladder");
  const expected = [1, 3, 7, 14, 30, 60];
  let day = 1;
  for (const interval of expected) {
    card = { ...card, ...scheduleStage(card, true, date(day)) };
    assert.equal(card.intervalDays, interval);
    assert.equal(card.nextReviewAt, new Date(date(day).getTime() + interval * 86400000).toISOString());
    day += interval;
  }
  assert.equal(card.reviewCount, expected.length);
  assert.equal(card.correctCount, expected.length);
  assert.equal(card.status, "mastered");
});

test("wrong answers downgrade intervals without resetting history and same-day grading is idempotent", () => {
  const cases = [[60, 14], [30, 7], [14, 3], [7, 1], [3, 1], [1, 1]];
  for (const [previous, expected] of cases) {
    const card = makeCard(`wrong-${previous}`, { reviewCount: 4, correctCount: 3, wrongCount: 1, intervalDays: previous });
    const first = scheduleStage(card, false, date(10));
    assert.equal(first.intervalDays, expected);
    assert.equal(first.reviewCount, 5);
    assert.equal(first.wrongCount, 2);
    const duplicate = scheduleStage({ ...card, ...first }, false, new Date(date(10).getTime() + 5 * 3600000));
    assert.equal(duplicate.reviewCount, first.reviewCount);
    assert.equal(duplicate.nextReviewAt, first.nextReviewAt);
  }
});

test("daily queue and review progress survive user_state JSON serialization and restoration", () => {
  const cards = [makeCard("cloud-new"), makeCard("cloud-due", { reviewCount: 1, correctCount: 1, intervalDays: 1, nextReviewAt: "2026-01-01T00:00:00.000Z" })];
  const built = buildDailyQueue(cards, date(5));
  const session = {
    date: built.date,
    dailyQueue: dailyQueueSnapshot({ ...built, completedIds: ["cloud-new"] }, date(5)),
    queue: ["cloud-due"], idx: 0, phase: "r2", reviewed: 3, completedIds: ["cloud-new"],
  };
  const userState = { vocab: cards, reviewSession: session };
  const decoded = JSON.parse(JSON.stringify(userState));
  const restored = restoreDailyQueue(decoded.reviewSession.dailyQueue, decoded.vocab, date(5));
  assert.deepEqual(restored.ids, built.ids);
  assert.deepEqual(restored.completedIds, ["cloud-new"]);
  assert.equal(decoded.reviewSession.phase, "r2");
  assert.equal(decoded.reviewSession.reviewed, 3);
  assert.equal(decoded.vocab[1].reviewCount, 1);
});
