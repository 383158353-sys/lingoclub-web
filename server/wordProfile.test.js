import test from "node:test";
import assert from "node:assert/strict";
import { inferExpressionType, isCurrentWordProfile, normalizeWordProfile, WORD_PROFILE_SCHEMA_VERSION } from "../src/lib/wordProfile.js";
import { aiCacheKey } from "../src/lib/localApi.js";

test("legacy meaning/pos profile is stale and normalizes into a POS sense row", () => {
  const old = { meaning: "守灵", pos: "n.", phonetic_us: "/weɪk/" };
  assert.equal(isCurrentWordProfile(old), false);
  const next = normalizeWordProfile(old, "wake");
  assert.equal(next.schema_version, WORD_PROFILE_SCHEMA_VERSION);
  assert.deepEqual(next.senses, [{ pos: "n.", meanings: ["守灵"] }]);
  assert.equal(isCurrentWordProfile(next), true);
});

test("new word profile keeps POS meanings and reliable word roots", () => {
  const next = normalizeWordProfile({
    expression: "wake",
    expression_type: "word",
    phonetic_us: "/weɪk/",
    phonetic_uk: "/weɪk/",
    senses: [{ pos: "v.", meanings: ["醒来", "唤醒"] }, { pos: "n.", meanings: ["守夜", "尾流"] }],
    roots: [{ part: "wake", type: "词根", meaning: "醒来" }],
    synthesis: "",
  }, "wake");
  assert.equal(isCurrentWordProfile(next), true);
  assert.deepEqual(next.senses.map((sense) => sense.pos), ["v.", "n."]);
  assert.equal(next.roots.length, 1);
});

test("Word Detail cache fingerprint changes with profile schema version", () => {
  const payload = { expression_en: "wake", cache_key: "cue-1|I wake up." };
  const oldKey = aiCacheKey("vocabulary_analysis", payload, "route", WORD_PROFILE_SCHEMA_VERSION - 1);
  const newKey = aiCacheKey("vocabulary_analysis", payload, "route", WORD_PROFILE_SCHEMA_VERSION);
  const otherSource = aiCacheKey("vocabulary_analysis", { ...payload, cache_key: "cue-2|I wake up now." }, "route", WORD_PROFILE_SCHEMA_VERSION);
  assert.notEqual(oldKey, newKey);
  assert.notEqual(newKey, otherSource);
});

test("Word Detail classifies words, expressions, and full sentences without sentence IPA", () => {
  assert.equal(inferExpressionType("debate"), "word");
  assert.equal(inferExpressionType("stop beating oneself up"), "phrase");
  assert.equal(inferExpressionType("I guess I'll stop beating myself up."), "sentence");
});
