import test from "node:test";
import assert from "node:assert/strict";
import { abbreviatedPartOfSpeech } from "../src/lib/vocabularyPos.js";

test("word entries keep English POS abbreviations and useful grammar notation", () => {
  for (const [input, expected] of [["v. [T/I]", "v. [T/I]"], ["n. [C/U]", "n. [C/U]"], ["名词短语 [C]", "n. phr. [C]"], ["动词短语", "v. phr."], ["adj. 最高级", "adj."], ["指代用语", "pron."], ["句型", "phr."], ["", ""]]) {
    assert.equal(abbreviatedPartOfSpeech(input), expected);
  }
});
