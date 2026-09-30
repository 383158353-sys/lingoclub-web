import test from "node:test";
import assert from "node:assert/strict";
import { lightweightCloudState, safeMovie } from "../src/lib/localCloudPayload.js";

test("cloud local-library payload keeps metadata while excluding heavy media and subtitle data", () => {
  const state = lightweightCloudState({
    movies: [{
      id: "episode-1",
      name: "S01E01",
      media_type: "episode",
      folder: "season-1",
      season_number: 1,
      episode_number: 1,
      poster_id: "episode-1",
      subtitles: [{ text_en: "large subtitle text", cue: { start: 0 } }],
      subtitle_text: "full SRT payload",
      video_blob: new Blob(["video"]),
      video_url: "blob:local-video",
      poster_url: "data:image/png;base64,VERY_LARGE",
      poster_blob: new Blob(["poster"]),
      videoHandle: { kind: "file", name: "must-stay-local" },
      directoryHandle: { kind: "directory", name: "must-stay-local" },
      subtitleDirectoryHandle: { kind: "directory", name: "must-stay-local" },
      learning_progress: { lastCue: 8 },
    }],
    folders: [{
      id: "season-1", name: "Hacks 第一季", tab_type: "films", project_type: "season",
      episodeIds: ["episode-1"], cover_id: "season-1", cover_url: "data:image/png;base64,HUGE",
      cover_blob: new Blob(["cover"]),
    }],
  });
  const [movie] = state.movies;
  assert.equal(movie.name, "S01E01");
  assert.equal(movie.subtitle_id, "episode-1");
  assert.equal(movie.subtitle_count, 1);
  assert.equal(movie.learning_progress.lastCue, 8);
  assert.equal(movie.video_url, "");
  for (const key of ["subtitles", "subtitle_text", "video_blob", "poster_blob", "videoHandle", "directoryHandle", "subtitleDirectoryHandle"]) assert.equal(key in movie, false);
  assert.ok(!String(movie.poster_url || "").startsWith("data:image/"));
  assert.deepEqual(state.folders[0].episodeIds, ["episode-1"]);
  assert.equal(state.folders[0].cover_id, "season-1");
  assert.ok(!String(state.folders[0].cover_url || "").startsWith("data:image/"));
  assert.equal("cover_blob" in state.folders[0], false);
});

test("local subtitle data remains available during migration/hydration, and YouTube records stay unchanged", () => {
  const local = safeMovie({ id: "local-1", subtitles: [{ text_en: "kept locally" }] }, { dropLocalSubtitles: false });
  assert.deepEqual(local.subtitles, [{ text_en: "kept locally" }]);
  const youtube = safeMovie({
    id: "youtube-1", video_url: "https://www.youtube.com/watch?v=abcdefghijk",
    subtitles: [{ text_en: "YouTube subtitle" }], poster_url: "https://img.youtube.com/poster.jpg",
  }, { dropLocalSubtitles: true });
  assert.equal(youtube.subtitles.length, 1);
  assert.equal(youtube.poster_url, "https://img.youtube.com/poster.jpg");
});
