import { articlePath } from "./dailyArticlesFormat.js";

export function studyArticleRecord(row, origin) {
  const id = row?.id;
  return {
    ...row,
    id,
    key: `${origin}:${id}`,
    origin,
    folder: row?.folder || "",
    favorited: Boolean(row?.favorited),
    href: origin === "library" ? `/library-articles/${encodeURIComponent(id)}` : articlePath(id),
  };
}

export function mergeStudyArticles(libraryRows = [], dailyRows = []) {
  return [
    ...(libraryRows || []).map((row) => studyArticleRecord(row, "library")),
    ...(dailyRows || []).map((row) => studyArticleRecord(row, "daily")),
  ].sort((a, b) => String(b.created_at || b.rec_date || "").localeCompare(String(a.created_at || a.rec_date || "")));
}
