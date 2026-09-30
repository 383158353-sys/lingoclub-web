const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const ID_RX = /^[A-Za-z0-9_-]{11}$/;
const INNERTUBE_CLIENTS = [
  { name: "ANDROID_VR", version: "1.37.14", key: "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w", userAgent: "com.google.android.apps.youtube.vr.oculus/1.37.14 (Linux; U; Android 12L;)" },
  { name: "ANDROID", version: "20.10.38", key: "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w", userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 14)" },
  { name: "TVHTML5", version: "7.20240813.07.00", key: "AIzaSyDCU8hByM-4DrUqRUYnGn-3llEO78bcxq8", userAgent: "Mozilla/5.0 (PlayStation 4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15" },
  { name: "WEB", version: "2.20240813.07.00", key: "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8", userAgent: UA, extraHeaders: { Origin: "https://www.youtube.com", Referer: "https://www.youtube.com/" } },
  { name: "IOS", version: "2.20240813.07.00", key: "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8", userAgent: "com.google.ios.youtube/20.10.4 (iPhone14,5; U; CPU iOS 16_4 like Mac OS X)" },
];

function firstUrl(value) {
  const text = String(value || "").trim();
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
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
    if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0];
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
  return (events || []).flatMap((event) => {
    const text = clean((event.segs || []).map((part) => part.utf8 || "").join(""));
    const start = Number(event.tStartMs ?? event.dStartMs);
    if (!text || !Number.isFinite(start)) return [];
    const duration = Number(event.dDurationMs) || Math.max(1500, Math.min(8000, text.length * 80));
    return [{ text_en: text, time_start: timecode(start), time_end: timecode(start + duration) }];
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
  for (const event of events || []) {
    const text = clean((event.segs || []).map((part) => part.utf8 || "").join(""));
    const startMs = Number(event.tStartMs ?? event.dStartMs);
    if (!text || /blocking us from fetching subtitles|currently blocking|sign in to confirm you(?:'|’)?re not a bot|our systems have detected/i.test(text)) continue;
    if (!Number.isFinite(startMs) || startMs < 0 || (startMs === previousStart && text === previousText)) continue;
    const durationMs = Number(event.dDurationMs) || Math.max(1500, Math.min(8000, text.length * 80));
    subtitles.push({ start: startMs / 1000, duration: durationMs / 1000, text });
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
  const response = await fetchWithTimeout(`https://www.youtube.com/youtubei/v1/player?prettyPrint=false&key=${client.key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": client.userAgent, ...(client.extraHeaders || {}) },
    body: JSON.stringify({ context: { client: { hl: "en", gl: "US", clientName: client.name, clientVersion: client.version } }, videoId: id }),
  }, 6000);
  const raw = await response.text();
  diagnostics.push({ attempt, extractor, step: "player", method: "POST", status: response.status, errorBody: response.ok ? null : safeBody(raw) });
  if (!response.ok) throw new Error(`Innertube player 请求失败 (${response.status})`);
  const player = JSON.parse(raw);
  if (player?.playabilityStatus?.status && player.playabilityStatus.status !== "OK") {
    diagnostics.push({ attempt, extractor, step: "playability", status: player.playabilityStatus.status, errorBody: safeBody(player.playabilityStatus.reason) });
  }
  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  diagnostics.push({ attempt, extractor, step: "caption-tracks", found: tracks.length });
  if (!tracks.length) throw new Error(`${client.name} 未发现字幕轨`);
  return { extractor, title: player?.videoDetails?.title || "", tracks, attempt };
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
  const title = clean(html.match(/<meta\s+name="title"\s+content="([^"]+)"/i)?.[1] || "");
  return { extractor, title, tracks, attempt };
}

async function meaningfulAttempt(id, diagnostics, attempt) {
  const cookie = "CONSENT=PENDING+987";
  const requests = [...INNERTUBE_CLIENTS.map((client) => innertubeTracks(id, diagnostics, client, attempt)), watchTracks(id, diagnostics, attempt, cookie)];
  return Promise.any(requests.map((request) => request.then((result) => result?.tracks?.length ? result : Promise.reject(new Error("empty")))));
}

async function fetchCaptionTrack(track, diagnostics, extractor) {
  const baseUrl = String(track?.baseUrl || "").replace(/[?&]fmt=[^&]+/g, "");
  if (!baseUrl) throw new Error("字幕轨缺少下载地址");
  const separator = baseUrl.includes("?") ? "&" : "?";
  const requestUrl = `${baseUrl}${separator}fmt=json3`;
  const response = await fetch(requestUrl, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" } });
  const raw = await response.text();
  diagnostics.push({ extractor, step: "caption-download", method: "GET", format: "json3", status: response.status, bytes: raw.length, errorBody: response.ok ? null : safeBody(raw) });
  if (!response.ok) throw new Error(`字幕下载失败 (${response.status})`);
  let json;
  try { json = JSON.parse(raw); } catch { throw new Error(`字幕响应不是 JSON: ${safeBody(raw) || "empty body"}`); }
  const subtitles = subtitlesFromEvents(json.events);
  if (!subtitles.length) throw new Error("字幕响应中没有可用事件");
  return subtitles;
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

export async function extractYouTubeTranscriptDetailed(input) {
  const id = videoId(input);
  if (!id) throw new TranscriptExtractionError("不是有效的 YouTube 链接或 videoId", { statusCode: 400 });
  const diagnostics = [];
  const errors = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const found = await meaningfulAttempt(id, diagnostics, attempt);
      const track = pickEnglishTrack(found.tracks);
      if (!track) throw new Error(`${found.extractor} 未发现英文字幕轨`);
      const subtitles = await fetchCaptionTrack(track, diagnostics, found.extractor);
      return {
        videoId: id,
        title: found.title || "",
        language: String(track.languageCode || "en"),
        isAutoGenerated: track.kind === "asr",
        subtitles,
        diagnostics,
        extractor: found.extractor,
        attempt,
      };
    } catch (error) {
      errors.push({ attempt, extractor: "legacy-multi-client", message: error?.message || "all paths failed" });
    }
  }
  const botChallenge = diagnostics.some((item) => item.step === "playability" && /not a bot/i.test(item.errorBody || ""))
    || diagnostics.some((item) => item.pageType === "bot-challenge");
  throw new TranscriptExtractionError(
    botChallenge
      ? "YouTube bot challenge 阻止服务器读取该视频已有的 CC Transcript"
      : "未能读取 YouTube 已有英文 CC Transcript",
    { reason: botChallenge ? "youtube_bot_challenge" : "transcript_unavailable", diagnostics, errors },
  );
}

export async function extractYouTubeTranscript(input) {
  const result = await extractYouTubeTranscriptDetailed(input);
  return { videoId: result.videoId, subtitles: result.subtitles };
}
