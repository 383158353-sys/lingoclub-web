// Whole-track subtitle shift. Cue timestamps stay as imported.
// Positive offsetMs delays every cue (subtitles appear later).
// Negative offsetMs advances every cue (subtitles appear earlier).

import { toSec } from "./timecode.js";
import { getActiveStorageUser, scopedStorageKey } from "./userStorage.js";

export const SUBTITLE_OFFSET_STORAGE_KEY = "lingoclub_subtitle_offset_v1";
export const SUBTITLE_OFFSET_LIMIT_MS = 3 * 60 * 60 * 1000;
export const SUBTITLE_OFFSET_STEPS_MS = [1000, 500, 100];

export function clampSubtitleOffsetMs(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms)) return 0;
  const rounded = Math.round(ms);
  return Math.max(-SUBTITLE_OFFSET_LIMIT_MS, Math.min(SUBTITLE_OFFSET_LIMIT_MS, rounded));
}

export function offsetSeconds(offsetMs) {
  return clampSubtitleOffsetMs(offsetMs) / 1000;
}

// Video clock -> original cue clock. A +1.2s delay means the cue at T plays at video T+1.2.
export function subtitleLookupTime(videoTime, offsetMs = 0) {
  const time = Number(videoTime);
  if (!Number.isFinite(time)) return videoTime;
  const delta = offsetSeconds(offsetMs);
  if (!delta) return time;
  return time - delta;
}

// Original cue time -> video seek target.
export function shiftPlaybackSeconds(seconds, offsetMs = 0) {
  if (!Number.isFinite(seconds)) return seconds;
  const delta = offsetSeconds(offsetMs);
  if (!delta) return seconds;
  return Math.max(0, seconds + delta);
}

export function shiftLoopRange(range, offsetMs = 0) {
  if (!range || !Number.isFinite(range.start)) return range;
  const delta = offsetSeconds(offsetMs);
  if (!delta) return range;
  const start = Math.max(0, range.start + delta);
  const end = Math.max(start + 0.01, (Number.isFinite(range.end) ? range.end : range.start) + delta);
  return { start, end };
}

// Same rule as the local-study playhead highlight: latest cue whose start <= lookup time.
export function activeCueForLocalStudy(subtitles, videoTime, offsetMs = 0) {
  if (videoTime == null || !Array.isArray(subtitles) || subtitles.length === 0) return null;
  const t = subtitleLookupTime(videoTime, offsetMs);
  if (!Number.isFinite(t)) return null;
  let best = null;
  for (const cue of subtitles) {
    const start = toSec(cue?.time_start);
    if (Number.isNaN(start)) continue;
    if (start <= t && (!best || start > toSec(best.time_start))) best = cue;
  }
  return best;
}

export function formatSubtitleOffset(offsetMs) {
  const ms = clampSubtitleOffsetMs(offsetMs);
  if (ms === 0) return "0.0s";
  const sign = ms > 0 ? "+" : "-";
  const rounded = Math.round((Math.abs(ms) / 1000) * 1000) / 1000;
  let text = rounded.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  if (!text.includes(".")) text += ".0";
  return `${sign}${text}s`;
}

export function formatOffsetInputSeconds(offsetMs) {
  const seconds = clampSubtitleOffsetMs(offsetMs) / 1000;
  if (seconds === 0) return "0";
  return String(Math.round(seconds * 1000) / 1000);
}

