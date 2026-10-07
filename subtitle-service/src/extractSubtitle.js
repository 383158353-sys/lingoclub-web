import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseSubtitle } from './parseSubtitle.js';

const execFileAsync = promisify(execFile);
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const MAX_BUFFER = 8 * 1024 * 1024;
const YTDLP_TIMEOUT_MS = 18_000;
const YTDLP_EXTRACTOR_ARGS = process.env.YTDLP_EXTRACTOR_ARGS || 'youtube:player_client=mweb';

export class SubtitleServiceError extends Error {
  constructor(status, stage, message, diagnostics = {}) {
    super(message);
    this.name = 'SubtitleServiceError';
    this.status = status;
    this.stage = stage;
    this.diagnostics = diagnostics;
  }
}

export function getVideoId(input) {
  const value = String(input ?? '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || !YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;
  let id = null;
  if (url.hostname.toLowerCase() === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0];
  else id = url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/]+)/)?.[1] || null;
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

export function toCanonicalYouTubeUrl(videoId) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

export function toPublicSubtitles(lines) {
  return (Array.isArray(lines) ? lines : []).flatMap((line) => {
    const start = Number(line?.time_start);
    const end = Number(line?.time_end);
    const text = String(line?.text_en ?? '').trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !text) return [];
    return [{ start, duration: end - start, text }];
  });
}

