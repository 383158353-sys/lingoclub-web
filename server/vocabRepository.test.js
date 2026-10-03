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
