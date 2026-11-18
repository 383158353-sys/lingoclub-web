import test from "node:test";
import assert from "node:assert/strict";
import { isCloseReadingKey } from "../src/hooks/useGlobalVideoSpace.js";

const key = (code, modifiers = {}) => ({ code, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...modifiers });

test("the right arrow on its own is the close-reading key", () => {
  assert.equal(isCloseReadingKey(key("ArrowRight")), true);
});

test("other arrows and space keep their own jobs", () => {
  for (const code of ["ArrowLeft", "ArrowUp", "ArrowDown", "Space"]) {
    assert.equal(isCloseReadingKey(key(code)), false, code);
  }
});

test("browser and system chords with the right arrow are left alone", () => {
  for (const modifier of ["altKey", "ctrlKey", "metaKey", "shiftKey"]) {
    assert.equal(isCloseReadingKey(key("ArrowRight", { [modifier]: true })), false, modifier);
  }
});
