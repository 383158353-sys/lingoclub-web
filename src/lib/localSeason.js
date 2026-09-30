export function parseEpisodeNumber(value) {
  const name = String(value || "").replace(/\.[^.]+$/, "");
  const match = name.match(/(?:^|[^a-z0-9])s(\d{1,2})[ ._-]*e(\d{1,3})(?:[^0-9]|$)/i)
    || name.match(/(?:^|[^0-9])(\d{1,2})x(\d{1,3})(?:[^0-9]|$)/i);
  if (match) return { seasonNumber: Number(match[1]), episodeNumber: Number(match[2]) };
  const episode = name.match(/(?:^|[^a-z0-9])(?:episode|ep)[ ._-]*(\d{1,3})(?:[^0-9]|$)/i);
  return episode ? { seasonNumber: null, episodeNumber: Number(episode[1]) } : null;
}

export function formatSeasonTitle(showTitle, seasonNumber) {
  const number = Number(seasonNumber);
  const safeNumber = Number.isFinite(number) && number > 0 ? Math.floor(number) : 1;
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const chineseNumber = safeNumber < 10
    ? digits[safeNumber]
    : safeNumber === 10
      ? "十"
      : safeNumber < 20
        ? `十${digits[safeNumber % 10]}`
        : `${digits[Math.floor(safeNumber / 10)]}十${safeNumber % 10 ? digits[safeNumber % 10] : ""}`;
  return `${String(showTitle || "未命名剧集").trim()} 第${chineseNumber}季`;
}

export function formatEpisodeCode(seasonNumber, episodeNumber) {
  const season = Number(seasonNumber) || 1;
  const episode = Number(episodeNumber) || 1;
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

export function buildSeasonEpisodeRows(videoEntries, subtitleEntries, seasonNumber) {
  return videoEntries.map(({ id, file }, index) => {
    const detected = parseEpisodeNumber(file?.name);
    const episodeNumber = detected?.episodeNumber || index + 1;
    const matchingSubtitle = subtitleEntries.find(({ file: subtitle }) => {
      const parsed = parseEpisodeNumber(subtitle?.name);
      return parsed?.episodeNumber === episodeNumber
        && (detected?.seasonNumber == null || parsed.seasonNumber == null || detected.seasonNumber === parsed.seasonNumber);
    });
    return { key: id, videoFile: file, episodeNumber, subtitleId: matchingSubtitle?.id || "", title: "" };
  });
}

export function resolveSeasonSubtitle(subtitleEntries, subtitleId) {
  if (!subtitleId) return null;
  return subtitleEntries.find((entry) => entry.id === subtitleId)?.file || null;
}

const VIDEO_FILE = /\.(mp4|webm|mov|m4v|mkv|avi)$/i;
const SUBTITLE_FILE = /\.(srt|vtt|txt)$/i;

// Shared by file-picker and drag/drop input so both paths use identical filtering.
export function normalizeSeasonFiles(fileList, type) {
  const files = Array.from(fileList || []);
  const matcher = type === "video" ? VIDEO_FILE : SUBTITLE_FILE;
  const opposite = type === "video" ? SUBTITLE_FILE : VIDEO_FILE;
  return {
    accepted: files.filter((file) => matcher.test(file.name || "")),
    wrongKind: files.filter((file) => !matcher.test(file.name || "") && opposite.test(file.name || "")),
    unsupported: files.filter((file) => !matcher.test(file.name || "") && !opposite.test(file.name || "")),
  };
}
