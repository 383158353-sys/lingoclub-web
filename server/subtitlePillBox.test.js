import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SUBTITLE_FONT_DEFAULT,
  SUBTITLE_FONT_MAX,
  SUBTITLE_FONT_MIN,
  SUBTITLE_FONT_NUDGE,
  SUBTITLE_HEIGHT_MIN,
  SUBTITLE_LINE_HEIGHT_MIN,
  SUBTITLE_PILL_BACKGROUND,
  SUBTITLE_PILL_BLUR,
  SUBTITLE_WIDTH_MIN,
  fitSubtitleBlock,
  nextSubtitleBoxSize,
  nudgeSubtitleFont,
  readManualSubtitleFont,
  subtitleCueTop,
  readSubtitleBoxAxis,
  subtitleTextPadX,
} from "../src/lib/subtitlePillBox.js";

/** Two lines until the font passes 41, then three. Fixed 1.375 leading leaves a band; the fit should close it. */
function cliffMeasure(fontPx, lineHeight) {
  const lines = fontPx <= 41 ? 2 : 3;
  return lines * fontPx * lineHeight + 8;
}

test("stored box axes come back as pixels, and an empty value means unset", () => {
  assert.equal(readSubtitleBoxAxis(null), 0);
  assert.equal(readSubtitleBoxAxis(""), 0);
  assert.equal(readSubtitleBoxAxis("0"), 0);
  assert.equal(readSubtitleBoxAxis("not-a-number"), 0);
  assert.equal(readSubtitleBoxAxis("480"), 480);
  assert.equal(readSubtitleBoxAxis("90"), 90);
});

test("corner drag changes width and height together", () => {
  assert.deepEqual(nextSubtitleBoxSize(320, 60, 80, 90), { width: 400, height: 150 });
  assert.deepEqual(nextSubtitleBoxSize(320, 60, -40, 10), { width: 280, height: 70 });
  assert.deepEqual(nextSubtitleBoxSize(140, 40, -80, -40), {
    width: SUBTITLE_WIDTH_MIN,
    height: SUBTITLE_HEIGHT_MIN,
  });
});

test("a taller box fits a larger font and the block reaches the bottom", () => {
  const short = fitSubtitleBlock(cliffMeasure, 72);
  const tall = fitSubtitleBlock(cliffMeasure, 180);
  assert.ok(tall.font > short.font);
  assert.ok(tall.font > 41);
  assert.ok(tall.height <= 180 + 1);
  assert.ok(180 - tall.height <= 4);
  assert.ok(short.height <= 72 + 1);
  assert.ok(72 - short.height <= 4);
  const capped = fitSubtitleBlock(() => 1, 5000);
  assert.equal(capped.font, SUBTITLE_FONT_MAX);
  const tooBig = fitSubtitleBlock(() => 500, 40);
  assert.equal(tooBig.font, SUBTITLE_FONT_MIN);
});

test("a wrap cliff no longer leaves a tall empty band under the lines", () => {
  const box = 180;
  let fixedFont = SUBTITLE_FONT_MIN;
  for (let font = SUBTITLE_FONT_MIN; font <= box; font += 1) {
    if (cliffMeasure(font, 1.375) <= box) fixedFont = font;
  }
  const fixedGap = box - cliffMeasure(fixedFont, 1.375);
  const fit = fitSubtitleBlock(cliffMeasure, box);
  assert.ok(fixedGap > 20);
  assert.ok(fit.font > fixedFont);
  assert.ok(fit.height <= box + 1);
  assert.ok(box - fit.height <= 4);
  assert.ok(fit.lineHeight >= SUBTITLE_LINE_HEIGHT_MIN);
});

test("padding stays wide enough to clear the study button until the box is narrow", () => {
  assert.equal(subtitleTextPadX(0), 48);
  assert.equal(subtitleTextPadX(640), 48);
  assert.ok(subtitleTextPadX(120) < 48);
  assert.ok(subtitleTextPadX(120) >= 8);
});

test("frost is a slight step up from the original bar, without a black gradient", () => {
  assert.equal(SUBTITLE_PILL_BACKGROUND, "rgba(8,6,4,0.62)");
  assert.match(SUBTITLE_PILL_BLUR, /^blur\(14px\)/);
  assert.equal(SUBTITLE_PILL_BACKGROUND.includes("gradient"), false);
  assert.equal(SUBTITLE_FONT_DEFAULT, 22);
});

test("a shorter nudged cue sits above center inside the same box", () => {
  const box = 180;
  const text = 100;
  const top = subtitleCueTop(box, text);
  const textCenter = top + text / 2;
  assert.ok(top > 12);
  assert.ok(textCenter < box / 2);
  assert.ok(box - (top + text) > top);
  assert.equal(subtitleCueTop(box, box), 0);
});

test("manual font nudges stay in range and empty storage means auto-fit", () => {
  assert.equal(readManualSubtitleFont(null), null);
  assert.equal(readManualSubtitleFont(""), null);
  assert.equal(readManualSubtitleFont("0"), null);
  assert.equal(readManualSubtitleFont("36"), 36);
  assert.equal(nudgeSubtitleFont(40, SUBTITLE_FONT_NUDGE), 42);
  assert.equal(nudgeSubtitleFont(SUBTITLE_FONT_MIN, -SUBTITLE_FONT_NUDGE), SUBTITLE_FONT_MIN);
  assert.equal(nudgeSubtitleFont(SUBTITLE_FONT_MAX, SUBTITLE_FONT_NUDGE), SUBTITLE_FONT_MAX);
});

test("the pill keeps box resize and font fit, and does not bring back the black tail", () => {
  const source = readFileSync(new URL("../src/components/study/MinimalSubtitleBar.jsx", import.meta.url), "utf8");
  assert.equal(source.includes("fitSubtitleBlock"), true);
  assert.equal(source.includes("nextSubtitleBoxSize"), true);
  assert.equal(source.includes("data-font-nudge"), true);
  assert.equal(source.includes("setManualFont(null)"), true);
  assert.equal(source.includes("setBoxH(nextH)"), false);
  assert.equal(source.includes("SUBTITLE_NUDGE_SPACE_ABOVE"), true);
  assert.equal(source.includes("PILL_FROST_TAIL"), false);
  assert.equal(source.includes("fontAfterVerticalDrag"), false);
  assert.equal(source.includes("A+"), false);
  assert.equal(source.includes("SUBTITLE_PILL_BACKGROUND"), true);
});