// Seconds by default. "800ms" / "800毫秒" are milliseconds. "+1.2s" is seconds.
export function parseSubtitleOffsetInput(input) {
  const text = String(input ?? "")
    .trim()
    .replace(/＋/g, "+")
    .replace(/－/g, "-")
    .replace(/。/g, ".");
  if (!text) return null;
  const match = text.match(/^([+-]?\d+(?:\.\d+)?)(?:\s*(ms|毫秒|s|秒))?$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = String(match[2] || "s").toLowerCase();
  const ms = unit === "ms" || unit === "毫秒" ? amount : amount * 1000;
  return clampSubtitleOffsetMs(ms);
}

export function nudgeSubtitleOffsetMs(offsetMs, deltaMs) {
  return clampSubtitleOffsetMs(clampSubtitleOffsetMs(offsetMs) + Number(deltaMs));
}

// Snap one original cue start onto the frame where that line is actually spoken.
// offsetMs = videoTime - cueStart. Positive delays every cue; negative advances them.
export function alignSubtitleOffsetMs(videoTimeSec, cueStartSec) {
  const video = Number(videoTimeSec);
  const cue = Number(cueStartSec);
  if (!Number.isFinite(video) || !Number.isFinite(cue)) return null;
  return clampSubtitleOffsetMs((video - cue) * 1000);
}

// While a short preview is playing, keep later nudges on the frame the user parked.
// A jump larger than the preview window means they scrubbed to a new spot.
export const SUBTITLE_OFFSET_PREVIEW_WINDOW_SEC = 2.5;

export function snapSampleTime(live, parked, windowSec = SUBTITLE_OFFSET_PREVIEW_WINDOW_SEC) {
  const time = Number(live);
  if (!Number.isFinite(time)) return null;
  const parkedTime = Number(parked);
  if (!Number.isFinite(parkedTime)) return time;
  if (Math.abs(time - parkedTime) > windowSec) return time;
  return parkedTime;
}

// Short listen after an offset change: the whole cue when it is this short, otherwise this many seconds from the cue start.
export const SUBTITLE_OFFSET_PREVIEW_MAX_SEC = 2;

export function cueOriginalStartSeconds(cue) {
  const start = toSec(cue?.time_start ?? cue?.startSec);
  return Number.isFinite(start) ? start : null;
}

// The line that should be heard for this offset. The snap anchor wins.
// Otherwise the cue on screen at videoTime, then the nearest timed cue.
export function cueForOffsetPreview(subtitles, videoTime, offsetMs, preferredCue) {
  if (preferredCue && cueOriginalStartSeconds(preferredCue) != null) return preferredCue;
  const list = Array.isArray(subtitles) ? subtitles : [];
  const active = activeCueForLocalStudy(list, videoTime, offsetMs);
  if (active) return active;
  const lookup = subtitleLookupTime(videoTime, offsetMs);
  const target = Number.isFinite(lookup) ? lookup : 0;
  let best = null;
  let bestDist = Infinity;
  for (const cue of list) {
    const start = cueOriginalStartSeconds(cue);
    if (start == null) continue;
    const dist = Math.abs(start - target);
    if (dist < bestDist) {
      best = cue;
      bestDist = dist;
    }
  }
  return best;
}

// Video-clock window for the preview. Does not rewrite the cue.
export function subtitleOffsetPreviewSpan(cue, offsetMs, { maxSec = SUBTITLE_OFFSET_PREVIEW_MAX_SEC } = {}) {
  const startOrig = cueOriginalStartSeconds(cue);
  if (startOrig == null) return null;
  const cap = Number.isFinite(maxSec) && maxSec > 0 ? maxSec : SUBTITLE_OFFSET_PREVIEW_MAX_SEC;
  const endOrig = toSec(cue?.time_end ?? cue?.endSec);
  const start = shiftPlaybackSeconds(startOrig, offsetMs);
  let length = Math.min(1.5, cap);
  if (Number.isFinite(endOrig) && endOrig > startOrig) {
    const duration = endOrig - startOrig;
    length = duration <= cap ? duration : cap;
  }
  if (!(length > 0)) return null;
  const end = Math.round((start + length) * 1000) / 1000;
  return { cue, start, end };
}

// Preview seeks away from the parked frame. Keep nudges on that frame while playback
// is still inside the preview, and follow a real scrub once it leaves both.
export function previewStillOnParkedFrame(live, parked, span) {
  const parkedTime = Number(parked);
  if (!Number.isFinite(parkedTime)) return false;
  const time = Number(live);
  if (!Number.isFinite(time)) return true;
  if (span && Number.isFinite(span.start) && Number.isFinite(span.end)) {
    if (time >= span.start - 0.45 && time <= span.end + 0.45) return true;
  }
  return snapSampleTime(time, parkedTime) === parkedTime;
}

function memoryStore(storage) {
  if (storage) return storage;
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readMap(storage) {
  const store = memoryStore(storage);
  if (!store) return {};
  try {
    const raw = JSON.parse(store.getItem(scopedStorageKey(SUBTITLE_OFFSET_STORAGE_KEY)) || "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

export function readStoredOffset(videoKey, storage) {
  if (!videoKey) return { found: false, value: 0 };
  const map = readMap(storage);
  const key = String(videoKey);
  if (!Object.prototype.hasOwnProperty.call(map, key)) return { found: false, value: 0 };
  return { found: true, value: clampSubtitleOffsetMs(map[key]) };
}

export function writeSubtitleOffsetMs(videoKey, offsetMs, storage) {
  const value = clampSubtitleOffsetMs(offsetMs);
  if (!videoKey) return value;
  const store = memoryStore(storage);
  if (!store) return value;
  const map = readMap(storage);
  map[String(videoKey)] = value;
  try {
    store.setItem(scopedStorageKey(SUBTITLE_OFFSET_STORAGE_KEY), JSON.stringify(map));
  } catch {
    /* refresh can still restore the movie-record copy */
  }
  return value;
}

export function peekSubtitleOffsetMs(videoKey, { aliasKeys = [], movieOffsetMs = null, storage } = {}) {
  if (videoKey) {
    const primary = readStoredOffset(videoKey, storage);
    if (primary.found) return primary.value;
    for (const alias of aliasKeys) {
      if (!alias || alias === videoKey) continue;
      const hit = readStoredOffset(alias, storage);
      if (hit.found) return hit.value;
    }
  }
  if (movieOffsetMs != null && movieOffsetMs !== "" && Number.isFinite(Number(movieOffsetMs))) {
    return clampSubtitleOffsetMs(movieOffsetMs);
  }
  return 0;
}

export function subtitleOffsetStorageUser() {
  return getActiveStorageUser() || "";
}
