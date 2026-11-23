import test from "node:test";
import assert from "node:assert/strict";
import { articleDomain, articleParagraphs, articlePath, articleSourceUrl, groupArticlesByDate, normalizeAnalysis, parseMarkdownTable, scrubAnalysisRemark, vocabDisplayFields } from "../src/lib/dailyArticlesFormat.js";

test("analysis tolerates missing, malformed and extra fields", () => {
  const empty = { paragraph_summaries: [], key_vocab: [], long_sentences: [], ielts_expressions: [], questions: [], answer_key: [], pitfalls: [] };
  for (const raw of [undefined, null, [], "bad", { key_vocab: "bad" }, { paragraph_summaries: [null, {}, []] }]) assert.deepEqual(normalizeAnalysis(raw), empty);
  const parsed = normalizeAnalysis({ paragraph_summaries: [{ index: 2, zh: " 大意 " }], key_vocab: [null, { en: " word ", note: 4, extra: true }], long_sentences: [{ en: "Sentence.", zh: "译文", structure: "结构" }], ielts_expressions: [{ en: "a phrase", usage: "用法" }], other: true });
  assert.deepEqual(parsed.paragraph_summaries, [{ index: 2, zh: "大意" }]);
  assert.equal(parsed.key_vocab[0].en, "word");
  assert.equal(parsed.key_vocab[0].zh, "");
  assert.equal(parsed.long_sentences.length, 1); assert.equal(parsed.ielts_expressions.length, 1);
});
test("article grouping, paragraphs and safe source links", () => {
  assert.deepEqual(groupArticlesByDate([{ rec_date: "2026-10-13" }, { rec_date: "2026-10-14" }, { rec_date: "2026-10-13" }], "2026-10-14").map((group) => [group.date, group.items.length]), [["2026-10-14", 1], ["2026-10-13", 2]]);
  assert.deepEqual(articleParagraphs(" First.\r\n\r\n Second.\n \nThird. "), ["First.", "Second.", "Third."]);
  assert.equal(articleDomain("https://www.example.com/read"), "example.com");
  assert.equal(articleSourceUrl("javascript:alert(1)"), ""); assert.equal(articleSourceUrl("https://x:y@example.com"), "");
  assert.equal(articlePath("a/b"), "/articles/a%2Fb");
});

test("classroom notes keep old keys and hide PDF/classroom boilerplate", () => {
  const parsed = normalizeAnalysis({
    key_vocab: [{ en: "temperate", zh: "温带的", ipa: "/ˈtempərət/", pos: "adj.", note: "PDF第6页第3段；课堂新词/复习项，收藏不代表掌握。" }],
    long_sentences: [{ en: "The former are slow.", zh: "前者恢复较慢。", structure: "The former", clauses: "不定式", reference: "former=French", question_no: "10" }],
    ielts_expressions: [{ en: "a handful at a time", usage: "分批", zh: "每次一把", how: "描述投放" }],
    questions: [{ number: "9-13", instruction: "Complete the table.", table_markdown: "| Species | Climate |\n| Spanish | {9} |" }],
    answer_key: [{ number: "9", answer: "temperate" }],
    pitfalls: ["climate 问气候，不能把地点当气候类别"],
  });
  assert.equal(parsed.key_vocab[0].note, "");
  assert.equal(parsed.key_vocab[0].ipa, "/ˈtempərət/");
  assert.deepEqual(vocabDisplayFields(parsed.key_vocab[0]).map(([key]) => key), ["ipa", "pos", "zh"]);
  assert.equal(parsed.long_sentences[0].question_no, "10");
  assert.equal(parsed.ielts_expressions[0].zh, "每次一把");
  assert.equal(parsed.questions[0].table.rows[1][1].blank, true);
  assert.equal(parsed.questions[0].table.rows[1][1].number, "9");
  assert.equal(parsed.answer_key[0].answer, "temperate");
  assert.equal(scrubAnalysisRemark("PDF第6页第1段；原文就在本篇正文上方。课堂新词/复习项，收藏不代表掌握。"), "");
  const table = parseMarkdownTable("| A | B |\n| --- | --- |\n| x | {10}gap |");
  assert.equal(table.rows[1][1].number, "10");
});
