function recordKey(item, type) {
  if (item?.id) return `${type}:id:${item.id}`;
  if (type === "vocab") return `${type}:expression:${String(item?.expression_en || item?.text_en || "").trim().toLowerCase()}`;
  if (type === "movies") return `${type}:title:${String(item?.original_title || item?.name || "").trim().toLowerCase()}`;
  return `${type}:name:${String(item?.name || "").trim().toLowerCase()}`;
}

function clone(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
}

function movieVideoId(item) {
  if (item?.youtube_video_id) return String(item.youtube_video_id);
  try {
    const url = new URL(String(item?.video_url || ""));
    const host = url.hostname.toLowerCase();
    const candidate = host === "youtu.be"
      ? url.pathname.slice(1).split("/")[0]
      : url.searchParams.get("v") || url.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})(?:[/?]|$)/)?.[1];
    return /^[A-Za-z0-9_-]{11}$/.test(candidate || "") ? candidate : null;
  } catch {
    return null;
  }
}

export function mergeTombstones(local = [], remote = []) {
  const latest = new Map();
  for (const item of [...(remote || []), ...(local || [])]) {
    if (!item?.id || !item?.type || !item?.deletedAt) continue;
    const key = `${item.type}:${item.id}`;
    const previous = latest.get(key);
    if (!previous || (Date.parse(item.deletedAt) || 0) > (Date.parse(previous.deletedAt) || 0)) latest.set(key, clone(item));
  }
  return [...latest.values()].filter(Boolean);
}

export function mergeRecords(local = [], remote = [], type, tombstones = []) {
  const result = new Map((remote || []).map((item) => [recordKey(item, type), clone(item)]));
  for (const item of local || []) {
    const key = recordKey(item, type);
    const previous = result.get(key);
    const localTime = Date.parse(item?.updated_date || item?.created_date || 0) || 0;
    const remoteTime = Date.parse(previous?.updated_date || previous?.created_date || 0) || 0;
    result.set(key, !previous || localTime >= remoteTime ? clone(item) : previous);
  }
  const deleted = new Map((tombstones || []).filter((item) => item.type === type).map((item) => [item.id, Date.parse(item.deletedAt) || 0]));
  const deletedMovieIds = type === "movies"
    ? new Map((tombstones || []).filter((item) => item.type === type && item.videoId).map((item) => [String(item.videoId), Date.parse(item.deletedAt) || 0]))
    : new Map();
  return [...result.values()].filter((item) => {
    if (!item) return false;
    const deletedAt = Math.max(deleted.get(item.id) || 0, deletedMovieIds.get(movieVideoId(item)) || 0);
    if (!deletedAt) return true;
    const itemUpdatedAt = Date.parse(item.updated_date || item.created_date || 0) || 0;
    return itemUpdatedAt > deletedAt;
  });
}
