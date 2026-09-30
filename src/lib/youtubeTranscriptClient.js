// 浏览器端 YouTube 字幕抓取器
// ------------------------------------------------------------
// Base44 后端位于数据中心 IP，YouTube 几乎对所有公共 Innertube 客户端
// 与第三方付费代理都返回 LOGIN_REQUIRED / 403。但用户浏览器是住宅 IP，
// 因此从用户浏览器出发、经 corsproxy 等代发服务请求 watch 页通常能拿到
// 完整 ytInitialPlayerResponse，其中含已签名的 captionTracks baseUrl，
// 再向 timedtext 端点请求 json3 即可拿到带时间戳的事件。
// 一旦失败（比如该视频本就没有字幕轨 / 代发服务也已被 YouTube 屏蔽），
// 返回一个明确的 error，UI 会引导用户走"复制 YouTube 转录"备选流程。
import { fetchYouTubeTranscript } from "@/lib/localApi";
import { mergeFragments } from "@/lib/subtitleCleaner";

const YOUTUBE_ID_RX = /^[A-Za-z0-9_-]{11}$/;
const TRANSCRIPT_CACHE_PREFIX = "lingoclub:youtube-transcript:v1:";
const TRANSCRIPT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const transcriptCache = new Map();
const transcriptRequests = new Map();

function readPersistentTranscript(videoId) {
  try {
    if (typeof globalThis.localStorage === "undefined") return null;
    const raw = globalThis.localStorage.getItem(`${TRANSCRIPT_CACHE_PREFIX}${videoId}`);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (cached?.savedAt && Date.now() - cached.savedAt > TRANSCRIPT_CACHE_TTL_MS) {
      globalThis.localStorage.removeItem(`${TRANSCRIPT_CACHE_PREFIX}${videoId}`);
      return null;
    }
    if (!Array.isArray(cached?.lines) || !cached.lines.length) return null;
    if (cached.lines.some((line) => !line || typeof line.text_en !== "string" || !line.time_start)) return null;
    return cached.lines;
  } catch {
    return null;
  }
}

function writePersistentTranscript(videoId, lines) {
  try {
    if (typeof globalThis.localStorage === "undefined") return;
    globalThis.localStorage.setItem(`${TRANSCRIPT_CACHE_PREFIX}${videoId}`, JSON.stringify({
      savedAt: Date.now(),
      lines,
    }));
  } catch {
    // Private mode, disabled storage, or quota limits must not break importing.
  }
}

export function extractYouTubeId(url) {
  try {
    const input = String(url || "").trim();
    const match = input.match(/https?:\/\/[^\s<>"']+/i);
    const value = (match?.[0] || input).replace(/[),.;!?，。；！？]+$/u, "");
    const u = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const h = u.hostname.toLowerCase();
    if (h === "youtu.be") {
      const id = u.pathname.slice(1).split(/[/?]/)[0];
      return YOUTUBE_ID_RX.test(id) ? id : null;
    }
    const isYouTube = h === "youtube.com" || h.endsWith(".youtube.com")
      || h === "youtube-nocookie.com" || h.endsWith(".youtube-nocookie.com");
    if (isYouTube) {
      const queryId = u.searchParams.get("v") || "";
      if (YOUTUBE_ID_RX.test(queryId)) return queryId;
      const pathId = u.pathname.match(/^\/(?:embed|shorts|v|live)\/([A-Za-z0-9_-]{11})(?:[/?]|$)/)?.[1];
      if (YOUTUBE_ID_RX.test(pathId || "")) return pathId;
    }
  } catch { /* not a URL */ }
  return null;
}

export function normalizeYouTubeUrl(url) {
  const videoId = extractYouTubeId(url);
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
}

function msToTimecode(ms) {
  const total = ms / 1000;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total - hours * 3600 - minutes * 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds.toFixed(3).padStart(6, "0")}`
    : `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
}

function cleanCaptionText(value) {
  return String(value || "")
    .replace(/<s\b[^>]*>/gi, "s").replace(/<\/s>/gi, "")
    .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ").trim();
}

