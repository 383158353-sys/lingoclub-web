import test from 'node:test';
import assert from 'node:assert/strict';
import { getVideoId } from './extractSubtitle.js';
import { parseJson3, parseVtt } from './parseSubtitle.js';

test('extracts the same ID from supported YouTube URL forms', () => {
  const id = 'FWPdhRieWOM';
  for (const url of [
    `https://youtu.be/${id}`,
    `https://youtu.be/${id}?si=share`,
    `https://www.youtube.com/watch?v=${id}&t=30`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
  ]) assert.equal(getVideoId(url), id);
  assert.equal(getVideoId('https://example.com/watch?v=FWPdhRieWOM'), null);
});

test('parses VTT timestamps and cues into the service contract', () => {
  const result = parseVtt('WEBVTT\n\n00:00:01.230 --> 00:00:03.500 align:start\nHello &amp; welcome.\n\n00:01:02.000 --> 00:01:03.250\n<c>Next line</c>\n\n01:03.250 --> 01:04.000\nShort timestamp');
  assert.deepEqual(result, [
    { text_en: 'Hello & welcome.', time_start: 1.23, time_end: 3.5 },
    { text_en: 'Next line', time_start: 62, time_end: 63.25 },
    { text_en: 'Short timestamp', time_start: 63.25, time_end: 64 },
  ]);
});

test('parses JSON3 event timing into the service contract', () => {
  const result = parseJson3({ events: [
    { tStartMs: 1200, dDurationMs: 2800, segs: [{ utf8: 'Hello ' }, { utf8: 'there' }] },
    { tStartMs: 5000, dDurationMs: 1000, segs: [{ utf8: 'Next' }] },
  ] });
  assert.deepEqual(result, [
    { text_en: 'Hello there', time_start: 1.2, time_end: 4 },
    { text_en: 'Next', time_start: 5, time_end: 6 },
  ]);
});
