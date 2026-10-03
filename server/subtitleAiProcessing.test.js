import test from "node:test";
import assert from "node:assert/strict";
import { buildSubtitleBatches, buildSubtitleTranslationBatches, findCueLearningTerm, processSubtitleEpisode, processSubtitleLearningWindow, subtitleHash } from "../src/lib/subtitleAiProcessing.js";

function cues(count) {
  return Array.from({ length: count }, (_, index) => ({ id: `cue-${index}`, time_start: `${index}`, time_end: `${index + 1}`, text_en: `Line ${index}` }));
}

test("subtitle batches are 36 cues max with four-cue overlap and complete core coverage", () => {
  const source = cues(200);
  const blocks = buildSubtitleBatches(source);
  assert.ok(blocks.every((block) => block.cues.length <= 36));
  assert.equal(blocks[1].cues[0].id, blocks[0].cues[32].id);
  assert.deepEqual(blocks[1].cues.slice(0, 4).map((cue) => cue.id), blocks[0].cues.slice(-4).map((cue) => cue.id));
  const core = blocks.flatMap((block) => block.coreCues.map((cue) => cue.id));
  assert.equal(new Set(core).size, source.length);
  assert.deepEqual(new Set(core), new Set(source.map((cue) => cue.id)));
});

test("subtitle translations use chronological 16-cue batches instead of per-cue requests", () => {
  const batches250 = buildSubtitleTranslationBatches(cues(250));
  const batches858 = buildSubtitleTranslationBatches(cues(858));
  assert.deepEqual(batches250.map((batch) => batch.coreCues.length), Array(15).fill(16).concat(10));
  assert.equal(batches858.length, 54);
  assert.ok(batches250[1].cues.some((cue) => !cue.target));
});

test("subtitle hash changes only with the source cue identity, timestamp, or text", () => {
  const first = cues(2);
  assert.equal(subtitleHash(first), subtitleHash(first.map((cue) => ({ ...cue, text_zh: "译文", ai_processing: { translation: "译文" } }))));
  assert.notEqual(subtitleHash(first), subtitleHash([{ ...first[0], text_en: "edited" }, first[1]]));
});

test("clicking a word in a spoken phrase resolves to its cached canonical phrase", () => {
  const cue = { phrases: [{ expression: "give someone a call", type: "spoken-expression", contextMeaning: "打电话联系某人", basicMeaning: "给某人打电话" }] };
  assert.equal(findCueLearningTerm(cue, "quick", "Give me a quick call tomorrow.")?.expression, "give someone a call");
  assert.equal(findCueLearningTerm(cue, "call", "Give me a quick call tomorrow.")?.expression, "give someone a call");
});

