import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';

const bundled = await build({
  entryPoints: ['src/lib/youtubeTranscriptClient.js'], bundle: true,
  write: false, format: 'esm', platform: 'node',
  alias: { '@': path.resolve('src') },
  plugins: [{ name: 'original-sdk-test', setup(builder) {
    builder.onResolve({ filter: /^@\/api\/base44Client$/ }, () => ({ path: 'sdk', namespace: 'test-sdk' }));
    builder.onLoad({ filter: /.*/, namespace: 'test-sdk' }, () => ({
      contents: 'export const base44 = { functions: { fetch: (...args) => globalThis.originalSubtitleInvoke(...args) } };',
    }));
  } }],
});
const { transcribeYouTubeClient } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const lines = [{ text_en: 'This is an original subtitle.', time_start: '0:00.240', time_end: '0:01.942' }];

test('direct original function keeps subtitle responses larger than the invoke proxy limit', async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Unexpected alternate service request'); };
  try {
    for (const data of [{ lines }, { lines: Array.from({ length: 3537 }, (_, i) => ({ ...lines[0], text_en: `Original subtitle ${i}.`, time_start: `0:${i}.240`, time_end: `0:${i + 1}.942` })) }]) {
      const calls = [];
      globalThis.originalSubtitleInvoke = async (...args) => { calls.push(args); return Response.json(data); };
      const result = await transcribeYouTubeClient('https://youtu.be/LCAY3PGHZyw');
      assert.equal(calls[0][0], '/youtube-transcript');
      assert.equal(calls[0][1].method, 'POST');
      assert.deepEqual(JSON.parse(calls[0][1].body), { url: 'https://youtu.be/LCAY3PGHZyw' });
      assert.equal(result.lines.length, data.lines.length);
      assert.equal(result.lines.at(-1).text_en, data.lines.at(-1).text_en);
      assert.equal(result.lines[0].time_start, data.lines[0].time_start);
    }
  } finally { globalThis.fetch = savedFetch; delete globalThis.originalSubtitleInvoke; }
});

test('original app authentication failure is not misreported as YouTube blocking', async () => {
  try {
    for (const response of [{ status: 401 }, { status: 500, data: { error: 'Authentication required to view users' } }]) {
      globalThis.originalSubtitleInvoke = async () => Response.json(response.data || { error: 'Unauthorized' }, { status: response.status });
      const result = await transcribeYouTubeClient('https://youtu.be/LCAY3PGHZyw');
      assert.equal(result.code, 'BASE44_AUTH_REQUIRED');
    }
  } finally { delete globalThis.originalSubtitleInvoke; }
});
