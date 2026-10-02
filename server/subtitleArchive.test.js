import test from "node:test";
import assert from "node:assert/strict";
import { decodeSubtitleArchive, encodeSubtitleArchive } from "../src/lib/subtitleArchive.js";

test("subtitle archive round-trips cue data and compresses repeated text", async () => {
  const source = {
    subtitles: Array.from({ length: 200 }, (_, index) => ({ id: index, start: index, text_en: "repeated subtitle line for compression" })),
    subtitle_text: "repeated subtitle line\n".repeat(200),
  };
  const archive = await encodeSubtitleArchive(source);
  assert.deepEqual(await decodeSubtitleArchive(archive), source);
  assert.equal(archive.encoding, "gzip-base64");
  assert.ok(archive.data.length < JSON.stringify(source).length / 2);
});

test("subtitle archive reads the database trigger's JSON compatibility format", async () => {
  const source = { subtitles: [{ id: "cue-1", text_en: "kept" }], subtitle_text: null };
  assert.deepEqual(await decodeSubtitleArchive({ encoding: "json", data: source }), source);
});
