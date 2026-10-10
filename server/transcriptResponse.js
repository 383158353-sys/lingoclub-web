// Server-only API adapter. Explicit activation is required after remote validation.
// The browser continues to receive only { lines: [{ text_en, time_start, time_end }] }.
import { fromSecPrecise } from "../src/lib/timecode.js";

export async function requestTranscriptService(videoId, runtime, fetchImpl = fetch) {
  const fail = (status, code, stage, error) => ({ status, payload: { error, code, stage } });
  let endpoint;
  try {
    endpoint = new URL(runtime.TRANSCRIPT_SERVICE_URL);
    if (endpoint.username || endpoint.password || !["http:", "https:"].includes(endpoint.protocol)) throw new Error();
    if (endpoint.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)) throw new Error();
    endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "").replace(/\/transcript$/, "")}/transcript`;
    endpoint.search = "";
    endpoint.hash = "";
  } catch {
    return fail(503, "TRANSCRIPT_SERVICE_CONFIG", "service_configuration", "字幕服务地址未正确配置");
  }
  const token = String(runtime.TRANSCRIPT_SERVICE_TOKEN || "").trim();
  if (!token) return fail(503, "TRANSCRIPT_SERVICE_CONFIG", "service_configuration", "字幕服务测试鉴权未配置");
  try {
    const response = await fetchImpl(endpoint.href, {
      method: "POST", redirect: "error",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ videoId }), signal: AbortSignal.timeout(65_000),
    });
    const payload = await response.json().catch(() => null);
    if (response.status === 401 || response.status === 403) {
      return fail(502, "TRANSCRIPT_SERVICE_AUTH", "service_authentication", "字幕服务鉴权失败，请检查服务端测试 key");
    }
    if (!response.ok || payload?.success === false) {
      if (payload?.diagnostics?.loginRequired || payload?.reason === "youtube_bot_challenge") {
        return fail(502, "YOUTUBE_BLOCKED", "caption_tracks", "YouTube 拒绝字幕服务请求，尚未取得字幕轨");
      }
      if (response.status === 404 && payload?.stage?.startsWith("subtitle_")) {
        return fail(404, "TRANSCRIPT_NO_CAPTIONS", "subtitle_discovery", "该视频没有可获取的英文字幕");
      }
      if (response.status === 429) return fail(429, "TRANSCRIPT_RATE_LIMIT", "service_request", "字幕请求过于频繁，请稍后重试");
      return fail(502, "TRANSCRIPT_SERVICE_FAILED", "service_extraction", "字幕服务提取失败，请检查测试服务诊断");
    }
    try {
      if (payload?.videoId && payload.videoId !== videoId) throw new Error("Video mismatch");
      return { status: 200, payload: { ...transcriptServiceToFrontend(payload), trackLanguage: payload.language || "en" } };
    } catch {
      return fail(502, "TRANSCRIPT_SERVICE_RESPONSE", "service_response", "字幕服务返回的字幕数据无效");
    }
  } catch (error) {
    return error?.name === "TimeoutError" || error?.name === "AbortError"
      ? fail(504, "TRANSCRIPT_SERVICE_TIMEOUT", "service_request", "字幕服务请求超时，请稍后重试")
      : fail(502, "TRANSCRIPT_SERVICE_NETWORK", "service_request", "无法连接字幕服务，请检查测试服务状态");
  }
}

export function transcriptServiceToFrontend(payload) {
  if (!Array.isArray(payload?.subtitles) || payload.subtitles.length === 0) {
    throw new Error("Transcript service returned no subtitles");
  }
  const lines = payload.subtitles.map((subtitle) => {
    const { start, duration, text } = subtitle || {};
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(duration)
      || duration <= 0 || !Number.isFinite(start + duration)
      || typeof text !== "string" || !text.trim()) {
      throw new Error("Transcript service returned an invalid timed subtitle");
    }
    return { text_en: text, time_start: fromSecPrecise(start), time_end: fromSecPrecise(start + duration) };
  });
  return { lines };
}
