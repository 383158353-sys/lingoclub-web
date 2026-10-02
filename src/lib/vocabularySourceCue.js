import { toSec } from "./timecode.js";

function cueStart(cue) {
  return parseTime(cue?.time_start);
}

function cueEnd(cue) {
  return parseTime(cue?.time_end);
}

function parseTime(value) {
  if (value == null || value === "") return NaN;
  const number = Number(value);
  return Number.isFinite(number) ? number : toSec(value);
}

export function normalizeSourceCue(value = {}) {
  const startValue = value.start ?? value.time_start ?? value.source_time_start ?? value.source_timestamp_seconds ?? value.timestamp;
  const endValue = value.end ?? value.time_end ?? value.source_time_end ?? value.source_timestamp_end_seconds;
  const start = parseTime(startValue);
  const end = parseTime(endValue);
  return {
    id: value.id || value.subtitle_id || value.source_subtitle_id || null,
    start: Number.isFinite(start) ? start : null,
    end: Number.isFinite(end) && (!Number.isFinite(start) || end > start) ? end : null,
    textEn: String(value.textEn ?? value.text_en ?? value.source_sentence_en ?? ""),
    textZh: String(value.textZh ?? value.text_zh ?? value.source_sentence_zh ?? ""),
  };
}

/** Resolve an old timestamp-only source to the complete subtitle cue when possible. */
export function resolveVocabularySourceCue(source = {}, subtitles = []) {
  const normalized = normalizeSourceCue({
    ...source,
    start: source.source_time_start ?? source.source_timestamp_seconds ?? source.timestamp ?? source.source_timestamp_text,
    end: source.source_time_end ?? source.source_timestamp_end_seconds,
    textEn: source.source_sentence_en || source.subtitle_snapshot?.text_en,
    textZh: source.source_sentence_zh || source.subtitle_snapshot?.text_zh,
  });
  if (normalized.id) {
    const exact = subtitles.find((cue) => String(cue?.id) === String(normalized.id));
    if (exact) return normalizeSourceCue(exact);
  }
  if (!Number.isFinite(normalized.start) || !Array.isArray(subtitles) || !subtitles.length) return normalized;

  const ordered = subtitles
    .map((cue, index) => ({ cue, index, start: cueStart(cue), end: cueEnd(cue) }))
    .filter((item) => Number.isFinite(item.start))
    .sort((a, b) => a.start - b.start || a.index - b.index);
  const containing = ordered.find((item, index) => {
    const nextStart = ordered[index + 1]?.start ?? Infinity;
    const end = Number.isFinite(item.end) ? item.end : nextStart;
    return normalized.start >= item.start - 0.05 && normalized.start <= end + 0.05;
  });
  if (containing) return normalizeSourceCue(containing.cue);

  let nearest = null;
  for (const item of ordered) {
    if (!nearest || Math.abs(item.start - normalized.start) < Math.abs(nearest.start - normalized.start)) nearest = item;
  }
  if (nearest && Math.abs(nearest.start - normalized.start) <= 2) return normalizeSourceCue(nearest.cue);
  return normalized;
}
