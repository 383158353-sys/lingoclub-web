// Player caption windows, not a sentence splitter.
// One json3 event that replaces the caption is one on-screen block and one list row.
// aAppend grows that same window (the player does not flash a new block).
// A later event without aAppend is the next block, even when the grammar continues.

function eventText(event) {
  return String((event?.segs || []).map((part) => part?.utf8 || "").join(""))
    .replace(/<s\b[^>]*>/gi, "s")
    .replace(/<\/s\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isAppend(event) {
  const flag = event?.aAppend;
  return flag === 1 || flag === true || flag === "1";
}

/**
 * @param {Array<{ tStartMs?: number, dStartMs?: number, dDurationMs?: number, aAppend?: number|boolean, wWinId?: number, segs?: Array<{ utf8?: string }> }>|null|undefined} events
 * @returns {Array<{ text: string, startMs: number, endMs: number }>}
 */
export function captionWindowsFromEvents(events) {
  const windows = [];
  let current = null;
  for (const event of events || []) {
    const startMs = Number(event?.tStartMs ?? event?.dStartMs);
    if (!Number.isFinite(startMs) || startMs < 0) continue;
    const text = eventText(event);
    if (!text) {
      if (current && startMs > current.startMs && startMs < current.endMs) current.endMs = startMs;
      current = null;
      continue;
    }
    const durationMs = Number(event?.dDurationMs);
    const endMs = startMs + (Number.isFinite(durationMs) && durationMs > 0
      ? durationMs
      : Math.max(1500, Math.min(8000, text.length * 80)));
    const winId = event?.wWinId ?? null;
    const sameWindow = current && (winId == null || current.winId == null || current.winId === winId);
    if (isAppend(event) && sameWindow) {
      current.text = `${current.text} ${text}`.replace(/\s+/g, " ").trim();
      if (endMs > current.endMs) current.endMs = endMs;
      continue;
    }
    current = { text, startMs, endMs, winId };
    windows.push(current);
  }
  return windows.map(({ text, startMs, endMs }) => ({ text, startMs, endMs }));
}

// Study-list pass-through. Timed cues already are the player blocks; do not
// merge neighboring flashes or cut them on punctuation / length.
export function displayLinesFromTimedCues(lines) {
  if (!Array.isArray(lines)) return [];
  return lines
    .map((line) => ({
      ...line,
      text_en: String(line?.text_en ?? line?.text ?? "").replace(/\s+/g, " ").trim(),
    }))
    .filter((line) => line.text_en);
}
