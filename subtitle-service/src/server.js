import { timingSafeEqual, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { extractSubtitleWithRetry, getVideoId, getYtDlpVersion, SubtitleServiceError } from './extractSubtitle.js';

const port = Number(process.env.PORT || 8080);
const providerPort = Number(process.env.BGUTIL_PORT || 4416);
const rateWindowMs = 60_000;
const rateLimit = Number(process.env.RATE_LIMIT_PER_MINUTE || 10);
const maxConcurrent = Number(process.env.MAX_CONCURRENT_EXTRACTIONS || 3);
const maxBodyBytes = 16 * 1024;
const requestsByIp = new Map();
let activeExtractions = 0;
let providerProcess;
let ytDlpVersion = 'unavailable';

function equalSecret(provided, expected) {
  if (typeof provided !== 'string' || !expected) return false;
  const providedHash = createHash('sha256').update(provided).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash) && provided.length === expected.length;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

function getBearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function clientIp(req) {
  return req.socket.remoteAddress || 'unknown';
}

function allowRate(req) {
  const now = Date.now();
  const ip = clientIp(req);
  const current = requestsByIp.get(ip);
  if (!current || now - current.startedAt >= rateWindowMs) {
    requestsByIp.set(ip, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= rateLimit;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new SubtitleServiceError(400, 'request_body', 'Request body is too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new SubtitleServiceError(400, 'request_body', 'Request body must be valid JSON'); }
}

async function startProvider() {
  const script = '/opt/bgutil/server/build/main.js';
  const providerDiagnostics = [];
  providerProcess = spawn(process.execPath, [script, '--host', '127.0.0.1', '--port', String(providerPort)], {
    cwd: '/opt/bgutil/server',
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  providerProcess.stderr.on('data', (chunk) => {
    const safe = String(chunk)
      .replace(/https?:\/\/[^\s"']+/gi, '[url]')
      .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
    providerDiagnostics.push(safe.slice(0, 1000));
    if (process.env.NODE_ENV === 'development') process.stderr.write(`[bgutil] ${safe.slice(0, 500)}`);
  });
  providerProcess.on('error', (error) => {
    providerDiagnostics.push(`process error: ${error.message}`);
  });
  providerProcess.on('exit', (code) => {
    process.stderr.write(`[bgutil] provider exited (${code})\n`);
  });

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (providerProcess.exitCode !== null) {
      const detail = providerDiagnostics.join(' ').replace(/\s+/g, ' ').slice(0, 1500);
      throw new Error(`PO Token provider exited during startup${detail ? `: ${detail}` : ''}`);
    }
    try {
      await fetch(`http://127.0.0.1:${providerPort}/ping`, { signal: AbortSignal.timeout(500) });
      return;
    } catch { await new Promise((resolve) => setTimeout(resolve, 200)); }
  }
  const detail = providerDiagnostics.join(' ').replace(/\s+/g, ' ').slice(0, 1500);
  throw new Error(`PO Token provider did not become ready${detail ? `: ${detail}` : ''}`);
}

function cleanFailureDiagnostics(diagnostics = {}) {
  return {
    ytDlpVersion: diagnostics.ytDlpVersion,
    availableSubtitles: diagnostics.availableSubtitles,
    availableAutomaticCaptions: diagnostics.availableAutomaticCaptions,
    selectedLanguage: diagnostics.selectedLanguage,
    selectedFormat: diagnostics.selectedFormat,
    poTokenProviderDetected: diagnostics.poTokenProviderDetected,
    poTokenProviderUsed: diagnostics.poTokenProviderUsed,
    extractorClient: diagnostics.extractorClient,
    ytDlpExitCode: diagnostics.ytDlpExitCode,
    ytDlpTimedOut: diagnostics.ytDlpTimedOut,
    loginRequired: diagnostics.loginRequired,
    stderrSummary: diagnostics.stderrSummary,
    lineCount: diagnostics.lineCount,
    subtitleCount: diagnostics.subtitleCount,
    attempts: diagnostics.attempts,
    elapsedMs: diagnostics.elapsedMs,
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    const providerReady = Boolean(providerProcess && providerProcess.exitCode === null);
    const ready = ytDlpVersion !== 'unavailable' && providerReady;
    return sendJson(res, ready ? 200 : 503, {
      ok: ready,
      ytDlpVersion,
      poTokenProviderConfigured: providerReady,
    });
  }
  if (req.method !== 'POST' || req.url !== '/transcript') {
    return sendJson(res, 404, { success: false, stage: 'route', error: 'Not found', diagnostics: {} });
  }

  if (!equalSecret(getBearer(req), process.env.SUBTITLE_SERVICE_KEY)) {
    return sendJson(res, 401, { success: false, stage: 'authentication', error: 'Unauthorized', diagnostics: {} });
  }
  if (!allowRate(req) || activeExtractions >= maxConcurrent) {
    return sendJson(res, 429, { success: false, stage: 'rate_limit', error: 'Too many subtitle requests', diagnostics: {} });
  }

  let body;
  try { body = await readJson(req); }
  catch (error) {
    const status = error instanceof SubtitleServiceError ? error.status : 400;
    return sendJson(res, status, { success: false, stage: error.stage || 'request_body', error: error.message, diagnostics: {} });
  }
  const requestInput = typeof body?.url === 'string' ? body.url : body?.videoId;
  const videoId = getVideoId(requestInput);
  if (!videoId) {
    return sendJson(res, 400, { success: false, stage: 'url_validation', error: 'A valid YouTube URL or videoId is required', diagnostics: {} });
  }

  activeExtractions += 1;
  const startedAt = Date.now();
  try {
    const result = await extractSubtitleWithRetry(requestInput, { videoId });
    return sendJson(res, 200, result);
  } catch (error) {
    const status = error instanceof SubtitleServiceError ? error.status : 500;
    const diagnostics = cleanFailureDiagnostics(error.diagnostics);
    if (process.env.NODE_ENV === 'development') {
      console.info('[subtitle-service] failed', JSON.stringify({ videoId, stage: error.stage || 'internal', status, diagnostics, elapsedMs: Date.now() - startedAt }));
    }
    return sendJson(res, status, {
      success: false,
      stage: error.stage || 'internal',
      error: error.message || 'Internal subtitle service error',
      diagnostics,
    });
  } finally {
    activeExtractions -= 1;
  }
});

server.requestTimeout = 190_000;
server.headersTimeout = 195_000;

async function main() {
  if (!process.env.SUBTITLE_SERVICE_KEY || process.env.SUBTITLE_SERVICE_KEY.length < 32) {
    throw new Error('SUBTITLE_SERVICE_KEY must be configured with at least 32 characters');
  }
  ytDlpVersion = await getYtDlpVersion();
  if (ytDlpVersion === 'unavailable') throw new Error('yt-dlp startup check failed');
  await startProvider();
  server.listen(port, '0.0.0.0', async () => {
    console.info(`Subtitle service listening on ${port}; yt-dlp=${ytDlpVersion}; PO Token provider=ready`);
  });
}

function shutdown() {
  server.close();
  if (providerProcess && providerProcess.exitCode === null) providerProcess.kill('SIGTERM');
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

main().catch((error) => {
  console.error(`Subtitle service startup failed: ${error.message}`);
  process.exitCode = 1;
});
