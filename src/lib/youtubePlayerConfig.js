// Cue recall mounts the iframe after an async URL lookup, so the original tap is
// no longer a user gesture. Mobile Safari/Chrome allow autoplay only when the
// embed starts muted and inline (WebKit's media policy; YouTube player params
// autoplay, start, mute, playsinline). The player unmutes after playback
// begins, and the word card keeps an in-app control if the browser still blocks it.
// Same parameters as the MIT @u-wave/react-youtube player (autoplay, startSeconds, muted, playsInline).
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
  return vars;
}

export function createYouTubeCueAutoplayVars(origin, startSeconds) {
  return createYouTubePlayerVars(origin, { autoplay: true, start: startSeconds, mute: true });
}

export function createYouTubeEmbedUrl(videoId, origin, options) {
  const params = new URLSearchParams({
    ...Object.fromEntries(Object.entries(createYouTubePlayerVars(origin, options)).map(([key, value]) => [key, String(value)])),
  });
  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params}`;
}

// YouTube reports 101/150 both for "owner disabled embedding" and when the
// embed is replaced by its "请登录，以便我们确认你不是聊天机器人" bot check
// (typically a flagged VPN/proxy IP). `embeddable` comes from oEmbed via
// /api/youtube-meta: true / false / null (unknown).
export function describeYouTubeEmbedError(code, embeddable = null) {
  if (code === 153) return "YouTube 未收到来源识别信息（153），这不是 LingoClub 登录失败。";
  if (code === 101 || code === 150) {
    if (embeddable === true) return "这个视频允许嵌入，是 YouTube 要求验证当前网络，请换个 VPN 节点后刷新。";
    if (embeddable === false) return "该视频不允许嵌入播放。";
    return "YouTube 无法在此播放：可能是当前网络/VPN 节点被 YouTube 要求验证（换个节点刷新试试），也可能是该视频不允许嵌入。";
  }
  if (code === 100) return "该视频可能已删除或设为私密。";
  if (code !== null && code !== undefined) return `YouTube 嵌入播放器无法播放（${code}）。`;
  return "YouTube 内嵌播放暂不可用：可能是当前网络/VPN 节点被 YouTube 要求验证，换个节点刷新试试。这不是 LingoClub 登录问题。";
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
