import test from "node:test";
import assert from "node:assert/strict";
import { restoreExtraLargeFields } from "../src/lib/localStudyMeta.js";

test("hydrating a movie restores oversized subtitles saved outside localStorage", () => {
  const subtitles = [{ id: "cue-1", text_en: "An evolving language", text_zh: "一种不断演变的语言" }];
  const record = { id: "movie-1", subtitle_count: 1 };
  const hydrated = restoreExtraLargeFields(record, { subtitles });

  assert.deepEqual(hydrated.subtitles, subtitles);
  assert.equal(hydrated.subtitle_count, 1);
});

test("inline movie fields win over stale oversized-field copies", () => {
  const currentSubtitles = [{ id: "cue-1", text_en: "Updated line", text_zh: "更新后的句子" }];
  const staleSubtitles = [{ id: "cue-1", text_en: "Old line" }];
  const hydrated = restoreExtraLargeFields({ subtitles: currentSubtitles }, { subtitles: staleSubtitles });

  assert.deepEqual(hydrated.subtitles, currentSubtitles);
});
