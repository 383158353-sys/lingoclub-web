// Cue recall mounts the iframe after an async URL lookup, so the original tap is
// no longer a user gesture. Mobile Safari/Chrome allow autoplay only when the
// embed starts muted and inline (WebKit's media policy; YouTube player params
// autoplay, start, mute, playsinline). controls=0 hides the control bar and the
// large center play button for this preview only. The player unmutes after
// playback begins. Sentence looping seeks back to the cue; YouTube's loop=1
// restarts the whole video and requires playlist=<video id>, so it is not set.
// Same parameters as the MIT @u-wave/react-youtube player
// (autoplay, startSeconds, muted, playsInline, controls).
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

export function createYouTubePlayerVars(origin, options = {}) {
  const autoplay = Boolean(options.autoplay);
  const start = Number(options.start);
  const vars = {
    rel: 0,
    modestbranding: 1,
    autoplay: autoplay ? 1 : 0,
    playsinline: 1,
    enablejsapi: 1,
    ...(origin ? { origin } : {}),
  };
  if (autoplay && Number.isFinite(start) && start >= 1) vars.start = Math.floor(start);
  if (options.mute) vars.mute = 1;
  if (options.controls === 0) vars.controls = 0;
  if (options.fs === 0) vars.fs = 0;
  if (options.disablekb) vars.disablekb = 1;
  if (options.ivLoadPolicy != null) vars.iv_load_policy = options.ivLoadPolicy;
  return vars;
}

export function createYouTubeCueAutoplayVars(origin, startSeconds) {
  return createYouTubePlayerVars(origin, {
    autoplay: true,
    start: startSeconds,
    mute: true,
    controls: 0,
    fs: 0,
    disablekb: true,
    ivLoadPolicy: 3,
  });
}

// www.youtube.com/embed asks for a Google session. With third-party cookies
// blocked, or when the first iframe request has no Referer, YouTube shows
// "Sign in to confirm you're not a bot" on every network, not one bad VPN node.
// The privacy-enhanced host is the supported embed that plays without that login.
const YOUTUBE_EMBED_ORIGIN = "https://www.youtube-nocookie.com";

function youTubeEmbedUrl(videoId, vars) {
  const params = new URLSearchParams({
    ...Object.fromEntries(Object.entries(vars).map(([key, value]) => [key, String(value)])),
  });
  return `${YOUTUBE_EMBED_ORIGIN}/embed/${encodeURIComponent(videoId)}?${params}`;
}

export function createYouTubeCueEmbedUrl(videoId, origin, startSeconds) {
  return youTubeEmbedUrl(videoId, createYouTubeCueAutoplayVars(origin, startSeconds));
}

/** Opening the sentence preview is the playback gesture. Study pages do not call this. */
export function armCuePreviewPlayback() {
  if (typeof window === "undefined" || typeof Audio === "undefined") return false;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) {
      const context = armCuePreviewPlayback.context || new Ctx();
      armCuePreviewPlayback.context = context;
      if (context.state === "suspended") void context.resume();
    }
  } catch { /* unlocking audio is best-effort */ }
  try {
    const audio = armCuePreviewPlayback.audio || new Audio();
    armCuePreviewPlayback.audio = audio;
    audio.muted = true;
    audio.setAttribute("playsinline", "");
    audio.src = SILENT_WAV;
    audio.play?.()?.catch?.(() => {});
  } catch { /* a blocked unlock must not stop the preview */ }
  return true;
}

export function cuePreviewPlaybackConfig(origin, startSeconds, endSeconds) {
  const start = Number(startSeconds);
  const end = Number(endSeconds);
  return {
    autoplay: true,
    loop: true,
    showPlayButton: false,
    muted: true,
    playsInline: true,
    controls: false,
    start: Number.isFinite(start) ? start : 0,
    end: Number.isFinite(end) ? end : null,
    playerVars: createYouTubeCueAutoplayVars(origin, startSeconds),
    youtubeLoopParam: false,
  };
}

export function shouldRestartCueLoop(time, loop) {
  const position = Number(time);
  const start = Number(loop?.start);
  const end = Number(loop?.end);
  return Number.isFinite(position) && Number.isFinite(start) && Number.isFinite(end) && end > start && position >= end;
}

export function createYouTubeEmbedUrl(videoId, origin, options) {
  return youTubeEmbedUrl(videoId, createYouTubePlayerVars(origin, options));
}

// No JS API on this request. Used only after the API embed is replaced by
// YouTube's bot check, so the player can still start without a second handshake.
export function createYouTubePlainEmbedUrl(videoId) {
  const params = new URLSearchParams({ rel: "0", modestbranding: "1", playsinline: "1" });
  return `${YOUTUBE_EMBED_ORIGIN}/embed/${encodeURIComponent(videoId)}?${params}`;
}

// 101/150 means the owner disabled embedding, or YouTube replaced the player
// before it could start. `embeddable` comes from oEmbed via /api/youtube-meta:
// true / false / null (unknown). Do not tell the viewer to switch VPN nodes:
// the same screen appears on every network when the embed request is wrong.
export function describeYouTubeEmbedError(code, embeddable = null) {
  if (code === 153) return "YouTube 未收到来源识别信息（153），这不是 LingoClub 登录失败。";
  if (code === 101 || code === 150) {
    if (embeddable === true) return "这个视频允许嵌入，但 YouTube 没有在这里开始播放。请直接打开原视频。这不是 LingoClub 登录问题。";
    if (embeddable === false) return "该视频不允许嵌入播放。";
    return "YouTube 无法在此播放。请直接打开原视频；也可能是该视频不允许嵌入。这不是 LingoClub 登录问题。";
  }
  if (code === 100) return "该视频可能已删除或设为私密。";
  if (code !== null && code !== undefined) return `YouTube 嵌入播放器无法播放（${code}）。`;
  return "YouTube 内嵌播放没有开始。请直接打开原视频。这不是 LingoClub 登录问题。";
}

export async function checkYouTubeEmbeddable(videoId, { timeoutMs = 8000 } = {}) {
  try {
    const response = await fetch("/api/youtube-meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${videoId}` }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data?.embeddable === "boolean" ? data.embeddable : null;
  } catch {
    return null;
  }
}
