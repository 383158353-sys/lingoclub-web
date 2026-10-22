// Player caption windows, not a sentence splitter.
// One json3 event that replaces the caption is one on-screen block and one list row.
// aAppend grows that same window (the player does not flash a new block).
// A later event without aAppend is the next block, even when the grammar continues.
//
// Supadata (and other timed-cue feeds) never sets aAppend. Those ASR tracks are
// rolling two-line captions: the next fragment starts before the previous one
// ends, and the player shows them as one block. displayLinesFromTimedCues joins
// only that overlap, and only until sentence-final punctuation.

import { fromSecPrecise, toSec } from "./timecode.js";

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

const NON_SPEECH = /\[(?:Music|Applause|Laughter|Cheering|Cheers|Crowd(?:\s+\w+)?|Noise|Background(?:\s+\w+)?|Faint\w*|Sound(?:s|\s+\w+)?|G__.+?|I__.+?)\]|\((?:Music|Applause|Laughter|Cheers|Crowd noise|Sound\w*|Indistinct)\)/gi;
const SENTENCE_BOUNDARY = /(?:\.{3,}|…+|[.!?]+)["'“”‘’)\]]*/g;
const ABBREVIATION = /\b(?:Mr|Mrs|Ms|Dr|St|Prof|Sr|Jr|vs|etc|e\.g|i\.e|U\.S|U\.K)\.$/i;

function presentText(value) {
  return String(value ?? "")
    .replace(NON_SPEECH, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cueSeconds(line) {
  const start = toSec(line?.time_start);
  const end = toSec(line?.time_end);
  return {
    start: Number.isFinite(start) ? start : NaN,
    end: Number.isFinite(end) ? end : NaN,
  };
}

function timeString(seconds, original) {
  const parsed = toSec(original);
  if (original != null && original !== "" && Number.isFinite(parsed) && Math.abs(parsed - seconds) < 0.0005) return original;
  return fromSecPrecise(seconds);
}

// First sentence-final punctuation. restAt === text.length when nothing follows it.
function boundaryIn(text) {
  SENTENCE_BOUNDARY.lastIndex = 0;
  let match;
  while ((match = SENTENCE_BOUNDARY.exec(text))) {
    const token = match[0];
    const index = match.index;
    const prev = text[index - 1] || "";
    const next = text[index + token.length] || "";
    if (!token.startsWith("…") && !token.startsWith("...") && /\d/.test(prev) && /\d/.test(next)) continue;
    if ((token === "." || /^\.(?:["'“”‘’)\]]+)?$/.test(token)) && ABBREVIATION.test(text.slice(0, index + 1))) continue;
    const end = index + token.length;
    let restAt = end;
    while (restAt < text.length && /\s/.test(text[restAt])) restAt += 1;
    return { end, restAt };
  }
  return null;
}

function endsWithSentence(text) {
  const found = boundaryIn(text);
  return Boolean(found && found.restAt >= text.length);
}

function audibleEnd(cue, next) {
  if (next && Number.isFinite(next.start) && next.start > cue.start && (!Number.isFinite(cue.end) || next.start < cue.end)) {
    return next.start;
  }
  return Number.isFinite(cue.end) ? cue.end : cue.start;
}

function timeAt(anchors, offset, textLength, fallback) {
  if (!anchors?.length || !Number.isFinite(fallback)) return fallback;
  let index = 0;
  while (index + 1 < anchors.length && anchors[index + 1].at <= offset) index += 1;
  const anchor = anchors[index];
  if (!Number.isFinite(anchor.start)) return fallback;
  const nextAt = index + 1 < anchors.length ? anchors[index + 1].at : textLength;
  let spanEnd = index + 1 < anchors.length ? anchors[index + 1].start : anchor.end;
  if (Number.isFinite(anchor.end) && (!Number.isFinite(spanEnd) || anchor.end < spanEnd)) spanEnd = anchor.end;
  if (!(spanEnd > anchor.start) || !(nextAt > anchor.at)) return Math.min(Math.max(anchor.start, fallback), Number.isFinite(spanEnd) ? spanEnd : fallback);
  const ratio = Math.min(1, Math.max(0, (offset - anchor.at) / (nextAt - anchor.at)));
  return anchor.start + (spanEnd - anchor.start) * ratio;
}

function withoutStaleReading(line, text) {
  if (text === line.text_en) return { ...line, text_en: text };
  const next = { ...line, text_en: text };
  delete next.text_zh;
  delete next.ai_analysis;
  delete next.ai_analysis_version;
  return next;
}

function finishWindow(window, text = window.text, start = window.start, end = window.end) {
  const line = withoutStaleReading(window.line, text);
  return {
    ...line,
    text_en: text,
    time_start: timeString(start, start === window.originStart ? window.line.time_start : ""),
    time_end: timeString(end, end === window.originEnd ? window.line.time_end : window.endStr),
  };
}

function beginWindow(cue, next) {
  return {
    line: cue.line,
    text: cue.text,
    start: cue.start,
    end: cue.end,
    originStart: cue.start,
    originEnd: cue.end,
    endStr: cue.line.time_end,
    anchors: [{ at: 0, start: cue.start, end: audibleEnd(cue, next) }],
    lastCue: cue,
  };
}

function joinWindow(window, cue, next) {
  const at = window.text.length + 1;
  const last = window.anchors[window.anchors.length - 1];
  if (last && Number.isFinite(cue.start) && cue.start < last.end) last.end = cue.start;
  window.anchors.push({ at, start: cue.start, end: audibleEnd(cue, next) });
  window.text = `${window.text} ${cue.text}`.replace(/\s+/g, " ").trim();
  if (Number.isFinite(cue.end) && (!Number.isFinite(window.end) || cue.end > window.end)) {
    window.end = cue.end;
    window.endStr = cue.line.time_end;
  }
  window.lastCue = cue;
  return window;
}

function leftoverLine(window, used) {
  const preferred = window.lastCue?.line?.id && window.lastCue.line.id !== window.line?.id
    ? window.lastCue.line
    : window.line;
  let id = preferred?.id || window.line?.id || "cue";
  if (used.has(id)) {
    const base = id;
    let n = 2;
    while (used.has(`${base}#${n}`)) n += 1;
    id = `${base}#${n}`;
  }
  used.add(id);
  return { ...(preferred || {}), id };
}

// After a join, a sentence-final mark can sit in the middle ("…film world. It").
// Emit through that mark and keep the tail for the next overlapping cue.
function takeSentences(window, used) {
  const emitted = [];
  let guard = 0;
  while (window && guard < 8) {
    guard += 1;
    const found = boundaryIn(window.text);
    if (!found || found.restAt >= window.text.length) break;
    const sentence = window.text.slice(0, found.end).trim();
    const rest = window.text.slice(found.restAt).trim();
    if (!sentence || !rest) break;
    const splitAt = timeAt(window.anchors, found.end, window.text.length, window.end);
    const split = Math.min(Number.isFinite(window.end) ? window.end : splitAt, Math.max(window.start, splitAt));
    if (!(split > window.start)) break;
    used.add(window.line?.id);
    emitted.push(finishWindow(window, sentence, window.start, split));
    const line = leftoverLine(window, used);
    window = {
      line,
      text: rest,
      start: split,
      end: window.end,
      originStart: NaN,
      originEnd: window.originEnd,
      endStr: window.endStr,
      anchors: [{ at: 0, start: split, end: Number.isFinite(window.end) ? window.end : split }],
      lastCue: window.lastCue,
    };
  }
  return { window, emitted };
}

function clampRows(rows) {
  return rows.map((row, index) => {
    const next = rows[index + 1];
    if (!next) return row;
    const end = toSec(row.time_end);
    const start = toSec(row.time_start);
    const nextStart = toSec(next.time_start);
    if (!Number.isFinite(end) || !Number.isFinite(nextStart) || !Number.isFinite(start)) return row;
    if (end <= nextStart + 0.0005 || nextStart <= start) return row;
    return { ...row, time_end: timeString(nextStart, next.time_start) };
  });
}

/**
 * One study-list row per on-screen caption block.
 * Consecutive cues merge only while the next one starts before the current
 * window ends. Sentence-final punctuation closes the row. A period inside the
 * joined text ("…film world. It") emits through that sentence and carries the
 * leftover into the next window. Neighbors that merely touch, commas, and
 * conjunctions stay untouched. Already non-overlapping rows pass through.
 */
export function displayLinesFromTimedCues(lines) {
  if (!Array.isArray(lines)) return [];
  const cues = lines.map((line, index) => {
    const text = presentText(line?.text_en ?? line?.text ?? "");
    const { start, end } = cueSeconds(line || {});
    return { line: { ...line, text_en: text }, text, start, end, index };
  }).filter((cue) => cue.text);
  cues.sort((a, b) => {
    const aStart = Number.isFinite(a.start) ? a.start : Number.POSITIVE_INFINITY;
    const bStart = Number.isFinite(b.start) ? b.start : Number.POSITIVE_INFINITY;
    return aStart - bStart || a.index - b.index;
  });

  const rows = [];
  const used = new Set();
  let current = null;
  const push = (window) => {
    if (!window?.text) return;
    if (window.line?.id) used.add(window.line.id);
    rows.push(finishWindow(window));
  };

  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    const next = cues[index + 1];
    if (!Number.isFinite(cue.start)) {
      push(current);
      current = null;
      rows.push(withoutStaleReading(cue.line, cue.text));
      continue;
    }
    if (!current) {
      current = beginWindow(cue, next);
      continue;
    }
    const overlaps = Number.isFinite(current.end) && cue.start < current.end - 0.0005;
    if (!overlaps || endsWithSentence(current.text)) {
      push(current);
      current = beginWindow(cue, next);
      continue;
    }
    joinWindow(current, cue, next);
    const taken = takeSentences(current, used);
    rows.push(...taken.emitted);
    current = taken.window;
    if (current && endsWithSentence(current.text)) {
      push(current);
      current = null;
    }
  }
  push(current);
  return clampRows(rows);
}
