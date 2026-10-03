import test from "node:test";
import assert from "node:assert/strict";
import { mergeFragments } from "../src/lib/subtitleCleaner.js";

function fragments(lines) {
  return lines.map(([text, start, end], index) => ({
    id: `cue-${index}`,
    text_en: text,
    time_start: String(start),
    time_end: String(end),
  }));
}

test("natural segmentation keeps dependent clauses and joins caption continuations", () => {
  const result = mergeFragments(fragments([
    ["face but it's not really", 1, 2],
    ["smiling", 2, 2.5],
    ["It's just like, man, my parents were way too cheap to send me", 2.6, 5],
    ["to Kumon.", 5, 5.5],
    ["They got a different strategy", 6, 7],
    ["because they never let me use a calculator.", 7, 9],
  ]));
  assert.equal(result.length, 3);
  assert.match(result[0].text_en, /face but it's not really smiling\./i);
  assert.match(result[1].text_en, /It's just like.*to Kumon\./);
  assert.match(result[2].text_en, /They got a different strategy because/);
  assert.deepEqual(result[0].sourceFragmentIds, ["cue-0", "cue-1"]);
  assert.equal(result[0].time_start, "1");
  assert.equal(result[0].time_end, "2.5");
});

test("sentence timings cover the exact first and last source fragments", () => {
  const result = mergeFragments(fragments([
    ["At the beginning", 0, 1],
    ["of this sentence,", 1, 2],
    ["the important phrase", 2, 3],
    ["get into the weeds", 3, 4],
    ["is at the end.", 4, 5],
  ]));
  assert.equal(result.length, 1);
  assert.equal(result[0].time_start, "0");
  assert.equal(result[0].time_end, "5");
  assert.deepEqual(result[0].sourceFragmentIds, ["cue-0", "cue-1", "cue-2", "cue-3", "cue-4"]);
  assert.equal(result[0].sourceStartIndex, 0);
  assert.equal(result[0].sourceEndIndex, 4);
  assert.equal(result[0].sentenceId, result[0].id);
});

test("punctuation splits sentences while preserving source timing and ids", () => {
  const result = mergeFragments(fragments([["First sentence. Second sentence?", 10, 12]]));
  assert.equal(result.length, 2);
  assert.equal(result[0].time_start, "10");
  assert.equal(result[0].time_end, "12");
  assert.equal(result[1].time_start, "10");
  assert.equal(result[1].time_end, "12");
  assert.notEqual(result[0].sentenceId, result[1].sentenceId);
});

test("and/but/because/so continuations are not treated as sentence boundaries", () => {
  for (const conjunction of ["and", "but", "because", "so", "that", "which", "if", "when"]) {
    const result = mergeFragments(fragments([["The first clause", 0, 1], [`${conjunction} the second clause.`, 1, 2]]));
    assert.equal(result.length, 1, conjunction);
    assert.match(result[0].text_en, new RegExp(`\\b${conjunction}\\b`, "i"));
  }
});

test("first and last caption fragments retain their source range", () => {
  const result = mergeFragments(fragments([["First.", 0, 0.5], ["Middle fragment", 1, 2], ["Last.", 2, 3]]));
  assert.equal(result[0].sourceStartIndex, 0);
  assert.equal(result.at(-1).sourceEndIndex, 2);
});

test("get into the weeds source phrase resolves to its full sentence around 2:57", () => {
  const result = mergeFragments(fragments([
    ["I don't want to get into", 177, 178],
    ["the weeds, but here is the point.", 178, 181],
    ["The next sentence starts after that.", 180, 182],
  ]));
  const sentence = result.find((cue) => cue.text_en.toLowerCase().includes("get into the weeds"));
  assert.ok(sentence);
  assert.equal(sentence.time_start, "177");
  assert.equal(sentence.time_end, "181");
  assert.equal(sentence.sourceStartIndex, 0);
  assert.equal(sentence.sourceEndIndex, 1);
});
