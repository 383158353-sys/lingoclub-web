import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSubtitleWithRetry, getVideoId, toPublicSubtitles } from './extractSubtitle.js';

test('getVideoId accepts a raw ID and supported YouTube URL variants', () => {
  assert.equal(getVideoId('LCAY3PGHZyw'), 'LCAY3PGHZyw');
  assert.equal(getVideoId('https://youtu.be/LCAY3PGHZyw?si=abc'), 'LCAY3PGHZyw');
  assert.equal(getVideoId('https://www.youtube.com/watch?v=LCAY3PGHZyw&t=5'), 'LCAY3PGHZyw');
  assert.equal(getVideoId('https://www.youtube-nocookie.com/embed/LCAY3PGHZyw'), 'LCAY3PGHZyw');
});

test('public response maps timed lines to start, duration, and text', () => {
  assert.deepEqual(toPublicSubtitles([
    { text_en: 'Hello', time_start: 1.25, time_end: 2.5 },
    { text_en: 'invalid', time_start: 3, time_end: 3 },
  ]), [{ start: 1.25, duration: 1.25, text: 'Hello' }]);
});

test('retry wrapper makes at most three attempts with 1500ms pauses', async () => {
  let calls = 0;
  const delays = [];
  const result = await extractSubtitleWithRetry('LCAY3PGHZyw', {
    extract: async () => {
      calls += 1;
      if (calls < 3) {
        const error = new Error('temporary upstream failure');
        error.status = 502;
        error.stage = 'subtitle_fetch';
        throw error;
      }
      return { videoId: 'LCAY3PGHZyw', subtitles: [{ start: 0, duration: 1, text: 'Hi' }], diagnostics: {} };
    },
    wait: async (ms) => delays.push(ms),
  });

  assert.equal(calls, 3);
  assert.deepEqual(delays, [1500, 1500]);
  assert.equal(result.diagnostics.attempts.length, 3);
});

test('missing subtitles and rate limits do not cause repeat requests', async () => {
  for (const status of [404, 429]) {
    let calls = 0;
    await assert.rejects(extractSubtitleWithRetry('LCAY3PGHZyw', {
      extract: async () => {
        calls += 1;
        const error = new Error('terminal');
        error.status = status;
        throw error;
      },
      wait: async () => assert.fail('terminal status must not retry'),
    }));
    assert.equal(calls, 1);
  }
});
