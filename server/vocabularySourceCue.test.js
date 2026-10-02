import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSourceCue, resolveVocabularySourceCue } from "../src/lib/vocabularySourceCue.js";

test("word and phrase sources anchor to the complete subtitle cue, not the click timestamp", () => {
  const sourceCue = normalizeSourceCue({
    id: "cue-8", start: 145.111, end: 148.42,
    textEn: "Oh shit, ran! get a couple Advil...", textZh: "糟了，跑了！拿几片止痛药……",
  });
  assert.equal(sourceCue.id, "cue-8");
  assert.equal(sourceCue.start, 145.111);
  assert.equal(sourceCue.end, 148.42);
  assert.equal(sourceCue.textEn, "Oh shit, ran! get a couple Advil...");
});

test("legacy timestamp-only sources recover their full cue by subtitle id or covered time", () => {
  const subtitles = [
    { id: "cue-8", time_start: 145.111, time_end: 148.42, text_en: "Oh shit, ran! get a couple Advil...", text_zh: "糟了，跑了！" },
    { id: "cue-9", time_start: 148.42, time_end: 151, text_en: "I'll be fine.", text_zh: "我会没事。" },
  ];
  assert.deepEqual(resolveVocabularySourceCue({ source_subtitle_id: "cue-8" }, subtitles), {
    id: "cue-8", start: 145.111, end: 148.42, textEn: "Oh shit, ran! get a couple Advil...", textZh: "糟了，跑了！",
  });
  assert.equal(resolveVocabularySourceCue({ timestamp: 146.9 }, subtitles).id, "cue-8");
});
