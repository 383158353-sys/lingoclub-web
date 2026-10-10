import test from "node:test";
import assert from "node:assert/strict";
import { mergeRecords, mergeTombstones } from "../src/lib/cloudDeletion.js";

test("a deletion tombstone prevents an older cloud movie from reappearing", () => {
  const deletedAt = "2026-09-30T10:00:00.000Z";
  const remote = [{ id: "yt-1", name: "YouTube entry", updated_date: "2026-09-29T10:00:00.000Z" }];
  const tombstones = [{ id: "yt-1", type: "movies", deletedAt }];
  assert.deepEqual(mergeRecords([], remote, "movies", tombstones), []);
});

test("a deliberate newer re-import survives an older tombstone", () => {
  const remote = [{ id: "movie-1", name: "Reimported", updated_date: "2026-09-30T10:00:01.000Z" }];
  const tombstones = [{ id: "movie-1", type: "movies", deletedAt: "2026-09-30T10:00:00.000Z" }];
  assert.equal(mergeRecords(remote, [], "movies", tombstones)[0].name, "Reimported");
});

test("a deleted YouTube video stays hidden if a stale merge gives it a new local id", () => {
  const remote = [{ id: "new-id", youtube_video_id: "abc123xyz89", video_url: "https://youtu.be/abc123xyz89", name: "Old remote copy", updated_date: "2026-09-29T10:00:00.000Z" }];
  const tombstones = [{ id: "old-id", type: "movies", videoId: "abc123xyz89", deletedAt: "2026-09-30T10:00:00.000Z" }];
  assert.deepEqual(mergeRecords([], remote, "movies", tombstones), []);
});

test("the newest tombstone from either device wins", () => {
  const merged = mergeTombstones(
    [{ id: "ep-2", type: "movies", deletedAt: "2026-09-29T12:00:00.000Z" }],
    [{ id: "ep-2", type: "movies", deletedAt: "2026-09-30T12:00:00.000Z" }],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].deletedAt, "2026-09-30T12:00:00.000Z");
});
