import test from "node:test";
import assert from "node:assert/strict";
import { getStudyCueLoopRange } from "../src/lib/studyCueNavigation.js";
import {
  articleReturnPath,
  focusSourceText,
  focusedTranslation,
  highlightParts,
  isHeadwordOnly,
  locateArticleSentence,
  narrowLoopToSentence,
  selectSentenceCue,
  shouldShowSentenceTranslation,
  textHasExpression,
} from "../src/lib/sourceSentenceFocus.js";

const article = [
  "AI is creating a 'human premium' for art made by people. But will it hold?",
  "In response to the surge in AI-created content, academics are racing to develop a universally recognised symbol. Labels like \"AI-free\" are already appearing.",
].join("\n\n");

test("article recall keeps only the sentence that contains the word", () => {
  const focus = focusSourceText(article, "surge");
  assert.equal(focus.matched, true);
  assert.match(focus.sentence, /^In response to the surge/);
  assert.equal(focus.before, "But will it hold?");
  assert.match(focus.after, /^Labels like/);
  assert.equal(textHasExpression("the starting point of art", "art"), true);
  assert.equal(textHasExpression("starting over", "art"), false);
});

test("a missing word does not pretend the lede contains it", () => {
  const focus = focusSourceText("AI is creating a 'human premium' for art made by people. But will it hold?", "obsequious");
  assert.equal(focus.matched, false);
  assert.match(focus.sentence, /^AI is creating/);
});

test("the target word is the only highlighted span", () => {
  const parts = highlightParts("designers are leaning into graphic design", "graphic");
  assert.deepEqual(parts.filter((part) => part.match).map((part) => part.text), ["graphic"]);
  assert.equal(parts.map((part) => part.text).join(""), "designers are leaning into graphic design");
});

test("paragraph translations that are not sentence-aligned are dropped, gloss repeats are hidden", () => {
  const en = "People noticed the surge. Labels followed.";
  const zh = "人们注意到了激增。随后出现了标签。";
  assert.equal(focusedTranslation(en, zh, "surge"), "人们注意到了激增。");
  assert.equal(focusedTranslation(en, "面对大量内容，学者们正在设计标识。", "surge"), "");
  assert.equal(focusedTranslation("even mutiny broke out", "却靠贿赂、逢迎甚至叛变。", "mutiny"), "却靠贿赂、逢迎甚至叛变。");
  assert.equal(shouldShowSentenceTranslation("谄媚的", "谄媚的；奉承的"), false);
  assert.equal(shouldShowSentenceTranslation("却靠贿赂、逢迎甚至叛变。", "兵变"), true);
  assert.equal(isHeadwordOnly("obsequious", "obsequious"), true);
  assert.equal(isHeadwordOnly("even mutiny", "mutiny"), false);
});

test("returning to an article addresses the sentence, not the top of the reader", () => {
  const path = articleReturnPath({
    source_type: "article",
    source_record_id: "article 1",
    source_sentence_en: article,
    expression_en: "surge",
  });
  const url = new URL(path, "https://lingoclub.local");
  assert.equal(url.pathname, "/articles/article%201");
  assert.match(url.searchParams.get("sentence"), /^In response to the surge/);
  assert.equal(url.searchParams.get("word"), "surge");
  assert.deepEqual(locateArticleSentence(article, {
    sentence: url.searchParams.get("sentence"),
    word: "surge",
  }), { paragraphIndex: 1, sentenceIndex: 0 });
  assert.equal(articleReturnPath({ source_type: "library_article", source_record_id: "lib" }).startsWith("/library-articles/lib"), true);
});

test("a one-sentence cue keeps its study loop range", () => {
  const cue = { id: "mutiny", time_start: 20.308, time_end: 24.1, text_en: "yet they relentlessly vie for control through bribery, flattery, and even mutiny." };
  const range = getStudyCueLoopRange(cue, [cue]);
  assert.deepEqual(narrowLoopToSentence(range, cue.text_en, "mutiny"), { start: range.start, end: range.end });
});

test("a multi-sentence transcript loops only the sentence containing the word", () => {
  const text = "China called the show a hit.\nRichard blew up and even mutiny followed.\nShe called the house in LA.";
  const cue = { id: "long", time_start: 0, time_end: 30, text_en: text };
  const next = { id: "next", time_start: 30, time_end: 34, text_en: "Later." };
  const range = getStudyCueLoopRange(cue, [cue, next]);
  const narrowed = narrowLoopToSentence(range, text, "mutiny");
  assert.ok(narrowed.start > range.start);
  assert.ok(narrowed.end < range.end);
  assert.ok(narrowed.end - narrowed.start < range.end - range.start);
  const picked = selectSentenceCue(
    { source_subtitle_id: "long", source_time_start: 1 },
    [
      { id: "long", time_start: 0, time_end: 40, text_en: "unrelated transcript about a show" },
      { id: "hit", time_start: 42, time_end: 46, text_en: "even mutiny broke out" },
    ],
    "mutiny",
  );
  assert.equal(picked.id, "hit");
});
