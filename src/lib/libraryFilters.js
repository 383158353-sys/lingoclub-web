// 推荐筛选和「收藏」文件夹。视频与文章共用，收藏夹是 favorited 的派生视图。
export const STATUS_FILTERS = [
  { key: "all", label: "全部" },
  { key: "unwatched", label: "未看" },
  { key: "favorites", label: "收藏" },
];

export const ALL_FOLDER = "all";
export const UNCATEGORIZED_FOLDER = "uncategorized";
export const FAVORITES_FOLDER = "favorites";

export function nextFavorited(item) {
  return !item?.favorited;
}

export function applyFavorite(items, id, favorited) {
  return (items || []).map((item) => (item.id === id ? { ...item, favorited } : item));
}

export function matchesStatusFilter(item, filter, seenField = "watched_at") {
  if (filter === "unwatched") return !item?.[seenField];
  if (filter === "favorites") return Boolean(item?.favorited);
  return true;
}

export function filterByStatus(items, filter, seenField = "watched_at") {
  return (items || []).filter((item) => matchesStatusFilter(item, filter, seenField));
}

export function libraryFolderCounts(items, folders) {
  const known = new Set((folders || []).map((folder) => folder.id));
  const counts = { uncategorized: 0, favorites: 0 };
  for (const item of items || []) {
    if (item?.favorited) counts.favorites += 1;
    if (item?.folder && known.has(item.folder)) counts[item.folder] = (counts[item.folder] || 0) + 1;
    else counts.uncategorized += 1;
  }
  return counts;
}

export function itemsInLibraryFolder(items, activeFolder, folders) {
  const list = items || [];
  if (!activeFolder || activeFolder === ALL_FOLDER) return list;
  if (activeFolder === FAVORITES_FOLDER) return list.filter((item) => item?.favorited);
  const known = new Set((folders || []).map((folder) => folder.id));
  if (activeFolder === UNCATEGORIZED_FOLDER) {
    return list.filter((item) => !item?.folder || !known.has(item.folder));
  }
  return list.filter((item) => item?.folder === activeFolder);
}
