import { captionWindowsFromEvents } from "../../src/lib/captionDisplayCues.js";
import { cleanVideoTitle } from "../../src/lib/videoTitle.js";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const ID_RX = /^[A-Za-z0-9_-]{11}$/;
// Ordered by reliability for caption access as of 2026-10. The API key query
// parameter is no longer required; a stale key made the IOS client return 404.
// Device fields matter: without them ANDROID/IOS are rejected more often.
const INNERTUBE_CLIENTS = [
  { name: "ANDROID", version: "20.10.38", userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 14)", context: { androidSdkVersion: 34, osName: "Android", osVersion: "14" } },
  { name: "IOS", version: "20.10.4", userAgent: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)", context: { deviceMake: "Apple", deviceModel: "iPhone16,2", osName: "iPhone", osVersion: "18.3.2.22D82" } },
  { name: "ANDROID_VR", version: "1.60.19", userAgent: "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip", context: { deviceMake: "Oculus", deviceModel: "Quest 3", androidSdkVersion: 32, osName: "Android", osVersion: "12L" } },
  { name: "TVHTML5", version: "7.20240813.07.00", userAgent: "Mozilla/5.0 (PlayStation 4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15" },
  { name: "WEB", version: "2.20240813.07.00", userAgent: UA, extraHeaders: { Origin: "https://www.youtube.com", Referer: "https://www.youtube.com/" } },
];

function firstUrl(value) {
  const text = String(value || "").trim();
  // ASCII URL characters only: pasted WeChat/中文 text often glues "，" or
  // other CJK characters directly onto the link.
  const match = text.match(/https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&*+,;=%]+/i);
  return (match?.[0] || text).replace(/[),.;!?，。；！？]+$/u, "");
}

export function videoId(value) {
  const text = String(value || "").trim();
  if (ID_RX.test(text)) return text;
  try {
    const raw = firstUrl(text);
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase();
    let id = "";
    if (host === "youtu.be") id = url.pathname.match(/^\/([A-Za-z0-9_-]{11})/)?.[1] || "";
    else if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtube-nocookie.com" || host.endsWith(".youtube-nocookie.com")) {
      id = url.searchParams.get("v") || url.pathname.match(/^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})(?:[/?]|$)/)?.[1] || "";
    }
    return ID_RX.test(id) ? id : null;
  } catch { return null; }
}

export function normalizeYouTubeUrl(value) {
  const id = videoId(value);
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}

function tracksFromHtml(html) {
  const markerIndex = html.indexOf('"captionTracks":[');
  if (markerIndex < 0) return [];
  const start = html.indexOf("[", markerIndex);
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i += 1) {
    const char = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "[") depth += 1;
    else if (char === "]" && --depth === 0) {
      try { return JSON.parse(html.slice(start, i + 1)); } catch { return []; }
    }
  }
  return [];
}

function clean(text) {
  return String(text || "").replace(/<s\b[^>]*>/gi, "s").replace(/<\/s\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, value) => { try { return String.fromCodePoint(Number(value)); } catch { return ""; } })
    .replace(/&#x([\da-f]+);/gi, (_, value) => { try { return String.fromCodePoint(parseInt(value, 16)); } catch { return ""; } })
    .replace(/\[(?:Music|Applause|Laughter|Cheering|Cheers|Crowd(?:\s+\w+)?|Noise|Background(?:\s+\w+)?|Faint\w*|Sound(?:s|\s+\w+)?|G__.+?|I__.+?)\]/gi, " ")
    .replace(/\((?:Music|Applause|Laughter|Cheers|Crowd noise|Sound\w*|Indistinct)\)/gi, " ")
    .replace(/^>>\s*/g, "")
    .replace(/[\uFEFF\u00AD\u200B-\u200F\u202A-\u202E\u2060\uFFFD]/g, "")
    .replace(/[\u00a0\u202f\u2007\u3000]/g, " ")
    .replace(/[—–‐‑‒]/g, "-")
    .replace(/\s+/g, " ").trim();
}

export function linesFromEvents(events) {
  return captionWindowsFromEvents(events).flatMap((cue) => {
    const text = clean(cue.text);
    if (!text) return [];
    return [{ text_en: text, time_start: timecode(cue.startMs), time_end: timecode(cue.endMs) }];
  });
}

function timecode(ms) {
  const total = ms / 1000;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total - hours * 3600 - minutes * 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds.toFixed(3).padStart(6, "0")}` : `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
}

