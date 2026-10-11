// Pure helpers for YouTube video titles (shared by browser code, server code and tests).

const PLACEHOLDER_TITLES = new Set(["", "youtube 视频", "快速导入视频", "未命名影片", "youtube video"]);

// Strip artefacts of the browser tab title: YouTube's unread-notification
// counter "(5) " at the start and " - YouTube" at the end.
export function cleanVideoTitle(title) {
  let value = String(title ?? "").replace(/\s+/g, " ").trim();
  let previous;
  do {
    previous = value;
    value = value.replace(/^\(\d{1,3}\+?\)\s+/, "").replace(/\s*[-–—]\s*YouTube\s*$/i, "").trim();
  } while (value !== previous);
  return value;
}

export function needsTitleCleanup(title) {
  const value = String(title ?? "");
  return Boolean(value) && cleanVideoTitle(value) !== value.trim();
}

// True when a stored title is one of the import fallbacks rather than a real title.
export function isPlaceholderVideoTitle(title, videoUrl = "") {
  const value = String(title || "").trim();
  if (PLACEHOLDER_TITLES.has(value.toLowerCase())) return true;
  if (videoUrl && value === String(videoUrl).trim()) return true;
  return /^https?:\/\//i.test(value);
}
