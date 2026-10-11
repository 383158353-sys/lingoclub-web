import test from "node:test";
import assert from "node:assert/strict";
import { cleanVideoTitle, needsTitleCleanup, isPlaceholderVideoTitle } from "../src/lib/videoTitle.js";
import { sortLibraryItems } from "../src/lib/librarySort.js";
import { titleFromWatchHtml } from "./youtubeMeta.js";

test("cleanVideoTitle strips YouTube notification counter and suffix", () => {
  assert.equal(cleanVideoTitle("(5) Jimmy O. Yang's Best Dad Stories"), "Jimmy O. Yang's Best Dad Stories");
  assert.equal(cleanVideoTitle("(3) The Future Mark Zuckerberg Is Trying To Build - YouTube"), "The Future Mark Zuckerberg Is Trying To Build");
  assert.equal(cleanVideoTitle("(99+) Title"), "Title");
  assert.equal(cleanVideoTitle("  Learn How to Think In English ( Stop Translating in Your Head )  "), "Learn How to Think In English ( Stop Translating in Your Head )");
  assert.equal(cleanVideoTitle("(2024) Year in review"), "(2024) Year in review");
  assert.equal(cleanVideoTitle("Song (5) live"), "Song (5) live");
  assert.equal(cleanVideoTitle(null), "");
  assert.equal(needsTitleCleanup("(5) A"), true);
  assert.equal(needsTitleCleanup("A"), false);
  assert.equal(isPlaceholderVideoTitle("YouTube 视频"), true);
});

test("watch page <title> fallback is cleaned", () => {
  assert.equal(titleFromWatchHtml("<html><title>(5) Doing Tai Chi - YouTube</title></html>"), "Doing Tai Chi");
});

test("我的视频 ordering: newest import first, re-import moves to top, manual order kept", () => {
  const items = [
    { id: "old", created_date: "2026-09-27T00:00:00Z" },
    { id: "mid", created_date: "2026-10-03T00:00:00Z" },
    { id: "new", created_date: "2026-10-11T10:29:00Z", imported_at: "2026-10-11T10:29:00Z" },
    { id: "reimported", created_date: "2026-09-01T00:00:00Z", imported_at: "2026-10-11T11:00:00Z" },
  ];
  assert.deepEqual(sortLibraryItems(items).map((i) => i.id), ["reimported", "new", "mid", "old"]);
  const manual = [
    { id: "b", sort_order: 20, created_date: "2026-10-01T00:00:00Z" },
    { id: "a", sort_order: 10, created_date: "2026-09-01T00:00:00Z" },
    { id: "fresh", sort_order: null, imported_at: "2026-10-11T00:00:00Z" },
  ];
  assert.deepEqual(sortLibraryItems(manual).map((i) => i.id), ["fresh", "a", "b"]);
});