function subtitlesFromEvents(events) {
  const subtitles = [];
  let previousStart = -1;
  let previousText = "";
  for (const cue of captionWindowsFromEvents(events)) {
    const text = clean(cue.text);
    const startMs = cue.startMs;
    if (!text || /blocking us from fetching subtitles|currently blocking|sign in to confirm you(?:'|’)?re not a bot|our systems have detected/i.test(text)) continue;
    if (startMs === previousStart && text === previousText) continue;
    subtitles.push({ start: startMs / 1000, duration: Math.max(0.01, (cue.endMs - startMs) / 1000), text });
    previousStart = startMs;
    previousText = text;
  }
  return subtitles;
}

export function pickEnglishTrack(tracks) {
  const english = (tracks || []).filter((track) => /^en(?:-|$)/i.test(String(track.languageCode || "")));
  return english.find((track) => track.languageCode === "en" && track.kind !== "asr")
    || english.find((track) => track.languageCode === "en" && track.kind === "asr")
    || english.find((track) => track.kind !== "asr")
    || english.find((track) => track.kind === "asr") || null;
}

// English first (manual, then auto-generated). Otherwise ask YouTube to
// machine-translate the best original track to English, and if that is not
// allowed fall back to the original language so the user still gets a transcript.
export function pickCaptionTrack(tracks) {
  const list = (tracks || []).filter((track) => track?.baseUrl);
  const english = pickEnglishTrack(list);
  if (english) return { track: english, translateTo: null };
  const original = list.find((track) => track.kind !== "asr") || list[0] || null;
  if (!original) return null;
  const translatable = list.find((track) => track.kind !== "asr" && track.isTranslatable) || list.find((track) => track.isTranslatable);
  if (translatable) return { track: translatable, translateTo: "en", fallbackTrack: original };
  return { track: original, translateTo: null };
}

function decodeEntities(text) {
  return String(text || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, value) => { try { return String.fromCodePoint(Number(value)); } catch { return ""; } });
}

// timedtext XML: default format (<text start dur>) and srv3 (<p t d>).
export function subtitlesFromXml(xml) {
  const events = [];
  for (const match of String(xml || "").matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const start = Number(match[1].match(/\bstart="([\d.]+)"/)?.[1]);
    const dur = Number(match[1].match(/\bdur="([\d.]+)"/)?.[1]);
    events.push({ tStartMs: Math.round(start * 1000), dDurationMs: Number.isFinite(dur) ? Math.round(dur * 1000) : undefined, segs: [{ utf8: decodeEntities(match[2]) }] });
  }
  if (!events.length) {
    for (const match of String(xml || "").matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
      const start = Number(match[1].match(/\bt="(\d+)"/)?.[1]);
      const dur = Number(match[1].match(/\bd="(\d+)"/)?.[1]);
      events.push({ tStartMs: start, dDurationMs: Number.isFinite(dur) ? dur : undefined, segs: [{ utf8: decodeEntities(match[2].replace(/<[^>]+>/g, "")) }] });
    }
  }
  return subtitlesFromEvents(events);
}

function safeBody(text) {
  return String(text || "").replace(/\s+/g, " ").slice(0, 600);
}

async function fetchWithTimeout(url, options, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function innertubeTracks(id, diagnostics, client, attempt) {
  const extractor = `innertube-${client.name.toLowerCase()}`;
  const response = await fetchWithTimeout("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": client.userAgent, ...(client.extraHeaders || {}) },
    body: JSON.stringify({ context: { client: { hl: "en", gl: "US", clientName: client.name, clientVersion: client.version, ...(client.context || {}) } }, videoId: id }),
  }, 6000);
  const raw = await response.text();
  diagnostics.push({ attempt, extractor, step: "player", method: "POST", status: response.status, errorBody: response.ok ? null : safeBody(raw) });
  if (!response.ok) throw new Error(`Innertube player 请求失败 (${response.status})`);
  const player = JSON.parse(raw);
  if (player?.playabilityStatus?.status && player.playabilityStatus.status !== "OK") {
    diagnostics.push({ attempt, extractor, step: "playability", status: player.playabilityStatus.status, errorBody: safeBody(player.playabilityStatus.reason) });
  }
  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  diagnostics.push({ attempt, extractor, step: "caption-tracks", found: tracks.length, playable: player?.playabilityStatus?.status === "OK" });
  if (!tracks.length) throw new Error(`${client.name} 未发现字幕轨`);
  return { extractor, title: cleanVideoTitle(player?.videoDetails?.title), tracks, attempt };
}

