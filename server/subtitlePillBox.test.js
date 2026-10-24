import test from "node:test";
import assert from "node:assert/strict";
import {
  SUBTITLE_FONT_DEFAULT,
  SUBTITLE_FONT_MAX,
  SUBTITLE_FONT_MIN,
  SUBTITLE_WIDTH_MIN,
  fontAfterVerticalDrag,
  fontFromLegacySubtitleHeight,
  readSubtitleBoxWidth,
  readSubtitleFontSize,
} from "../src/lib/subtitlePillBox.js";

test("default font and width when nothing is saved", () => {
  assert.equal(readSubtitleFontSize(null, null), SUBTITLE_FONT_DEFAULT);
  assert.equal(readSubtitleFontSize("", ""), SUBTITLE_FONT_DEFAULT);
  assert.equal(readSubtitleFontSize("0", "0"), SUBTITLE_FONT_DEFAULT);
  assert.equal(readSubtitleBoxWidth(null), 0);
  assert.equal(readSubtitleBoxWidth("0"), 0);
});

test("saved font wins over a legacy clip height and stays in range", () => {
  assert.equal(readSubtitleFontSize("28", "90"), 28);
  assert.equal(readSubtitleFontSize("99", "40"), SUBTITLE_FONT_MAX);
  assert.equal(readSubtitleFontSize("8", null), SUBTITLE_FONT_MIN);
  assert.equal(readSubtitleFontSize("21.6", null), 22);
});

test("legacy clip height migrates to a font when no font is saved", () => {
  assert.equal(fontFromLegacySubtitleHeight(32), readSubtitleFontSize(null, "32"));
  assert.equal(readSubtitleFontSize(null, "32"), 15);
  assert.equal(readSubtitleFontSize(null, "60"), 36);
  assert.equal(readSubtitleFontSize("", "200"), SUBTITLE_FONT_MAX);
  assert.equal(fontFromLegacySubtitleHeight(0), SUBTITLE_FONT_DEFAULT);
});

test("width is the wrap constraint, with a floor once the user has set one", () => {
  assert.equal(readSubtitleBoxWidth("480"), 480);
  assert.equal(readSubtitleBoxWidth("80"), SUBTITLE_WIDTH_MIN);
  assert.equal(readSubtitleBoxWidth("not-a-number"), 0);
});

test("vertical resize maps to font size and horizontal drag does not", () => {
  assert.equal(fontAfterVerticalDrag(21, 0), 21);
  assert.equal(fontAfterVerticalDrag(21, 40), 41);
  assert.equal(fontAfterVerticalDrag(21, -100), SUBTITLE_FONT_MIN);
  assert.equal(fontAfterVerticalDrag(40, 100), SUBTITLE_FONT_MAX);
});
