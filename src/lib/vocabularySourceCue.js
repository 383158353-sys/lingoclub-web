import { toSec } from "./timecode.js";

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

function youtubeIdFromValue(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (YOUTUBE_ID.test(text)) return text;
  try {
    const raw = text.match(/https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&*+,;=%]+/i)?.[0] || text;
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0] || "";
      return YOUTUBE_ID.test(id) ? id : "";
    }
    if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtube-nocookie.com" || host.endsWith(".youtube-nocookie.com")) {
      const query = url.searchParams.get("v") || "";
      if (YOUTUBE_ID.test(query)) return query;
      const path = url.pathname.match(/\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/)?.[1] || "";
      return YOUTUBE_ID.test(path) ? path : "";
    }
  } catch { /* a local file name is not a YouTube id */ }
  return "";
}

/** Watch URL for an embedded one-cue recall. Any of video URL, source URL, or video id. */
export function youtubePlaybackUrl(...values) {
  for (const value of values) {
    const id = youtubeIdFromValue(value);
    if (id) return `https://www.youtube.com/watch?v=${id}`;
  }
  return "";
}

function cueText(cue) {
  return String(cue?.text_en || cue?.text || "").replace(/\s+/g, " ").trim();
}

/**
 * A YouTube favorite can be stored with only the sentence and timestamp
 * (Quick Study saves before the movie id and watch URL are attached).
 * Match that sentence against library movies that still have a YouTube id.
 * A local-file movie has no YouTube id, so it never matches.
 */
export function matchYouTubeSourceMovie(movies, source = {}) {
  const sentence = String(source?.source_sentence_en || source?.subtitle_snapshot?.text_en || "").replace(/\s+/g, " ").trim();
  if (sentence.length < 12) return null;
  const start = normalizeSourceCue(source).start;
  let best = null;
  for (const movie of Array.isArray(movies) ? movies : []) {
    const url = youtubePlaybackUrl(movie?.video_url, movie?.youtube_video_id);
    if (!url) continue;
    for (const cue of Array.isArray(movie?.subtitles) ? movie.subtitles : []) {
      const text = cueText(cue);
      if (text.length < 12) continue;
      const containsSaved = text.includes(sentence);
      const savedContainsCue = sentence.includes(text);
      if (!containsSaved && !savedContainsCue) continue;
      const cueStart = parseTime(cue?.time_start ?? cue?.start);
      const timeHit = Number.isFinite(start) && Number.isFinite(cueStart) && Math.abs(cueStart - start) <= 1.5;
      const score = (containsSaved ? 4 : 2) + (timeHit ? 2 : 0);
      if (!best || score > best.score) best = { movie, url, score };
    }
  }
  return best ? { movie: best.movie, url: best.url } : null;
}

function youtubeVideoIdFromUrl(url) {
  if (!url) return "";
  try { return new URL(url).searchParams.get("v") || ""; } catch { return ""; }
}

function recallQuery(source, subtitles, returnContext) {
  const cueData = resolveVocabularySourceCue(source, subtitles);
  const sourceStart = cueData.start ?? source?.source_time_start ?? source?.source_timestamp_seconds ?? source?.timestamp;
  const parsed = Number(sourceStart);
  const seconds = Math.max(0, Number.isFinite(parsed) ? parsed : toSec(sourceStart) || 0);
  const cue = source?.source_subtitle_id || cueData.id || "";
  const params = new URLSearchParams({ t: String(seconds) });
  if (cue) params.set("cue", cue);
  if (Number.isFinite(cueData.end)) params.set("cueEnd", String(cueData.end));
  params.set("closeReading", "1");
  params.set("returnContext", ["review", "mistakes", "collection"].includes(returnContext) ? returnContext : "collection");
  return { params, seconds, cue };
}

