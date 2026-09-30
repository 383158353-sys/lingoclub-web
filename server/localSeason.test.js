import test from "node:test";
import assert from "node:assert/strict";
import { buildSeasonEpisodeRows, normalizeSeasonFiles, resolveSeasonSubtitle } from "../src/lib/localSeason.js";

const files = (names) => names.map((name) => ({ name }));

test("picker and drop use the same filters and retain accepted files while reporting wrong file types", () => {
  const video = normalizeSeasonFiles(files(["E01.mp4", "E02.mkv", "E01.srt", "notes.pdf"]), "video");
  assert.deepEqual(video.accepted.map((file) => file.name), ["E01.mp4", "E02.mkv"]);
  assert.deepEqual(video.wrongKind.map((file) => file.name), ["E01.srt"]);
  assert.deepEqual(video.unsupported.map((file) => file.name), ["notes.pdf"]);
  const subtitle = normalizeSeasonFiles(files(["E01.srt", "E02.vtt", "E03.mp4"]), "subtitle");
  assert.deepEqual(subtitle.accepted.map((file) => file.name), ["E01.srt", "E02.vtt"]);
  assert.deepEqual(subtitle.wrongKind.map((file) => file.name), ["E03.mp4"]);
});

test("episodes are explicitly paired with matching subtitle IDs independent of list order", () => {
  const videos = files(["Hacks.S02E02.mp4", "Hacks.S02E01.mp4"]).map((file, index) => ({ id: "v" + index, file }));
  const subtitles = files(["Hacks.S02E01.srt", "Hacks.S02E02.srt"]).map((file, index) => ({ id: "s" + index, file }));
  const rows = buildSeasonEpisodeRows(videos, subtitles, 2);
  assert.deepEqual(rows.map((row) => [row.episodeNumber, row.subtitleId]), [[2, "s1"], [1, "s0"]]);
  assert.equal(resolveSeasonSubtitle(subtitles, rows[0].subtitleId).name, "Hacks.S02E02.srt");
});
