import test from "node:test";
import assert from "node:assert/strict";
import {
  compactExpressionText,
  detailExpressionPresentation,
  detailPosLabel,
  showRecallSentence,
} from "../src/lib/wordDetailPresentation.js";

const lyric = "♪ Gotta make you understand\n♪♪ Never gonna give you up ♪♪\nNever gonna let you down ♪♪";

test("a lyric sentence is one compact line without music notes", () => {
  const presentation = detailExpressionPresentation(lyric, "sentence");
  assert.equal(presentation.compact, true);
  assert.equal(presentation.text.includes("♪"), false);
  assert.equal(presentation.text.includes("\n"), false);
  assert.equal(presentation.text, "Gotta make you understand Never gonna give you up Never gonna let you down");
  assert.equal(compactExpressionText(lyric), presentation.text);
});

test("a lyric cue is compact even before a profile assigns sentence", () => {
  const presentation = detailExpressionPresentation(lyric);
  assert.equal(presentation.compact, true);
  assert.equal(presentation.expressionType, "sentence");
});

test("short headwords and phrases keep the large title", () => {
  assert.equal(detailExpressionPresentation("analogous", "word").compact, false);
  assert.equal(detailExpressionPresentation("surpass oneself", "phrase").compact, false);
  assert.equal(detailExpressionPresentation("tour-de-force").compact, false);
});

test("sentence details do not prefix the gloss with sent. or phr.", () => {
  assert.equal(detailPosLabel("sent."), "");
  assert.equal(detailPosLabel("phr."), "");
  assert.equal(detailPosLabel("SENT."), "");
  assert.equal(detailPosLabel("n."), "n.");
  assert.equal(detailPosLabel(""), "");
});

test("原句 repeats a longer source sentence and skips a headword-only copy", () => {
  const cleaned = compactExpressionText(lyric);
  assert.equal(showRecallSentence(lyric, lyric, { compact: true }), false);
  assert.equal(showRecallSentence(`${lyric} She walks away.`, lyric, { compact: true }), true);
  assert.equal(showRecallSentence("analogous", "analogous", { compact: false }), false);
  assert.equal(showRecallSentence("the colours are analogous", "analogous", { compact: false }), true);
  assert.equal(cleaned.split(" ").length > 5, true);
});
