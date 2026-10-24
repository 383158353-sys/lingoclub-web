import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SUBTITLE_FONT_DEFAULT,
  SUBTITLE_FONT_MAX,
  SUBTITLE_FONT_MIN,
  SUBTITLE_HEIGHT_MIN,
  SUBTITLE_PILL_BACKGROUND,
  SUBTITLE_PILL_BLUR,
  SUBTITLE_WIDTH_MIN,
  fitFontSizeToBox,
  nextSubtitleBoxSize,
  readSubtitleBoxAxis,
  subtitleTextPadX,
} from "../src/lib/subtitlePillBox.js";

const lineBox = (fontPx) => fontPx * 1.375 + 12;

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

test("a taller box fits a larger font, past the old small cap, and the block still fits", () => {
  const short = fitFontSizeToBox(lineBox, 72);
  const tall = fitFontSizeToBox(lineBox, 180);
  assert.ok(tall > short);
  assert.ok(tall > 56);
  assert.ok(lineBox(tall) <= 180 + 1);
  assert.ok(lineBox(tall + 1) > 180 + 1);
  assert.ok(lineBox(short) <= 72 + 1);
  assert.equal(fitFontSizeToBox(() => 1, 5000), SUBTITLE_FONT_MAX);
  assert.equal(fitFontSizeToBox(() => 500, 40), SUBTITLE_FONT_MIN);
});

test("wrapped copy stays inside the box instead of overflowing it", () => {
  const wrapped = (fontPx) => (fontPx <= 30 ? 1 : 2) * fontPx * 1.375 + 12;
  const fitted = fitFontSizeToBox(wrapped, 80);
  assert.equal(fitted, 30);
  assert.ok(wrapped(fitted) <= 80 + 1);
  assert.ok(wrapped(fitted + 1) > 80 + 1);
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

test("the pill keeps box resize and font fit, and does not bring back the black tail", () => {
  const source = readFileSync(new URL("../src/components/study/MinimalSubtitleBar.jsx", import.meta.url), "utf8");
  assert.equal(source.includes("fitFontSizeToBox"), true);
  assert.equal(source.includes("nextSubtitleBoxSize"), true);
  assert.equal(source.includes("PILL_FROST_TAIL"), false);
  assert.equal(source.includes("fontAfterVerticalDrag"), false);
  assert.equal(source.includes("SUBTITLE_PILL_BACKGROUND"), true);
});
