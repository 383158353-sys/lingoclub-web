import test from "node:test";
import assert from "node:assert/strict";
import { articleVocabularyContext } from "../src/lib/articleVocabularyContext.js";

const body = "The insects prefer cool weather. A species originating from France excavates tunnels. The latter produce several generations annually. They are matched with smaller species. The former are slow to recover after winter.";

test("article source keeps the real matching sentence including inflected headwords", () => {
  assert.equal(articleVocabularyContext(body, "excavate"), "A species originating from France excavates tunnels.");
  assert.equal(articleVocabularyContext(body, "originate from"), "A species originating from France excavates tunnels.");
  assert.equal(articleVocabularyContext(body, "generation"), "The latter produce several generations annually.");
  assert.equal(articleVocabularyContext(body, "be matched with"), "They are matched with smaller species.");
  assert.equal(articleVocabularyContext(body, "be slow to do"), "The former are slow to recover after winter.");
});

test("missing expressions never borrow an unrelated first sentence", () => {
  assert.equal(articleVocabularyContext(body, "coastal"), "");
  assert.equal(articleVocabularyContext("excavate", "excavate"), "");
  assert.equal(articleVocabularyContext("", "excavate"), "");
});
