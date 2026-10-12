import test from "node:test";
import assert from "node:assert/strict";
import { createScrollIntentTracker } from "../src/lib/subtitleScrollIntent.js";

const clock = () => { let t = 1000; const f = () => t; f.adv = (ms) => { t += ms; }; return f; };

test("programmatic scroll without touch is not manual", () => {
  const c = clock(); const s = createScrollIntentTracker(c);
  assert.equal(s.scroll(), false);
  c.adv(50); assert.equal(s.scroll(), false);
});

test("finger drag + iOS momentum count as manual, then expire", () => {
  const c = clock(); const s = createScrollIntentTracker(c);
  s.touchStart(0, 300); s.touchMove(0, 200);
  assert.equal(s.scroll(), true);
  s.touchEnd(); c.adv(800);
  assert.equal(s.scroll(), true, "momentum still manual");
  c.adv(2000);
  assert.equal(s.scroll(), false, "later auto-follow scroll is programmatic");
});

test("drag never produces a seek click", () => {
  const c = clock(); const s = createScrollIntentTracker(c);
  s.touchStart(0, 300); s.touchMove(0, 250); s.touchEnd();
  assert.equal(s.consumeClick(), false);
});

test("tap that stops momentum does not seek", () => {
  const c = clock(); const s = createScrollIntentTracker(c);
  s.touchStart(0, 300); s.touchMove(0, 100); s.touchEnd();
  c.adv(400); s.scroll(); c.adv(30);
  s.touchStart(5, 5); s.touchEnd();
  assert.equal(s.consumeClick(), false);
});

test("clean tap on a still list seeks", () => {
  const c = clock(); const s = createScrollIntentTracker(c);
  s.touchStart(10, 10); s.touchMove(12, 13); s.touchEnd();
  assert.equal(s.consumeClick(), true);
});

test("↑ (programmatic) clears momentum window so its scroll is not manual", () => {
  const c = clock(); const s = createScrollIntentTracker(c);
  s.touchStart(0, 300); s.touchMove(0, 100); s.touchEnd(); c.adv(100);
  s.programmatic();
  assert.equal(s.scroll(), false);
});

test("mouse click (no touch) still seeks", () => {
  const s = createScrollIntentTracker(clock());
  assert.equal(s.consumeClick(), true);
});

import { computeRowScrollTop, cueIndexAtTime, forceScrollTo } from "../src/lib/subtitleScrollIntent.js";

test("computeRowScrollTop puts row at top and clamps", () => {
  assert.equal(computeRowScrollTop({ scrollTop: 500, rowTop: 300, containerTop: 100, padTop: 12, scrollHeight: 5000, clientHeight: 600 }), 688);
  assert.equal(computeRowScrollTop({ scrollTop: 0, rowTop: 50, containerTop: 100, padTop: 12 }), 0);
  assert.equal(computeRowScrollTop({ scrollTop: 4000, rowTop: 2000, containerTop: 0, scrollHeight: 5000, clientHeight: 600 }), 4400);
});

test("cueIndexAtTime finds last started cue", () => {
  const s = [0, 2, 5, 9];
  assert.equal(cueIndexAtTime(s, 6), 2);
  assert.equal(cueIndexAtTime(s, 9), 3);
  assert.equal(cueIndexAtTime(s, -1), -1);
  assert.equal(cueIndexAtTime(s, NaN), -1);
});

test("forceScrollTo retries once when momentum overrides the first jump", () => {
  const queue = [];
  const raf = (cb) => queue.push(cb);
  let hijack = true;
  const c = { style: { overflowY: "auto" }, _t: 0,
    get scrollTop() { return this._t; },
    set scrollTop(v) { this._t = hijack ? 9999 : v; } };
  let result;
  forceScrollTo(c, () => 300, { raf, onDone: (r) => { result = r; } });
  // first attempt hijacked by "momentum"
  for (let i = 0; i < 10 && queue.length; i++) { if (i === 3) hijack = false; queue.shift()(); }
  while (queue.length) queue.shift()();
  assert.equal(result, true);
  assert.equal(c.scrollTop, 300);
  assert.equal(c.style.overflowY, "auto");
});

test("ignoreScrollFor swallows late programmatic scroll events but not touches", async () => {
  const { createScrollIntentTracker } = await import("../src/lib/subtitleScrollIntent.js");
  let t = 1000;
  const intent = createScrollIntentTracker(() => t);
  intent.ignoreScrollFor(500);
  t = 1300; assert.equal(intent.scroll(), false);
  intent.touchStart(0, 0); assert.equal(intent.scroll(), true);
  intent.touchEnd(); t = 1400; assert.equal(intent.scroll(), true); // real momentum still counts as user
});

test("resolvePlaybackTime falls back when iframe reports 0 / NaN", async () => {
  const { resolvePlaybackTime } = await import("../src/lib/subtitleScrollIntent.js");
  assert.equal(resolvePlaybackTime(0, 42), 42);
  assert.equal(resolvePlaybackTime(undefined, 42), 42);
  assert.equal(resolvePlaybackTime(12.5, 42), 12.5);
  assert.equal(resolvePlaybackTime(0, null), 0);
});

test("forceScrollTo keeps re-aligning while the target moves during settle", async () => {
  const { forceScrollTo } = await import("../src/lib/subtitleScrollIntent.js");
  const queue = [];
  const raf = (cb) => queue.push(cb);
  const container = { style: {}, scrollTop: 0 };
  let target = 100;
  let done = null;
  forceScrollTo(container, () => target, { raf, settleFrames: 10, onDone: (ok) => { done = ok; } });
  let frames = 0;
  while (queue.length && frames < 200) { if (frames === 5) target = 180; queue.shift()(); frames += 1; }
  assert.equal(container.scrollTop, 180);
  assert.equal(done, true);
});
