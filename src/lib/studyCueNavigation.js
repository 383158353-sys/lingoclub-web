import { toSec } from "./timecode.js";

/** Return a cue strictly adjacent to the playhead's current transcript cue. */
export function getAdjacentTranscriptCue(subtitles, currentTime, direction) {
  if (!Array.isArray(subtitles) || !Number.isFinite(currentTime) || ![-1, 1].includes(direction)) return null;
  const timedCues = subtitles
    .map((cue, originalIndex) => ({ cue, originalIndex, start: toSec(cue?.time_start) }))
    .filter((entry) => Number.isFinite(entry.start))
    .sort((a, b) => a.start - b.start || a.originalIndex - b.originalIndex);
  if (!timedCues.length) return null;

  let currentIndex = -1;
  for (let i = 0; i < timedCues.length; i += 1) {
    if (timedCues[i].start <= currentTime + 0.05) currentIndex = i;
    else break;
  }

  // When playback is before the first cue, Down should go to that first cue.
  const targetIndex = currentIndex < 0
    ? (direction > 0 ? 0 : -1)
    : currentIndex + direction;
  return timedCues[targetIndex]?.cue || null;
}

/** Calculate a single-cue loop range that ends before the next cue begins. */
export function getStudyCueLoopRange(subtitle, subtitles, { epsilon = 0.05 } = {}) {
  const start = toSec(subtitle?.time_start);
  if (!Number.isFinite(start)) return null;

  let nextStart = Infinity;
  for (const cue of subtitles || []) {
    const candidate = toSec(cue?.time_start);
    if (Number.isFinite(candidate) && candidate > start && candidate < nextStart) nextStart = candidate;
  }

  const rawEnd = toSec(subtitle?.time_end);
  const explicitEnd = Number.isFinite(rawEnd) && rawEnd > start ? rawEnd : NaN;
  let end;

  if (Number.isFinite(nextStart)) {
    const gap = nextStart - start;
    const boundaryEpsilon = Math.min(epsilon, gap / 2);
    const beforeNextCue = nextStart - boundaryEpsilon;
    end = Number.isFinite(explicitEnd) ? Math.min(explicitEnd, beforeNextCue) : beforeNextCue;
  } else if (Number.isFinite(explicitEnd)) {
    end = explicitEnd;
  } else {
    const wordCount = String(subtitle?.text_en || "").split(/\s+/).filter(Boolean).length;
    end = start + Math.max(3, wordCount * 0.45);
  }

  return { start, end: end > start ? end : start + 0.01 };
}
