import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

test("review persistence uses the repository's supported review-state API", async () => {
  const repoPath = fileURLToPath(new URL("../src/lib/vocabRepository.js", import.meta.url));
  const collectionPath = fileURLToPath(new URL("../src/pages/Collection.jsx", import.meta.url));
  const [repository, collection] = await Promise.all([readFile(repoPath, "utf8"), readFile(collectionPath, "utf8")]);
  assert.match(repository, /updateReviewState\s*:\s*\(id, state\)\s*=>\s*guestVocab\.update\(id, state\)/);
  assert.match(collection, /VocabApi\.updateReviewState\(id, fields\)/);
  assert.doesNotMatch(collection, /VocabApi\.update\(id, fields\)/);
});

test("review choices load the full collection and use explicit today/recent filters", async () => {
  const collectionPath = fileURLToPath(new URL("../src/pages/Collection.jsx", import.meta.url));
  const collection = await readFile(collectionPath, "utf8");
  assert.match(collection, /VocabApi\.list\("-created_date"\)/);
  assert.doesNotMatch(collection, /VocabApi\.list\("-created_date",\s*500\)/);
  assert.match(collection, /selectCollectionReviewCards\(vocab,\s*mode\)/);
  assert.match(collection, /\["today",\s*"今日收藏"\]/);
  assert.match(collection, /\["recent",\s*"最近 7 天收藏"\]/);
});