function eventsToLines(events) {
  const lines = [];
  for (const event of events || []) {
    const text = cleanCaptionText((event.segs || []).map((part) => part.utf8 || "").join(""));
    const start = Number(event.tStartMs ?? event.dStartMs);
    if (!text || !Number.isFinite(start)) continue;
    const duration = Number(event.dDurationMs) || Math.max(1500, Math.min(8000, text.length * 80));
    lines.push({ text_en: text, time_start: msToTimecode(start), time_end: msToTimecode(start + duration) });
  }
  return lines;
}

function captionTracksFromHtml(html) {
  const marker = html.indexOf('"captionTracks":[');
  if (marker < 0) return [];
  const start = html.indexOf("[", marker);
  let depth = 0, quoted = false, escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "[") depth += 1;
    else if (char === "]" && --depth === 0) {
      try { return JSON.parse(html.slice(start, index + 1)); } catch { return []; }
    }
  }
  return [];
}

function pickEnglishTrack(tracks) {
  const english = (tracks || []).filter((track) => /^en(?:-|$)/i.test(String(track.languageCode || "")));
  return english.find((track) => track.languageCode === "en" && track.kind !== "asr")
    || english.find((track) => track.languageCode === "en" && track.kind === "asr")
    || english.find((track) => track.kind !== "asr") || english[0] || null;
}

async function fetchWithTimeout(url, timeoutMs, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function captionsFromProxiedWatch(html, proxyUrl, proxyName, diagnostics) {
  const tracks = captionTracksFromHtml(html);
  diagnostics.push({ attempt: 3, extractor: `browser-proxy:${proxyName}`, step: "caption-tracks", found: tracks.length });
  const track = pickEnglishTrack(tracks);
  if (!track?.baseUrl) return null;
  const baseUrl = String(track.baseUrl).replace(/[?&]fmt=[^&]+/g, "");
  const captionUrl = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}fmt=json3`;
  for (const [path, requestUrl] of [["direct-timedtext", captionUrl], ["proxied-timedtext", proxyUrl(captionUrl)]]) {
    try {
      const response = await fetchWithTimeout(requestUrl, 10000, { headers: { Accept: "application/json,text/plain,*/*" } });
      const raw = await response.text();
      diagnostics.push({ attempt: 3, extractor: `browser-proxy:${proxyName}`, step: path, status: response.status, bytes: raw.length });
      if (!response.ok || !raw.trim().startsWith("{")) continue;
      const lines = eventsToLines(JSON.parse(raw).events);
      if (lines.length) return {
        lines,
        extractor: `browser-proxy:${proxyName}`,
        attempt: 3,
        captionTracksFound: tracks.length,
        language: track.languageCode || "en",
        isAutoGenerated: track.kind === "asr",
      };
    } catch (error) {
      diagnostics.push({ attempt: 3, extractor: `browser-proxy:${proxyName}`, step: path, error: error?.message || "fetch failed" });
    }
  }
  return null;
}

async function legacyBrowserFallback(watchUrl) {
  const diagnostics = [];
  const proxies = [
    ["allorigins", (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`],
    ["codetabs", (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`],
    ["corsproxy.io", (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`],
    ["cors.sh", (url) => `https://proxy.cors.sh/${url}`],
  ];
  const requests = proxies.map(async ([name, proxyUrl]) => {
    try {
      const response = await fetchWithTimeout(proxyUrl(watchUrl), 9000, {
        headers: { Accept: "text/html,*/*", "Accept-Language": "en-US,en;q=0.9" },
      });
      const html = await response.text();
      diagnostics.push({ attempt: 3, extractor: `browser-proxy:${name}`, step: "watch-page", status: response.status, bytes: html.length });
      if (!response.ok || !html.includes('"captionTracks"')) throw new Error("captionTracks missing");
      const result = await captionsFromProxiedWatch(html, proxyUrl, name, diagnostics);
      if (!result?.lines?.length) throw new Error("caption download failed");
      return result;
    } catch (error) {
      diagnostics.push({ attempt: 3, extractor: `browser-proxy:${name}`, step: "failed", error: error?.message || "fetch failed" });
      throw error;
    }
  });
  try {
    return { ...(await Promise.any(requests)), diagnostics };
  } catch {
    return { lines: null, diagnostics };
  }
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
}

