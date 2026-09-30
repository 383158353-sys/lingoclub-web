import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { extractYouTubeTranscript, TranscriptExtractionError } from "./youtubeTranscriptService.js";

const allowedOrigins = new Set(
  (process.env.TRANSCRIPT_SERVICE_ALLOWED_ORIGINS || "https://lingoclub.vercel.app,http://localhost:5173")
    .split(",").map((origin) => origin.trim()).filter(Boolean),
);

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function authorized(req) {
  const configuredToken = process.env.TRANSCRIPT_SERVICE_TOKEN;
  const suppliedToken = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!configuredToken || !suppliedToken) return false;
  const expected = Buffer.from(configuredToken);
  const supplied = Buffer.from(suppliedToken);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "600");
  }
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 32 * 1024) throw Object.assign(new Error("Request body too large"), { statusCode: 413 });
  }
  try { return JSON.parse(raw || "{}"); }
  catch { throw Object.assign(new Error("Invalid JSON"), { statusCode: 400 }); }
}

function retryableTranscriptFailure(error) {
  if (error instanceof TranscriptExtractionError) {
    return error.statusCode >= 500 && ["youtube_bot_challenge", "transcript_unavailable"].includes(error.reason);
  }
  return /LOGIN_REQUIRED|bot challenge|captionTracks|未发现字幕轨|没有可用事件|All promises were rejected/i
    .test(String(error?.message || ""));
}

function transcriptFailureKind(error) {
  return error?.reason === "youtube_bot_challenge" || /LOGIN_REQUIRED|bot challenge/i.test(String(error?.message || ""))
    ? "youtube_bot_challenge"
    : "youtube_transcript_unavailable";
}

export async function extractWithRetries(input, {
  extractor = extractYouTubeTranscript,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  const attempts = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const result = await extractor(input);
      return {
        ...result,
        attemptCount: attempt,
        attempts: [...attempts, { attempt, status: "success", subtitleCount: result.subtitles.length }],
      };
    } catch (error) {
      const retryable = retryableTranscriptFailure(error);
      attempts.push({
        attempt,
        status: "failed",
        kind: transcriptFailureKind(error),
        message: String(error?.message || "Transcript extraction failed").slice(0, 240),
      });
      if (!retryable || attempt === 3) {
        const finalError = new Error(error?.message || "Transcript extraction failed");
        finalError.statusCode = error instanceof TranscriptExtractionError ? error.statusCode : 502;
        finalError.reason = transcriptFailureKind(error);
        finalError.attemptCount = attempt;
        finalError.attempts = attempts;
        throw finalError;
      }
      await wait(1500);
    }
  }
  throw new Error("Transcript retry loop ended unexpectedly");
}

export function createTranscriptHttpServer() {
  return createServer(async (req, res) => {
    applyCors(req, res);
    const pathname = new URL(req.url || "/", "http://localhost").pathname;
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (pathname !== "/transcript") {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST, OPTIONS");
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    if (!process.env.TRANSCRIPT_SERVICE_TOKEN) {
      sendJson(res, 503, { error: "Transcript service authentication is not configured" });
      return;
    }
    if (!authorized(req)) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }
    try {
      const body = await readJson(req);
      const input = typeof body?.url === "string" ? body.url : body?.videoId;
      if (typeof input !== "string" || !input.trim()) {
        sendJson(res, 400, { error: "url or videoId is required" });
        return;
      }
      const result = await extractWithRetries(input);
      sendJson(res, 200, result);
    } catch (error) {
      const status = error?.statusCode || 502;
      sendJson(res, status, {
        error: error?.message || "Transcript extraction failed",
        reason: error?.reason || "transcript_service_error",
        attemptCount: error?.attemptCount || 0,
        attempts: error?.attempts || [],
      });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.env.TRANSCRIPT_SERVICE_TOKEN) {
    process.stderr.write("Set TRANSCRIPT_SERVICE_TOKEN before starting the transcript service.\n");
    process.exitCode = 1;
  } else {
    const port = Number(process.env.PORT || process.env.TRANSCRIPT_SERVICE_PORT || 8787);
    const host = process.env.HOST || "0.0.0.0";
    const server = createTranscriptHttpServer();
    server.listen(port, host, () => process.stdout.write(`Transcript service listening on http://${host}:${port}\n`));
  }
}
