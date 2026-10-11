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

test("a day's recommendations are split into 今日主学 first, then sections by first tag", async () => {
  const { groupRecommendationsBySection } = await import("../src/lib/dailyRecommendationsFormat.js");
  const sections = groupRecommendationsBySection([
    { id: 1, tags: ["脱口秀", "comedy"] },
    { id: 2, tags: ["AI与科技"] },
    { id: 3, tags: ["AI与科技", "今日主学"] },
    { id: 4, tags: [] },
    { id: 5, tags: ["脱口秀"] },
    { id: 6 },
    { id: 7, tags: ["今日主学", "影视幕后"] },
  ]);
  assert.deepEqual(sections.map((s) => [s.name, s.main, s.items.map((i) => i.id)]), [
    ["今日主学", true, [3, 7]],
    ["脱口秀", false, [1, 5]],
    ["AI与科技", false, [2]],
    ["其他", false, [4, 6]],
  ]);
  assert.deepEqual(groupRecommendationsBySection([{ id: 1, tags: ["游戏美术"] }]).map((s) => s.name), ["游戏美术"]);
});
