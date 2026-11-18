import test from "node:test";
import assert from "node:assert/strict";
import { THEATER_TOOLBAR_EDGE_PX, theaterToolbarVisible } from "../src/lib/theaterToolbar.js";

const mouse = (distanceFromRight, visible = false) => theaterToolbarVisible({
  visible,
  distanceFromRight,
  viewportWidth: 1440,
  barReach: 110,
  finePointer: true,
});

test("a mouse opens the toolbar only at the right edge", () => {
  assert.equal(mouse(1), true);
  assert.equal(mouse(THEATER_TOOLBAR_EDGE_PX), true);
  assert.equal(mouse(THEATER_TOOLBAR_EDGE_PX + 1), false);
  // 1440 * 0.18 = 259px used to open it; the reading panel sits in that band.
  assert.equal(mouse(60), false);
  assert.equal(mouse(250), false);
});

test("leaving the window through the right side counts as reaching the edge", () => {
  assert.equal(mouse(0), true);
  assert.equal(mouse(-40), true);
});

test("an open toolbar stays while the pointer is on it and closes once it moves away", () => {
  assert.equal(mouse(60, true), true);
  assert.equal(mouse(110, true), true);
  assert.equal(mouse(111, true), false);
});

test("touch keeps the wide tap strip because it cannot hover the edge", () => {
  const tap = (distanceFromRight) => theaterToolbarVisible({ visible: false, distanceFromRight, viewportWidth: 800, barReach: 110, finePointer: false });
  assert.equal(tap(100), true);
  assert.equal(tap(143), true);
  assert.equal(tap(144), false);
});
