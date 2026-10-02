import test from "node:test";
import assert from "node:assert/strict";
import { applySubtitleImport, cloneSubtitleCues, createLatestRequestGate, replaceEpisodeSubtitlesInList, subtitleEpisodeMismatch } from "../src/lib/localSubtitleWorkflow.js";

test("episode subtitle arrays stay bound to their own episode", () => {
  const imported = [
    { episode: "S02E05", movieId: "e05", cues: [{ id: "5-1", text_en: "THIS IS EPISODE FIVE" }] },
    { episode: "S02E06", movieId: "e06", cues: [{ id: "6-1", text_en: "THIS IS EPISODE SIX" }] },
  ].map((item) => ({ ...item, subtitles: cloneSubtitleCues(item.cues) }));
  const byId = new Map(imported.map((item) => [item.movieId, item.subtitles]));
  assert.equal(byId.get("e05")[0].text_en, "THIS IS EPISODE FIVE");
  assert.equal(byId.get("e06")[0].text_en, "THIS IS EPISODE SIX");
  assert.notEqual(byId.get("e05"), byId.get("e06"));
  assert.notEqual(byId.get("e05")[0], byId.get("e06")[0]);
});

test("replace import removes old cues and append import keeps both", () => {
  const old = [{ id: "a", text_en: "OLD A", order: 1 }];
  const incoming = [{ id: "b", text_en: "NEW B", order: 1 }];
  assert.deepEqual(applySubtitleImport(old, incoming, "replace").map((cue) => cue.text_en), ["NEW B"]);
  assert.deepEqual(applySubtitleImport(old, incoming, "append").map((cue) => cue.text_en), ["OLD A", "NEW B"]);
});

test("saving subtitles immediately refreshes the library meta snapshot", () => {
  const oldCues = [{ id: "old", text_en: "OLD" }];
  const newCues = [{ id: "new", text_en: "LATEST" }];
  const updated = replaceEpisodeSubtitlesInList([{ id: "e06", subtitles: oldCues }, { id: "e05", subtitles: [] }], "e06", newCues, { subtitle_source_name: "Hacks.S02E06.srt" });
  assert.equal(updated[0].subtitles[0].text_en, "LATEST");
  assert.equal(updated[0].subtitle_source_name, "Hacks.S02E06.srt");
  assert.equal(updated[0].subtitle_count, 1);
  assert.equal(updated[1].subtitles.length, 0);
});

test("episode mismatch is reported, but unidentified filenames remain allowed", () => {
  assert.equal(subtitleEpisodeMismatch({ seasonNumber: 2, episodeNumber: 6 }, "Hacks.S02E06.srt"), null);
  assert.deepEqual(subtitleEpisodeMismatch({ seasonNumber: 2, episodeNumber: 6 }, "Hacks.S02E05.srt")?.parsed, { seasonNumber: 2, episodeNumber: 5 });
  assert.equal(subtitleEpisodeMismatch({ seasonNumber: 2, episodeNumber: 6 }, "captions-final.srt"), null);
  assert.equal(subtitleEpisodeMismatch({ seasonNumber: 2, episodeNumber: 7 }, "Hacks.S02E07.srt"), null);
  assert.equal(subtitleEpisodeMismatch({}, "Hacks.S02E07.srt"), null);
});

test("latest episode open wins when earlier file access resolves later", async () => {
  const gate = createLatestRequestGate();
  let opened = "";
  const slowOpen = (id, delay) => {
    const request = gate.begin();
    return new Promise((resolve) => setTimeout(resolve, delay)).then(() => {
      if (gate.isCurrent(request)) opened = id;
    });
  };
  const e05 = slowOpen("E05", 30);
  await new Promise((resolve) => setTimeout(resolve, 1));
  const e06 = slowOpen("E06", 1);
  await Promise.all([e05, e06]);
  assert.equal(opened, "E06");
});
