import test from "node:test";
import assert from "node:assert/strict";
import { articleDomain, articleParagraphs, articlePath, articleSourceUrl, groupArticlesByDate, normalizeAnalysis } from "../src/lib/dailyArticlesFormat.js";

test("analysis tolerates missing, malformed and extra fields", () => {
  const empty = { paragraph_summaries: [], key_vocab: [], long_sentences: [], ielts_expressions: [] };
  for (const raw of [undefined, null, [], "bad", { key_vocab: "bad" }, { paragraph_summaries: [null, {}, []] }]) assert.deepEqual(normalizeAnalysis(raw), empty);
  const parsed = normalizeAnalysis({ paragraph_summaries: [{ index: 2, zh: " 大意 " }], key_vocab: [null, { en: " word ", note: 4, extra: true }], long_sentences: [{ en: "Sentence.", zh: "译文", structure: "结构" }], ielts_expressions: [{ en: "a phrase", usage: "用法" }], other: true });
  assert.deepEqual(parsed.paragraph_summaries, [{ index: 2, zh: "大意" }]);
  assert.deepEqual(parsed.key_vocab, [{ en: "word", zh: "", note: "" }]);
  assert.equal(parsed.long_sentences.length, 1); assert.equal(parsed.ielts_expressions.length, 1);
});
test("article grouping, paragraphs and safe source links", () => {
  assert.deepEqual(groupArticlesByDate([{ rec_date: "2026-10-13" }, { rec_date: "2026-10-14" }, { rec_date: "2026-10-13" }], "2026-10-14").map((group) => [group.date, group.items.length]), [["2026-10-14", 1], ["2026-10-13", 2]]);
  assert.deepEqual(articleParagraphs(" First.\r\n\r\n Second.\n \nThird. "), ["First.", "Second.", "Third."]);
  assert.equal(articleDomain("https://www.example.com/read"), "example.com");
  assert.equal(articleSourceUrl("javascript:alert(1)"), ""); assert.equal(articleSourceUrl("https://x:y@example.com"), "");
  assert.equal(articlePath("a/b"), "/articles/a%2Fb");
});