test("persisted cue processing restores translations and avoids another batch request", async () => {
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  try {
    const source = [{ ...cues(1)[0], ai_processing: { subtitleHash: subtitleHash(cues(1)), translation: "第零行", difficultWords: [], phrases: [] } }];
    let calls = 0;
    const result = await processSubtitleEpisode({ videoId: "v1", subtitles: source, getCurrentTime: () => 0, onProgress: () => { calls += 1; } });
    assert.equal(result.subtitles[0].text_zh, "第零行");
    assert.equal(result.cache.diagnostics.batchTranslationCalls, 0);
    assert.equal(calls, 1);
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

test("already bilingual subtitles are returned as-is without batch translation calls", async () => {
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  try {
    const source = [
      { ...cues(1)[0], text_zh: "第一句" },
      { id: "cue-1", time_start: "1", time_end: "2", text_en: "Line 1", text_zh: "第二句" },
    ];
    let latest;
    const result = await processSubtitleEpisode({
      videoId: "bilingual-import",
      subtitles: source,
      getCurrentTime: () => 0,
      onProgress: (progress) => { latest = progress; },
    });
    assert.deepEqual(result.subtitles.map((cue) => cue.text_zh), ["第一句", "第二句"]);
    assert.equal(result.cache.diagnostics.batchTranslationCalls, 0);
    assert.equal(latest.phase, "ready");
    assert.equal(latest.completed, 2);
    assert.equal(latest.total, 2);
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

test("only missing Chinese cues remain eligible for translation", async () => {
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  try {
    const source = [
      { id: "source-zh", time_start: "0", time_end: "1", text_en: "English one", text_zh: "已有中文" },
      { id: "missing-zh", time_start: "1", time_end: "2", text_en: "English two", text_zh: "" },
    ];
    const firstProgress = [];
    const result = await processSubtitleEpisode({ videoId: "mixed-import", subtitles: source, getCurrentTime: () => 0, onProgress: (progress) => { firstProgress.push(progress); } });
    assert.equal(result.diagnostics.missingTranslationCues, 1);
    assert.equal(firstProgress[0].completed, 1);
    assert.equal(firstProgress[0].total, 2);
    assert.equal(source[0].text_zh, "已有中文");
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

test("250 missing translations stream chronologically in 16-cue batches and cache each sentence", async () => {
  const previous = globalThis.localStorage;
  const storage = new Map();
  globalThis.localStorage = { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  try {
    let calls = 0;
    let active = 0;
    let peakConcurrency = 0;
    const progress = [];
    const result = await processSubtitleEpisode({
      videoId: "250-cue-test",
      subtitles: cues(250),
      getCurrentTime: () => 0,
      translateBatch: async (task, payload, options) => {
        assert.equal(task, "subtitle_translate_batch");
        assert.ok(payload.cues.filter((cue) => cue.target).length <= 16);
        assert.ok(payload.cues.some((cue) => cue.target));
        calls += 1;
        active += 1;
        peakConcurrency = Math.max(peakConcurrency, active);
        options.onDiagnostics({ cacheHit: false, deduped: false, networkRequests: 1 });
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { translation_batch: { cues: payload.cues.map((cue) => ({ cueId: cue.cueId, translation: `译文 ${cue.cueId}` })) } };
      },
      onProgress: (item) => progress.push(item),
    });
    assert.equal(calls, 16);
    assert.equal(peakConcurrency, 1);
    assert.equal(result.diagnostics.apiCalls, 16);
    assert.equal(result.diagnostics.completedCues, 250);
    assert.ok(progress.some((item) => item.completed >= 50 && item.subtitles?.some((cue) => cue.text_zh)));
    assert.equal(result.subtitles[249].text_zh, "译文 cue-249");
    assert.equal(result.subtitles.some((cue) => cue.ai_processing), false);
    assert.ok(progress.find((item) => item.completed === 16).subtitles.slice(0, 16).every((cue) => cue.text_zh));
    const edited = result.subtitles.map((cue) => cue.id === "cue-0" ? { ...cue, text_en: "Changed caption" } : cue);
    const second = await processSubtitleEpisode({ videoId: "250-cue-test", subtitles: edited, getCurrentTime: () => 0, translateBatch: async () => { throw new Error("unchanged sentences should be cached"); } });
    assert.equal(second.subtitles[1].text_zh, "译文 cue-1");
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

test("learning preload only analyzes the current 61-cue window and writes clickable terms", async () => {
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  try {
    const source = cues(120);
    const requests = [];
    const result = await processSubtitleLearningWindow({
      videoId: "learning-window",
      subtitles: source,
      getCurrentTime: () => 50,
      analyzeBatch: async (task, payload) => {
        assert.equal(task, "subtitle_learning_batch");
        requests.push(payload);
        return { learning_batch: { cues: payload.cues.filter((cue) => cue.target).map((cue) => ({
          cueId: cue.cueId,
          difficultWords: [{ expression: "line", type: "word", basicMeaning: "线", contextMeaning: "台词", partOfSpeech: "n.", cueId: cue.cueId }],
          phrases: [],
        })) } };
      },
    });
    assert.equal(result.total, 61);
    assert.equal(requests.length, 4);
    assert.ok(requests[0].cues.some((cue) => cue.cueId === "cue-50" && cue.target));
    assert.equal(result.subtitles[50].ai_processing.difficultWords[0].expression, "line");
    assert.equal(findCueLearningTerm(result.subtitles[50].ai_processing, "line", "Line 50")?.contextMeaning, "台词");
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});
