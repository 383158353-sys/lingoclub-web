import test from "node:test";
import assert from "node:assert/strict";
import { buildSubtitleBatches, findCueLearningTerm, processSubtitleEpisode, subtitleHash } from "../src/lib/subtitleAiProcessing.js";

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
    assert.ok(calls >= 2);
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});