async function watchTracks(id, diagnostics, attempt, cookie) {
  const extractor = `watch-html-${attempt}`;
  const response = await fetchWithTimeout(`https://www.youtube.com/watch?v=${id}&hl=en&gl=US&bpctr=9999999999&has_verified=1`, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml,*/*", "Accept-Language": "en-US,en;q=0.9", Cookie: cookie }, redirect: "follow",
  }, 6000);
  const html = await response.text();
  diagnostics.push({ attempt, extractor, step: "watch-page", method: "GET", status: response.status, errorBody: response.ok ? null : safeBody(html) });
  if (!response.ok) throw new Error(`YouTube watch 页面请求失败 (${response.status})`);
  const tracks = tracksFromHtml(html);
  diagnostics.push({ attempt, extractor, step: "caption-tracks", found: tracks.length,
    pageType: /consent\.youtube\.com|Before you continue to YouTube/i.test(html) ? "consent" : /Sign in to confirm you(?:'|’)re not a bot/i.test(html) ? "bot-challenge" : "watch" });
  if (!tracks.length) throw new Error("watch HTML 未发现字幕轨");
  const title = cleanVideoTitle(clean(html.match(/<meta\s+name="title"\s+content="([^"]+)"/i)?.[1] || ""));
  return { extractor, title, tracks, attempt };
}

async function meaningfulAttempt(id, diagnostics, attempt) {
  const cookie = "CONSENT=PENDING+987";
  const requests = [...INNERTUBE_CLIENTS.map((client) => innertubeTracks(id, diagnostics, client, attempt)), watchTracks(id, diagnostics, attempt, cookie)]
    .map((request) => request.then((result) => result?.tracks?.length ? result : Promise.reject(new Error("empty"))));
  // Keep every client's outcome: when the fastest client's caption download
  // fails, the other clients that also found tracks are tried in the same attempt.
  const all = Promise.allSettled(requests);
  const first = await Promise.any(requests);
  return { first, others: async () => (await all).filter((item) => item.status === "fulfilled" && item.value !== first).map((item) => item.value) };
}

async function downloadCaptionFormat(baseUrl, format, translateTo, diagnostics, extractor) {
  const params = [format ? `fmt=${format}` : "", translateTo ? `tlang=${translateTo}` : ""].filter(Boolean).join("&");
  const requestUrl = params ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params}` : baseUrl;
  // Without a timeout a stalled timedtext download could consume the whole
  // serverless function budget and surface as an unexplained 504.
  const response = await fetchWithTimeout(requestUrl, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" } }, 8000);
  const raw = await response.text();
  diagnostics.push({ extractor, step: "caption-download", method: "GET", format: format || "xml", translateTo, status: response.status, bytes: raw.length, errorBody: response.ok ? null : safeBody(raw) });
  if (!response.ok) throw new Error(`字幕下载失败 (${response.status})`);
  if (!raw.trim()) throw new Error("字幕响应为空");
  if (format === "json3") {
    let json;
    try { json = JSON.parse(raw); } catch { throw new Error(`字幕响应不是 JSON: ${safeBody(raw)}`); }
    return subtitlesFromEvents(json.events);
  }
  return subtitlesFromXml(raw);
}

async function fetchCaptionTrack(track, diagnostics, extractor, translateTo = null) {
  const baseUrl = String(track?.baseUrl || "").replace(/[?&]fmt=[^&]+/g, "");
  if (!baseUrl) throw new Error("字幕轨缺少下载地址");
  let lastError;
  for (const format of ["json3", ""]) {
    try {
      const subtitles = await downloadCaptionFormat(baseUrl, format, translateTo, diagnostics, extractor);
      if (subtitles.length) return subtitles;
      lastError = new Error("字幕响应中没有可用事件");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export class TranscriptExtractionError extends Error {
  constructor(message, { reason = "transcript_unavailable", diagnostics = [], errors = [], statusCode = 502 } = {}) {
    super(message);
    this.name = "TranscriptExtractionError";
    this.reason = reason;
    this.diagnostics = diagnostics;
    this.errors = errors;
    this.statusCode = statusCode;
  }
}

export const NO_CAPTIONS_MESSAGE = "这个视频没有任何字幕（包括 YouTube 自动生成字幕），无法自动导入。请换一个带 CC 字幕的视频，或上传本地字幕文件。";
export const VIDEO_UNAVAILABLE_MESSAGE = "视频不存在、已删除、为私享视频或有地区/年龄限制，无法读取字幕。";
export const BOT_CHALLENGE_MESSAGE = "YouTube 暂时拦截了服务器的字幕请求（机器人验证），请稍后点“重试”。如果一直失败，需要配置独立字幕服务。";

// Distinguishes "the video truly has no captions" (no point retrying) from
// "YouTube refused us" (retry / independent service may help).
export function classifyTranscriptFailure(diagnostics) {
  const playableWithoutCaptions = diagnostics.some((item) => item.step === "caption-tracks" && item.playable === true && item.found === 0);
  const anyTracks = diagnostics.some((item) => item.step === "caption-tracks" && item.found > 0);
  if (playableWithoutCaptions && !anyTracks) return { reason: "no_captions", statusCode: 404, message: NO_CAPTIONS_MESSAGE };
  const playability = diagnostics.filter((item) => item.step === "playability");
  const botChallenge = playability.some((item) => /not a bot/i.test(item.errorBody || ""))
    || diagnostics.some((item) => item.pageType === "bot-challenge");
  const unavailable = playability.some((item) => item.status === "ERROR" || /video (?:is )?unavailable|private video|has been removed/i.test(item.errorBody || ""));
  const anyPlayable = diagnostics.some((item) => item.step === "caption-tracks" && item.playable === true);
  if (unavailable && !anyPlayable && !anyTracks && !botChallenge) return { reason: "video_unavailable", statusCode: 404, message: VIDEO_UNAVAILABLE_MESSAGE };
  if (botChallenge && !anyTracks) return { reason: "youtube_bot_challenge", statusCode: 503, message: BOT_CHALLENGE_MESSAGE };
  return { reason: "transcript_unavailable", statusCode: 502, message: "未能读取 YouTube 字幕，请稍后重试。" };
}

export async function extractYouTubeTranscriptDetailed(input, { attempts = 2, retryDelayMs = 500, budgetMs = 30_000, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const id = videoId(input);
  if (!id) throw new TranscriptExtractionError("不是有效的 YouTube 链接或 videoId", { statusCode: 400, reason: "invalid_video_id" });
  const diagnostics = [];
  const errors = [];
  const startedAt = Date.now();
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) {
      // A playable video without caption tracks will not grow captions on retry.
      if (classifyTranscriptFailure(diagnostics).reason === "no_captions") break;
      // Leave room for one more full attempt inside the serverless time limit.
      if (Date.now() - startedAt > budgetMs - 15_000) break;
      await wait(retryDelayMs * (attempt - 1));
    }
    try {
      const { first, others } = await meaningfulAttempt(id, diagnostics, attempt);
      let candidates = [first];
      let lastError;
      // Slower clients are only awaited after the fastest one has failed.
      for (let index = 0; index < candidates.length; index += 1) {
        const found = candidates[index];
        try {
          const picked = pickCaptionTrack(found.tracks);
          if (!picked) throw new Error(`${found.extractor} 未发现可下载的字幕轨`);
          let { track, translateTo } = picked;
          let subtitles;
          try {
            subtitles = await fetchCaptionTrack(track, diagnostics, found.extractor, translateTo);
          } catch (error) {
            if (!translateTo || !picked.fallbackTrack) throw error;
            // Machine translation refused: keep the original-language transcript.
            track = picked.fallbackTrack;
            translateTo = null;
            subtitles = await fetchCaptionTrack(track, diagnostics, found.extractor);
          }
          return {
            videoId: id,
            title: found.title || "",
            language: translateTo || String(track.languageCode || "en"),
            originalLanguage: String(track.languageCode || ""),
            translated: Boolean(translateTo),
            isAutoGenerated: track.kind === "asr",
            subtitles,
            diagnostics,
            extractor: found.extractor,
            attempt,
          };
        } catch (error) {
          lastError = error;
          errors.push({ attempt, extractor: found.extractor, message: error?.message || "caption download failed" });
          if (index === 0) candidates = [first, ...(await others())];
        }
      }
      throw lastError || new Error("all paths failed");
    } catch (error) {
      errors.push({ attempt, extractor: "legacy-multi-client", message: error?.message || "all paths failed" });
    }
  }
  const failure = classifyTranscriptFailure(diagnostics);
  throw new TranscriptExtractionError(failure.message, { reason: failure.reason, statusCode: failure.statusCode, diagnostics, errors });
}

export async function extractYouTubeTranscript(input) {
  const result = await extractYouTubeTranscriptDetailed(input);
  return { videoId: result.videoId, subtitles: result.subtitles };
}