/** Where 打开原片 should go. YouTube favorites open the study embed; a missing local file stays on that movie. */
export function planVocabularyRecall(source = {}, { movie = null, movies = [], returnContext = "collection" } = {}) {
  if (!movie && source?.source_episode_id) {
    const { params } = recallQuery(source, [], returnContext);
    return { kind: "episode", href: `/episode/${encodeURIComponent(source.source_episode_id)}?${params}` };
  }
  const recovered = recoverYouTubeSource(source, movie, movies);
  const matched = movies.find((item) => item?.id && item.id === recovered.source_record_id) || null;
  const studyMovie = movie || matched;
  const subtitles = Array.isArray(studyMovie?.subtitles) ? studyMovie.subtitles : [];
  const { params, seconds, cue } = recallQuery(recovered, subtitles, returnContext);
  if (studyMovie?.id && (movie || youtubePlaybackUrl(studyMovie.video_url, studyMovie.youtube_video_id))) {
    params.set("open", studyMovie.id);
    return { kind: "local-study", href: `/local-study?${params}`, source: recovered };
  }
  const url = youtubePlaybackUrl(recovered.source_url, recovered.source_video_id);
  if (url) {
    const quick = new URLSearchParams({ url, t: String(seconds), closeReading: "1" });
    if (cue) quick.set("cue", cue);
    if (recovered.source_movie_title) quick.set("title", recovered.source_movie_title);
    return { kind: "quick-study", href: `/quick-study?${quick}`, source: recovered };
  }
  return { kind: "unavailable", message: "当前设备没有这部影片；原台词和时间戳仍保存在词条中。", source };
}

/** Fill a YouTube watch URL onto a favorite that was saved without one. Local-file movies stay untouched. */
export function recoverYouTubeSource(source = {}, movie = null, movies = []) {
  const fromLink = youtubePlaybackUrl(movie?.video_url, movie?.youtube_video_id, source?.source_url, source?.source_video_id);
  const linkedLocal = Boolean(movie) && !youtubePlaybackUrl(movie?.video_url, movie?.youtube_video_id);
  const sameVideo = !movie && fromLink
    ? (Array.isArray(movies) ? movies : []).find((item) => youtubePlaybackUrl(item?.video_url, item?.youtube_video_id) === fromLink) || null
    : null;
  const matched = fromLink || linkedLocal ? (sameVideo ? { movie: sameVideo, url: fromLink } : null) : matchYouTubeSourceMovie(movies, source);
  const url = fromLink || matched?.url || "";
  if (!url) return source;
  const found = matched?.movie || null;
  const keepType = ["article", "library_article", "episode"].includes(source?.source_type);
  const recordId = source?.source_record_id || (!linkedLocal && (movie?.id || found?.id)) || null;
  return {
    ...source,
    source_url: youtubePlaybackUrl(source?.source_url) ? source.source_url : url,
    source_video_id: source?.source_video_id || youtubeVideoIdFromUrl(url) || null,
    source_type: keepType ? source.source_type : "youtube",
    source_record_id: recordId,
    source_movie_id: source?.source_movie_id || recordId,
    source_movie_title: source?.source_movie_title || movie?.name || found?.name || null,
  };
}

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
  // Rolling ASR cues overlap, so a timestamp can sit inside an older line
  // and on the newer line that actually starts there. The later start is the
  // cue the card timestamp names (same rule as findCueAtTime).
  let containing = null;
  for (let index = 0; index < ordered.length; index += 1) {
    const item = ordered[index];
    const nextStart = ordered[index + 1]?.start ?? Infinity;
    const end = Number.isFinite(item.end) ? item.end : nextStart;
    if (normalized.start >= item.start - 0.05 && normalized.start <= end + 0.05) {
      if (!containing || item.start >= containing.start) containing = item;
    }
  }
  if (containing) return normalizeSourceCue(containing.cue);

  let nearest = null;
  for (const item of ordered) {
    if (!nearest || Math.abs(item.start - normalized.start) < Math.abs(nearest.start - normalized.start)) nearest = item;
  }
  if (nearest && Math.abs(nearest.start - normalized.start) <= 2) return normalizeSourceCue(nearest.cue);
  return normalized;
}