// Meaningful attempts: (1-2) the restored historical multi-client strategy in
// Vercel, then (3) the historical browser proxy path. A successful caption
// response stops here.
async function fetchTranscriptOnce(videoId, signal) {
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const attemptErrors = [];
  let serverError = null;

  // Restored server path: two rounds with distinct client/header groups.
  try {
    const data = await fetchYouTubeTranscript(canonicalUrl, { signal });
    if (data?.lines?.length) return {
      lines: mergeFragments(data.lines),
      videoId: data.videoId,
      title: data.title,
      language: data.language,
      isAutoGenerated: data.isAutoGenerated,
      diagnostics: data.diagnostics,
      attempt: data.diagnostics?.attempt || 1,
    };
    // 后端返回错误 → 继续尝试客户端
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    serverError = error;
    attemptErrors.push({ attempt: 2, extractor: "vercel-legacy-multi-client", message: error?.message || "failed" });
  }

  await delay(350, signal);
  const watchUrl = `${canonicalUrl}&hl=en&gl=US&bpctr=9999999999&has_verified=1`;
  const fallback = await legacyBrowserFallback(watchUrl);
  if (fallback?.lines?.length) return {
    ...fallback,
    lines: mergeFragments(fallback.lines),
    videoId,
  };
  attemptErrors.push({ attempt: 3, extractor: "browser-proxy", message: "all historical proxy paths failed" });

  return {
    error: serverError?.message || "服务器与旧版浏览器路径均暂时无法读取 YouTube 已有 Transcript",
    diagnostics: {
      server: serverError?.details?.diagnostics || null,
      browser: fallback?.diagnostics || [],
      attempts: attemptErrors,
    },
  };
}

export async function transcribeYouTubeClient(url, { signal } = {}) {
  const videoId = extractYouTubeId(url);
  if (!videoId) return { error: "不是有效的 YouTube 链接" };
  const cached = transcriptCache.get(videoId);
  if (cached?.length) return { lines: cached, cached: true };
  const persistentCached = readPersistentTranscript(videoId);
  if (persistentCached?.length) {
    transcriptCache.set(videoId, persistentCached);
    return { lines: persistentCached, cached: true };
  }
  if (transcriptRequests.has(videoId)) return transcriptRequests.get(videoId);

  const request = (async () => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const result = await fetchTranscriptOnce(videoId, signal);
    if (result?.lines?.length) {
      transcriptCache.set(videoId, result.lines);
      writePersistentTranscript(videoId, result.lines);
      return result;
    }
    return result || { error: "Primary 与 Fallback 均未取得英文字幕。请使用字幕提取书签工具导入。" };
  })().finally(() => transcriptRequests.delete(videoId));

  transcriptRequests.set(videoId, request);
  return request;
}

// 写入 Subtitle 实体
export async function importYouTubeTranscript(episode, onProgress) {
  const { lines, error } = await transcribeYouTubeClient(episode.video_url);
  if (error) return { error };
  const records = lines.map((l, i) => ({
    movie_id: episode.movie_id,
    episode_id: episode.id,
    text_en: l.text_en,
    order: i + 1,
    timestamp: l.time_start,
    time_start: l.time_start,
    time_end: l.time_end,
    analysis_status: "none",
  }));
  onProgress?.(`正在导入 ${records.length} 条台词…`);
  // 旧的社区剧集导入仍使用 Base44；本地学习链路不会调用此兼容入口。
  const { base44 } = await import("@/api/base44Client");
  const created = await base44.entities.Subtitle.bulkCreate(records);
  return { count: Array.isArray(created) ? created.length : records.length, source: "youtube_cc" };
}
