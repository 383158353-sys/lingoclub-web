import test from "node:test";
import assert from "node:assert/strict";
import { getStudyWordCacheResult, mergeCompleteAnalysis, partialAnalysisForCue, quickWordLookupPayload, resolveStudyWordLookup } from "../src/lib/studyLearningCache.js";

test("preprocessed cue data becomes immediate partial close-reading content", () => {
  const partial = partialAnalysisForCue({
    text_zh: "我猜我不用再自责了。",
    ai_processing: {
      translation: "我猜我不用再自责了。",
      difficultWords: [{ expression: "own", basicMeaning: "拥有", contextMeaning: "有" }],
      phrases: [{ expression: "beat myself up", basicMeaning: "自责", type: "idiom" }],
    },
  });
  assert.equal(partial.translation, "我猜我不用再自责了。");
  assert.equal(partial.words[0].word, "own");
  assert.equal(partial.words[0].meaning, "有");
  assert.equal(partial.phrases[0].phrase, "beat myself up");
  assert.equal(partial._complete, false);
  assert.equal(partial._preprocessed, true);
});

test("partial translation priority is ai_analysis, ai_processing, then subtitle text", () => {
  assert.equal(partialAnalysisForCue({ text_zh: "字幕", ai_processing: { translation: "预处理" }, ai_analysis: { translation: "精读" } }).translation, "精读");
  assert.equal(partialAnalysisForCue({ text_zh: "字幕", ai_processing: { translation: "预处理" } }).translation, "预处理");
  assert.equal(partialAnalysisForCue({ text_zh: "字幕" }).translation, "字幕");
});

test("subtitle-preprocessed word term cache wins before vocabulary profile and AI", async () => {
  let profileReads = 0;
  let apiCalls = 0;
  const cacheResult = getStudyWordCacheResult({
    getSubtitleTerm: () => ({ expression: "beat myself up", contextMeaning: "自责" }),
    getWordProfile: () => { profileReads += 1; return { meaning: "击打" }; },
  });
  const resolved = await resolveStudyWordLookup({ cacheResult, requestWordProfile: async () => { apiCalls += 1; } });
  assert.equal(resolved.source, "subtitle");
  assert.equal(profileReads, 0);
  assert.equal(apiCalls, 0);
});

test("vocabulary profile cache hit skips word_lookup", async () => {
  let apiCalls = 0;
  const cacheResult = getStudyWordCacheResult({
    getSubtitleTerm: () => null,
    getWordProfile: () => ({ meaning: "设想", pos: "v." }),
  });
  const resolved = await resolveStudyWordLookup({ cacheResult, requestWordProfile: async () => { apiCalls += 1; } });
  assert.equal(resolved.source, "profile");
  assert.equal(resolved.value.meaning, "设想");
  assert.equal(apiCalls, 0);
});

test("only two cache misses request the compact quick word_lookup payload", async () => {
  let apiCalls = 0;
  const cacheResult = getStudyWordCacheResult({ getSubtitleTerm: () => null, getWordProfile: () => null });
  const payload = quickWordLookupPayload("obscure", { subtitleText: "An obscure reference.", videoId: "movie-1", movieTitle: "Hacks" });
  const resolved = await resolveStudyWordLookup({
    cacheResult,
    requestWordProfile: async () => { apiCalls += 1; assert.equal(payload.quick, true); return { meaning: "晦涩的", pos: "adj." }; },
  });
  assert.equal(resolved.source, "ai");
  assert.equal(apiCalls, 1);
  assert.deepEqual(payload, {
    expression_en: "obscure",
    subtitle_text: "An obscure reference.",
    video_id: "movie-1",
    context: "Hacks; current subtitle: An obscure reference.",
    quick: true,
  });
});

test("completed live analysis replaces the partial cache without losing completion state", () => {
  const partial = partialAnalysisForCue({ text_zh: "初步翻译", ai_processing: { difficultWords: [{ expression: "word", basicMeaning: "词" }] } });
  const completed = mergeCompleteAnalysis({ cue1: partial }, "cue1", { translation: "完整翻译", words: [], phrases: [], grammar: "语法", cultural: "背景" });
  assert.equal(completed.cue1.translation, "完整翻译");
  assert.equal(completed.cue1.words[0].word, "word");
  assert.equal(completed.cue1.grammar, "语法");
  assert.equal(completed.cue1._complete, true);
  assert.equal(completed.cue1._preprocessed, false);
});
