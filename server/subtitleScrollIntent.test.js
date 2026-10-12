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
