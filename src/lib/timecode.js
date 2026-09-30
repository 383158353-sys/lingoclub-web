// Timecode helpers for subtitle sync.

export function toSec(t) {
  if (t == null || t === "") return NaN;
  const parts = String(t).split(":").map((p) => parseFloat(p));
  if (parts.some((p) => Number.isNaN(p))) return NaN;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return NaN;
}

// Resolve a cue strictly from the playback clock, independent of manual row selection.
export function findCueAtTime(subtitles, currentTime, gapTolerance = 1.2) {
  if (!Array.isArray(subtitles) || !Number.isFinite(currentTime)) return null;
  let best = null;
  let bestStart = -Infinity;
  let nextStart = Infinity;
  for (const cue of subtitles) {
    const start = toSec(cue?.time_start);
    if (!Number.isFinite(start)) continue;
    if (start <= currentTime + 0.05 && start > bestStart) {
      best = cue;
      bestStart = start;
    }
  }
  if (!best) return null;
  for (const cue of subtitles) {
    const start = toSec(cue?.time_start);
    if (Number.isFinite(start) && start > bestStart && start < nextStart) nextStart = start;
  }
  const end = toSec(best.time_end);
  const activeEnd = Number.isFinite(end) && end < nextStart
    ? end
    : Number.isFinite(nextStart)
      ? nextStart - 0.05
      : Number.isFinite(end)
        ? end + gapTolerance
        : bestStart + gapTolerance;
  return currentTime <= activeEnd + gapTolerance ? best : null;
}

export function fromSec(s) {
  if (s == null || Number.isNaN(s)) return "";
  const total = Math.max(0, Math.floor(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// 保留毫秒精度的时间码格式化（用于字幕分句后的时间轴分配，
// 避免 fromSec 截断为整数秒导致短句时间戳丢失）。
export function fromSecPrecise(s) {
  if (s == null || Number.isNaN(s)) return "";
  const total = Math.max(0, s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total - h * 3600 - m * 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${sec.toFixed(3).padStart(6, "0")}`;
  return `${m}:${sec.toFixed(3).padStart(6, "0")}`;
}
