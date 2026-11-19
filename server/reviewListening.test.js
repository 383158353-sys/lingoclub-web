import test from "node:test";
import assert from "node:assert/strict";
import { buildLocalDistractors, buildReviewQuestion, clearReviewDistractorCache, distractorsForReview, getReviewQuestionPresentation, isCorrectReviewAnswer, prepareReviewDistractors } from "../src/lib/reviewDistractors.js";

const card = {
  id: "marquee",
  expression_en: "marquee",
  meaning_zh: "大帐篷；招牌",
  profile: { phonetic_us: "/məˈriː/", pos: "名词" },
};
const distractors = ["遮篷；雨棚", "广告牌；告示牌", "舞台；看台"];

test("listening prompt hides spelling until answered and reveals pronunciation afterwards", () => {
  assert.deepEqual(getReviewQuestionPresentation(card, "r3"), {
    promptText: "", audioText: "marquee", instruction: "播放英文，再选择正确的中文释义", answerText: "", phonetic: "",
  });
  assert.deepEqual(getReviewQuestionPresentation(card, "r3", true), {
    promptText: "marquee", audioText: "marquee", instruction: "播放英文，再选择正确的中文释义", answerText: "大帐篷；招牌", phonetic: "/məˈriː/",
  });
});

test("100 listening questions shuffle four unique Chinese meanings and grade the correct choice at every position", () => {
  let seed = 0x12345678;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const positions = [0, 0, 0, 0];

  for (let index = 0; index < 100; index += 1) {
    const question = buildReviewQuestion(card, [], "r3", distractors, random);
    assert.equal(question.options.length, 4);
    const values = question.options.map((option) => option.value);
    assert.equal(new Set(values.map((value) => value.replace(/[\s，。；;、,：:！!？?（）()\[\]【】/\\·]/g, ""))).size, 4);
    assert.ok(values.every((value) => /[\u3400-\u9fff]/.test(value)));
    const correctIndex = question.options.findIndex((option) => option.id === question.correctAnswerId);
    assert.notEqual(correctIndex, -1);
    positions[correctIndex] += 1;
    assert.equal(isCorrectReviewAnswer(question, question.options[correctIndex]), true);
    for (const option of question.options.filter((item) => item.id !== question.correctAnswerId)) {
      assert.equal(isCorrectReviewAnswer(question, option), false);
    }
  }

  assert.ok(positions.every((count) => count > 0), `Expected all positions to occur; got ${positions}`);
});

test("listening uses Chinese meaning distractors from the shared vocabulary pool", () => {
  const question = buildReviewQuestion(card, [], "r3", ["遮篷；雨棚", "雨棚，遮篷", "广告牌；告示牌", "舞台；看台", "marquee sign"] , () => 0.5);
  assert.deepEqual(question.options.map((option) => option.value).sort(), [card.meaning_zh, "遮篷；雨棚", "广告牌；告示牌", "舞台；看台"].sort());
  const unrelatedSamePartOfSpeech = { id: "cat", expression_en: "cat", meaning_zh: "猫", profile: { pos: "名词" } };
  assert.ok(!buildLocalDistractors(card, [card, unrelatedSamePartOfSpeech], "r3").includes("猫"));
});

test("review prefers local choices, then asynchronously fills missing choices from AI", async () => {
  clearReviewDistractorCache();
  const current = { id: "wiener", expression_en: "wiener", meaning_zh: "香肠" };
  const pool = [
    current,
    { id: "weiner", expression_en: "weiner", meaning_zh: "维也纳香肠" },
    { id: "wieners", expression_en: "wieners", meaning_zh: "热狗" },
    { id: "winner", expression_en: "winner", meaning_zh: "获胜者" },
    { id: "wiener-dog", expression_en: "wiener dog", meaning_zh: "腊肠犬" },
  ];
  const immediate = distractorsForReview(current, pool, "r3");
  assert.equal(immediate.length, 3);
  assert.ok(immediate.every((value) => /[\u3400-\u9fff]/.test(value)));
  assert.ok(!immediate.includes(current.meaning_zh));
  const question = buildReviewQuestion(current, pool, "r3", immediate, () => 0);
  assert.equal(question.options.length, 4);
  assert.equal(question.options.filter((option) => option.value === current.meaning_zh).length, 1);
  let localFallbackCalls = 0;
  await prepareReviewDistractors([current], pool, async () => { localFallbackCalls += 1; });
  assert.equal(localFallbackCalls, 0);

  const alone = { id: "solo", expression_en: "solo", meaning_zh: "独奏" };
  assert.deepEqual(distractorsForReview(alone, [alone], "r3"), []);
  await prepareReviewDistractors([alone], [alone], async () => ({
    meaning_options: ["独奏表演", "独唱", "协奏曲"],
    expression_options: ["soloist", "soloing", "solitary"],
    listening_options: ["独奏表演", "独唱", "协奏曲"],
  }));
  const warmed = distractorsForReview(alone, [alone], "r3");
  assert.deepEqual(warmed, ["独奏表演", "独唱", "协奏曲"]);
  assert.equal(buildReviewQuestion(alone, [alone], "r3", warmed, () => 0).options.length, 4);

  clearReviewDistractorCache();
  await prepareReviewDistractors([alone], [alone], async () => { throw new Error("offline"); });
  assert.deepEqual(distractorsForReview(alone, [alone], "r3"), []);
});
