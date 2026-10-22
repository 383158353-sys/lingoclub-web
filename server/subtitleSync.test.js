import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { subtitlesFromSupadata } from "./transcript/supadataTranscript.js";
import { mergeFragments } from "../src/lib/subtitleCleaner.js";
import { toSec, fromSecPrecise, findCueAtTime } from "../src/lib/timecode.js";

// Real Supadata native (auto-generated, rolling/overlapping, no punctuation) captions.
const raw = JSON.parse(readFileSync(new URL("./fixtures/supadata-IH3Otn9Lz3I.json", import.meta.url), "utf8"));

function serverLines() {
  // Legacy sentence merger. The study list no longer calls this; caption windows stay 1:1.
  return subtitlesFromSupadata(raw.content).map((item) => ({
    text_en: item.text,
    time_start: fromSecPrecise(item.start),
    time_end: fromSecPrecise(item.start + item.duration),
  }));
}

// Each word of the raw stream with its owning chunk's raw start/end (seconds).
function rawWords() {
  const words = [];
  raw.content.forEach((chunk, i) => {
    const next = raw.content[i + 1];
    const start = chunk.offset / 1000;
    const end = Math.min((chunk.offset + chunk.duration) / 1000, next ? next.offset / 1000 : Infinity);
    for (const w of chunk.text.trim().split(/\s+/).filter(Boolean)) words.push({ w, start, end });
  });
  return words;
}

test("Supadata offsets/durations are milliseconds and convert to seconds exactly", () => {
  const subs = subtitlesFromSupadata(raw.content);
  assert.equal(subs.length, raw.content.length);
  subs.forEach((s, i) => {
    assert.equal(s.start, raw.content[i].offset / 1000);
    assert.equal(s.duration, raw.content[i].duration / 1000);
  });
  assert.equal(subs[0].start, 1.36);
});

test("merged/split lines keep the raw Supadata start of their first word (IH3Otn9Lz3I)", () => {
  const lines = mergeFragments(serverLines());
  const words = rawWords();
  let k = 0;
  let worst = 0;
  for (const line of lines) {
    const first = words[k];
    assert.ok(first, "word stream exhausted");
    assert.equal(line.text_en.split(/\s+/)[0], first.w, `word alignment at ${line.text_en}`);
    const start = toSec(line.time_start);
    // Must fall inside the raw chunk that contains the line's first word.
    const drift = start < first.start ? first.start - start : Math.max(0, start - first.end);
    worst = Math.max(worst, drift);
    k += line.text_en.split(/\s+/).filter(Boolean).length;
  }
  assert.equal(k, words.length, "no words lost or duplicated");
  assert.ok(worst <= 0.15, `worst drift ${worst.toFixed(3)}s`);
});

test("start times are strictly increasing and highlight resolves to the spoken line", () => {
  const lines = mergeFragments(serverLines());
  for (let i = 1; i < lines.length; i++) assert.ok(toSec(lines[i].time_start) > toSec(lines[i - 1].time_start));
  const words = rawWords();
  let k = 0;
  for (const line of lines) {
    const t = words[k].start + 0.05;
    const hit = findCueAtTime(lines, Math.max(t, toSec(line.time_start) + 0.01));
    assert.equal(hit?.text_en, line.text_en);
    k += line.text_en.split(/\s+/).filter(Boolean).length;
  }
});

test("lines that were not split keep their exact raw start", () => {
  const lines = mergeFragments([
    { text_en: "hello there", time_start: "0:01.000", time_end: "0:02.000" },
    { text_en: "how are you.", time_start: "0:02.500", time_end: "0:04.000" },
  ]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].time_start, "0:01.000");
  assert.equal(lines[0].time_end, "0:04.000");
});

// Punctuated rolling captions (RiO6yDxDui4): sentence breaks fall inside a chunk
// whose time_end overlaps the next 1–2 chunks. Every line must start inside the
// real speaking span [chunk start, next chunk start] of its first word.
test("punctuated rolling captions: no line starts after its first word's chunk span", () => {
  const { lines } = JSON.parse(readFileSync(new URL("./fixtures/lines-RiO6yDxDui4.json", import.meta.url), "utf8"));
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9']+/g, " ").trim().split(" ").filter(Boolean);
  const words = [];
  lines.forEach((c, i) => {
    const s = toSec(c.time_start);
    let e = toSec(c.time_end);
    const n = lines[i + 1] ? toSec(lines[i + 1].time_start) : e;
    if (n > s && n < e) e = n;
    norm(c.text_en).forEach((w) => words.push({ w, s, e }));
  });
  const out = mergeFragments(lines);
  let p = 0;
  let checked = 0;
  for (const line of out) {
    const ws = norm(line.text_en);
    if (!ws.length) continue;
    let k = p;
    while (k < words.length && words[k].w !== ws[0]) k++;
    assert.ok(k < words.length);
    const t = toSec(line.time_start);
    assert.ok(t >= words[k].s - 0.15 && t <= words[k].e + 0.05, `${line.time_start} "${line.text_en.slice(0, 40)}" outside [${words[k].s}, ${words[k].e}]`);
    p = k + ws.length;
    checked++;
  }
  assert.ok(checked > 800);
});