function cleanStderr(value) {
  return String(value || '')
    .replace(/https?:\/\/[^\s"']+/gi, '[url]')
    .replace(/(cookie\s*[:=]\s*)[^\r\n]*/gi, '$1[redacted]')
    .replace(/bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/((?:po[_ -]?token|authorization|visitor[_ -]?data)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
    .split('\n')
    .filter((line) => /error|warning|po token|player api json|bot|login|required|subtitle|caption|challenge/i.test(line))
    .slice(-12)
    .join('\n')
    .slice(0, 1600);
}

function diagnosticsFrom(stderr, extra = {}) {
  const output = String(stderr || '');
  return {
    poTokenProviderDetected: /PO Token Providers:.*bgutil|bgutil:(?:http|script)/i.test(output),
    poTokenProviderUsed: /Generating a .* PO Token .* via bgutil/i.test(output),
    extractorClient: [...new Set([...output.matchAll(/Downloading ([A-Za-z0-9_]+) player API JSON/gi)].map((match) => match[1]))],
    loginRequired: /LOGIN_REQUIRED|sign in to confirm|not a bot/i.test(output),
    stderrSummary: cleanStderr(output),
    ...extra,
  };
}

async function runYtDlp(args, { timeoutMs = YTDLP_TIMEOUT_MS, maxBuffer = MAX_BUFFER } = {}) {
  const executable = process.env.YTDLP_PATH || 'yt-dlp';
  const started = Date.now();
  try {
    const result = await execFileAsync(executable, args, {
      timeout: timeoutMs,
      maxBuffer,
      windowsHide: true,
      env: { ...process.env, HOME: process.env.HOME || os.tmpdir() },
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0, elapsedMs: Date.now() - started };
  } catch (error) {
    return {
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      exitCode: Number.isInteger(error.code) ? error.code : null,
      errorCode: error.code || null,
      timedOut: error.killed || error.signal === 'SIGTERM',
      elapsedMs: Date.now() - started,
    };
  }
}

function englishRank(language) {
  const normalized = String(language).toLowerCase();
  if (normalized === 'en') return 0;
  if (normalized === 'en-us') return 1;
  if (normalized === 'en-gb') return 2;
  return normalized.startsWith('en') ? 3 : Number.POSITIVE_INFINITY;
}

function bestEnglishLanguage(table = {}) {
  return Object.keys(table)
    .filter((language) => Number.isFinite(englishRank(language)))
    .sort((a, b) => englishRank(a) - englishRank(b) || a.localeCompare(b))[0] || null;
}

function providerStatus(stderr) {
  const diagnostics = diagnosticsFrom(stderr);
  return {
    detected: diagnostics.poTokenProviderDetected,
    used: diagnostics.poTokenProviderUsed,
    clients: diagnostics.extractorClient,
  };
}

export async function getYtDlpVersion() {
  const result = await runYtDlp(['--version', '--ignore-config'], { timeoutMs: 5000, maxBuffer: 256 * 1024 });
  if (result.exitCode !== 0 || !result.stdout.trim()) return 'unavailable';
  return result.stdout.trim().slice(0, 40);
}

export async function extractSubtitle(url, { videoId = getVideoId(url), log = console.info } = {}) {
  const startedAt = Date.now();
  const baseDiagnostics = { videoId, ytDlpVersion: await getYtDlpVersion() };
  if (!videoId) throw new SubtitleServiceError(400, 'url_validation', 'Invalid YouTube URL', baseDiagnostics);
  const canonicalUrl = toCanonicalYouTubeUrl(videoId);

  const metadata = await runYtDlp([
    '--ignore-config', '--no-update', '--no-warnings', '--verbose', '--no-playlist', '--skip-download',
    '--dump-single-json', '--js-runtimes', 'node', '--extractor-args', YTDLP_EXTRACTOR_ARGS, canonicalUrl,
  ]);
  const metadataDiagnostics = diagnosticsFrom(metadata.stderr, {
    ...baseDiagnostics,
    ytDlpExitCode: metadata.exitCode,
    ytDlpTimedOut: Boolean(metadata.timedOut),
    elapsedMs: Date.now() - startedAt,
  });
  if (metadata.exitCode !== 0) {
    if (metadata.timedOut) throw new SubtitleServiceError(502, 'metadata_timeout', 'YouTube extraction timed out', metadataDiagnostics);
    if (/429|too many requests/i.test(metadata.stderr)) throw new SubtitleServiceError(429, 'metadata_rate_limited', 'YouTube rate limited the request', metadataDiagnostics);
    throw new SubtitleServiceError(502, 'metadata_extraction', 'yt-dlp could not inspect this video', metadataDiagnostics);
  }

  let info;
  try { info = JSON.parse(metadata.stdout); }
  catch { throw new SubtitleServiceError(502, 'metadata_parse', 'yt-dlp returned invalid metadata JSON', metadataDiagnostics); }

  const manual = info.subtitles || {};
  const automatic = info.automatic_captions || {};
  const availableSubtitles = Object.keys(manual).sort();
  const availableAutomaticCaptions = Object.keys(automatic).sort();
  const candidates = [
    { language: bestEnglishLanguage(manual), isAutoGenerated: false },
    { language: bestEnglishLanguage(automatic), isAutoGenerated: true },
  ].filter((candidate) => candidate.language);

  if (!candidates.length) {
    throw new SubtitleServiceError(404, 'subtitle_discovery', 'No English subtitles are available for this video', {
      ...metadataDiagnostics, availableSubtitles, availableAutomaticCaptions,
    });
  }

  let lastFailure;
  for (const candidate of candidates) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingoclub-subtitles-'));
    try {
      const subtitleMode = candidate.isAutoGenerated ? '--write-auto-subs' : '--write-subs';
      const result = await runYtDlp([
        '--ignore-config', '--no-update', '--no-warnings', '--verbose', '--no-playlist', '--skip-download',
        subtitleMode, '--sub-langs', candidate.language, '--sub-format', 'vtt/best',
        '--extractor-args', YTDLP_EXTRACTOR_ARGS,
        '--output', path.join(tempDir, '%(id)s.%(ext)s'), '--windows-filenames', canonicalUrl,
      ]);
      const extractorDiagnostics = diagnosticsFrom(result.stderr);
      const extractionDiagnostics = {
        ...metadataDiagnostics,
        availableSubtitles,
        availableAutomaticCaptions,
        selectedLanguage: candidate.language,
        isAutoGenerated: candidate.isAutoGenerated,
        selectedFormat: null,
        poTokenProviderDetected: metadataDiagnostics.poTokenProviderDetected || extractorDiagnostics.poTokenProviderDetected,
        poTokenProviderUsed: metadataDiagnostics.poTokenProviderUsed || extractorDiagnostics.poTokenProviderUsed,
        extractorClient: [...new Set([...(metadataDiagnostics.extractorClient || []), ...(extractorDiagnostics.extractorClient || [])])],
        stderrSummary: [metadataDiagnostics.stderrSummary, extractorDiagnostics.stderrSummary].filter(Boolean).join('\n').slice(0, 1600),
        ytDlpExitCode: result.exitCode,
        ytDlpTimedOut: Boolean(result.timedOut),
        elapsedMs: Date.now() - startedAt,
      };
      const files = (await readdir(tempDir)).filter((name) => /\.(?:vtt|json3)$/i.test(name));
      if (result.exitCode !== 0 || files.length === 0) {
        const failure = /429|too many requests/i.test(result.stderr)
          ? new SubtitleServiceError(429, 'subtitle_download_rate_limited', 'YouTube rate limited the subtitle request', extractionDiagnostics)
          : /no subtitles|no automatic captions|requested subtitles.*not available/i.test(result.stderr)
            ? new SubtitleServiceError(404, 'subtitle_download', 'The selected English subtitle track is unavailable', extractionDiagnostics)
            : new SubtitleServiceError(502, result.timedOut ? 'subtitle_download_timeout' : 'subtitle_download', 'yt-dlp could not retrieve the selected subtitle', extractionDiagnostics);
        if (failure.status === 429) throw failure;
        lastFailure = failure;
        continue;
      }

      const fileName = files.sort((a, b) => Number(/\.vtt$/i.test(b)) - Number(/\.vtt$/i.test(a)))[0];
      const selectedFormat = path.extname(fileName).slice(1).toLowerCase();
      const content = await readFile(path.join(tempDir, fileName), 'utf8');
      const lines = parseSubtitle(content, selectedFormat);
      const subtitles = toPublicSubtitles(lines);
      const finalDiagnostics = {
        ...extractionDiagnostics,
        selectedFormat,
        lineCount: lines.length,
        subtitleCount: subtitles.length,
        elapsedMs: Date.now() - startedAt,
      };
      if (process.env.NODE_ENV === 'development') log('[subtitle-service] extraction', finalDiagnostics);
      if (!subtitles.length) {
        lastFailure = new SubtitleServiceError(502, 'subtitle_parse', 'Subtitle file contained no timed lines', finalDiagnostics);
        continue;
      }

      return {
        success: true,
        source: 'yt-dlp',
        videoId,
        language: candidate.language,
        isAutoGenerated: candidate.isAutoGenerated,
        subtitles,
        diagnostics: {
          ytDlpVersion: finalDiagnostics.ytDlpVersion,
          availableSubtitles,
          availableAutomaticCaptions,
          selectedLanguage: candidate.language,
          selectedFormat,
          poTokenProviderDetected: finalDiagnostics.poTokenProviderDetected,
          poTokenProviderUsed: finalDiagnostics.poTokenProviderUsed,
          extractorClient: finalDiagnostics.extractorClient,
          ytDlpExitCode: finalDiagnostics.ytDlpExitCode,
          stderrSummary: finalDiagnostics.stderrSummary,
          lineCount: lines.length,
          subtitleCount: subtitles.length,
          elapsedMs: finalDiagnostics.elapsedMs,
        },
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
  throw lastFailure || new SubtitleServiceError(404, 'subtitle_discovery', 'No English subtitles are available for this video', {
    ...metadataDiagnostics, availableSubtitles, availableAutomaticCaptions,
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function extractSubtitleWithRetry(input, {
  maxAttempts = 3,
  retryDelayMs = 1500,
  wait = delay,
  extract = extractSubtitle,
  ...options
} = {}) {
  const attempts = [];
  const boundedAttempts = Math.min(3, Math.max(1, Number(maxAttempts) || 3));

  for (let attempt = 1; attempt <= boundedAttempts; attempt += 1) {
    try {
      const result = await extract(input, options);
      attempts.push({ attempt, result: 'success' });
      return { ...result, diagnostics: { ...result.diagnostics, attempts } };
    } catch (error) {
      attempts.push({
        attempt,
        result: 'failure',
        stage: error?.stage ?? 'unknown',
        status: Number.isFinite(error?.status) ? error.status : null,
        ytDlpExitCode: error?.diagnostics?.ytDlpExitCode ?? null,
        loginRequired: Boolean(error?.diagnostics?.loginRequired),
      });
      error.diagnostics = { ...(error.diagnostics ?? {}), attempts };
      if ([400, 404, 429].includes(error?.status) || attempt === boundedAttempts) throw error;
      await wait(retryDelayMs);
    }
  }

  throw new SubtitleServiceError(502, 'extraction_failed', 'Subtitle extraction failed', { attempts });
}
