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
