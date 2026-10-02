import { parseEpisodeNumber } from "./localSeason.js";

export function applySubtitleImport(existing, incoming, mode = "replace") {
  const base = mode === "append" ? (existing || []).map((cue) => ({ ...cue })) : [];
  const startOrder = base.reduce((max, cue) => Math.max(max, Number(cue.order) || 0), 0);
  const next = (incoming || []).map((cue, index) => ({ ...cue, order: startOrder + index + 1 }));
  return [...base, ...next];
}

export function subtitleEpisodeMismatch(target, fileName) {
  const parsed = parseEpisodeNumber(fileName);
  const episodeNumber = Number(target?.episodeNumber);
  const seasonNumber = Number(target?.seasonNumber);
  if (!parsed || !Number.isInteger(episodeNumber) || episodeNumber < 1) return null;
  if (parsed.episodeNumber === episodeNumber && (parsed.seasonNumber == null || !Number.isInteger(seasonNumber) || seasonNumber < 1 || parsed.seasonNumber === seasonNumber)) return null;
  return { parsed, episodeNumber, seasonNumber: Number.isInteger(seasonNumber) && seasonNumber > 0 ? seasonNumber : parsed.seasonNumber };
}

export function cloneSubtitleCues(cues) {
  return (Array.isArray(cues) ? cues : []).map((cue) => ({ ...cue }));
}

export function replaceEpisodeSubtitlesInList(metas, id, subtitles, metadata = {}) {
  return (metas || []).map((meta) => meta.id === id
    ? { ...meta, ...metadata, subtitles: cloneSubtitleCues(subtitles), subtitle_count: subtitles?.length || 0 }
    : meta);
}

export function createLatestRequestGate() {
  let sequence = 0;
  return {
    begin() { sequence += 1; return sequence; },
    isCurrent(requestId) { return requestId === sequence; },
  };
}
