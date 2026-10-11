// Pure helpers for the 今日推荐 page (no browser or Supabase dependencies).

export const RECOMMENDATION_SOURCE_LABELS = {
  digest: "综合简报",
  morning_read: "英语晨读",
};

export function youtubeThumbnail(youtubeId) {
  return `https://i.ytimg.com/vi/${encodeURIComponent(youtubeId)}/mqdefault.jpg`;
}

export function formatDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "";
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const rest = Math.floor(value % 60);
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function quickStudyPath(item) {
  const params = new URLSearchParams({ url: item.url || `https://www.youtube.com/watch?v=${item.youtube_id}`, title: item.title || "" });
  return `/quick-study?${params.toString()}`;
}

// Groups rows by rec_date, newest first; `today` (YYYY-MM-DD) is always first when present.
export function groupRecommendationsByDate(items, today) {
  const groups = new Map();
  for (const item of items || []) {
    if (!groups.has(item.rec_date)) groups.set(item.rec_date, []);
    groups.get(item.rec_date).push(item);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === today ? -1 : b === today ? 1 : b.localeCompare(a)))
    .map(([date, rows]) => ({ date, items: rows }));
}

export const MAIN_STUDY_TAG = "今日主学";
export const OTHER_SECTION = "其他";

// Split one day's items into sections: items tagged 今日主学 come first, then
// sections named by each item's first non-今日主学 tag (the 板块 name), in the
// order they first appear. Items without such a tag go to 其他.
export function groupRecommendationsBySection(items) {
  const main = [];
  const sections = new Map();
  for (const item of items || []) {
    const tags = Array.isArray(item.tags) ? item.tags : [];
    if (tags.includes(MAIN_STUDY_TAG)) { main.push(item); continue; }
    const name = tags.find((tag) => tag && tag !== MAIN_STUDY_TAG) || OTHER_SECTION;
    if (!sections.has(name)) sections.set(name, []);
    sections.get(name).push(item);
  }
  const rest = [...sections].map(([name, list]) => ({ name, main: false, items: list }));
  return main.length ? [{ name: MAIN_STUDY_TAG, main: true, items: main }, ...rest] : rest;
}
