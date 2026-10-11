import assert from "node:assert/strict";
import test from "node:test";
import { formatDuration, groupRecommendationsByDate, quickStudyPath, youtubeThumbnail } from "../src/lib/dailyRecommendationsFormat.js";

test("recommendations are grouped by date with today first", () => {
  const groups = groupRecommendationsByDate([
    { id: 1, rec_date: "2026-10-09" },
    { id: 2, rec_date: "2026-10-12" },
    { id: 3, rec_date: "2026-10-11" },
    { id: 4, rec_date: "2026-10-09" },
  ], "2026-10-11");
  assert.deepEqual(groups.map((group) => group.date), ["2026-10-11", "2026-10-12", "2026-10-09"]);
  assert.deepEqual(groups[2].items.map((item) => item.id), [1, 4]);
});

test("quick study path keeps the existing /quick-study url and title contract", () => {
  const path = quickStudyPath({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "A & B" });
  const params = new URL(path, "https://app.test").searchParams;
  assert.equal(new URL(path, "https://app.test").pathname, "/quick-study");
  assert.equal(params.get("url"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(params.get("title"), "A & B");
});

test("duration and thumbnail helpers", () => {
  assert.equal(formatDuration(212), "3:32");
  assert.equal(formatDuration(3725), "1:02:05");
  assert.equal(formatDuration(null), "");
  assert.equal(youtubeThumbnail("dQw4w9WgXcQ"), "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg");
});
