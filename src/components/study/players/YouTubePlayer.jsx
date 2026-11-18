import React, { useRef, useEffect, forwardRef, useImperativeHandle, useMemo } from "react";
import { createYouTubeCueEmbedUrl, createYouTubeEmbedUrl } from "@/lib/youtubePlayerConfig";

/**
 * YouTube 播放器。只放一个 nocookie iframe，不加载 YouTube 的播放器脚本。
 * 那份脚本会把播放器换成 youtube.com 的嵌入页，从而出现登录验证，视频就无法在页面里播放。
 * 进度和跳转通过嵌入页自己的 postMessage 完成。
 */

function parseYouTube(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");
    let id = null;
    if (host === "youtu.be") {
      id = u.pathname.slice(1).split("/")[0];
    } else if (host.endsWith("youtube.com")) {
      if (u.pathname.startsWith("/watch")) id = u.searchParams.get("v");
      else if (u.pathname.startsWith("/embed/")) id = u.pathname.split("/")[2];
      else if (u.pathname.startsWith("/shorts/")) id = u.pathname.split("/")[2];
    } else if (host === "i.ytimg.com" || host === "img.youtube.com") {
      const m = u.pathname.match(/^\/(?:vi|sb|hq|mq|maxres|hqdefault|mqdefault|sddefault|maxresdefault)\/([\w-]{6,})(?:\/|$)/);
      if (m) id = m[1];
    }
    if (id && /^[\w-]{6,}$/.test(id)) return { videoId: id };
    return null;
  } catch {
    return null;
  }
}

function postToPlayer(iframe, payload) {
  if (!iframe?.contentWindow) return;
  iframe.contentWindow.postMessage(JSON.stringify({
    ...payload,
    id: iframe.id,
    channel: "widget",
  }), "*");
}

const YouTubePlayer = forwardRef(function YouTubePlayer({ url, className = "", onTimeUpdate, onUserSeek, autoPlayFrom, cueAutoplay = false }, ref) {
  const embed = useMemo(() => parseYouTube(url), [url]);
  const iframeRef = useRef(null);
  const timeRef = useRef(0);
  const stateRef = useRef(-1);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  onTimeUpdateRef.current = onTimeUpdate;
  const onUserSeekRef = useRef(onUserSeek);
  onUserSeekRef.current = onUserSeek;
  const autoPlayFromRef = useRef(autoPlayFrom);
  autoPlayFromRef.current = autoPlayFrom;
  const cueAutoplayRef = useRef(cueAutoplay);
  cueAutoplayRef.current = cueAutoplay;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const src = useMemo(() => {
    if (!embed) return "";
    if (cueAutoplay && Number.isFinite(Number(autoPlayFrom))) return createYouTubeCueEmbedUrl(embed.videoId, origin, autoPlayFrom);
    return createYouTubeEmbedUrl(embed.videoId, origin);
  }, [embed, cueAutoplay, autoPlayFrom, origin]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return undefined;
    let lastEmitted = -1;
    let lastTime = null;
    const emit = (t) => {
      if (typeof t !== "number" || Number.isNaN(t)) return;
      timeRef.current = t;
      const rounded = Math.round(t * 10) / 10;
      if (rounded === lastEmitted) return;
      if (lastTime != null && Math.abs(t - lastTime) > 1.5) onUserSeekRef.current?.(t);
      lastTime = t;
      lastEmitted = rounded;
      onTimeUpdateRef.current?.(t);
    };
    const listen = () => {
      postToPlayer(iframe, { event: "listening" });
      postToPlayer(iframe, { event: "command", func: "addEventListener", args: ["onReady"] });
      postToPlayer(iframe, { event: "command", func: "addEventListener", args: ["onStateChange"] });
    };
    const onMessage = (event) => {
      if (event.source !== iframe.contentWindow) return;
      let data = event.data;
      if (typeof data === "string") {
        try { data = JSON.parse(data); } catch { return; }
      }
      const info = data?.info;
      if (typeof info?.playerState === "number") {
        stateRef.current = info.playerState;
        if (cueAutoplayRef.current && info.playerState === 0 && Number.isFinite(Number(autoPlayFromRef.current))) {
          postToPlayer(iframe, { event: "command", func: "seekTo", args: [Number(autoPlayFromRef.current), true] });
          postToPlayer(iframe, { event: "command", func: "playVideo", args: [] });
        }
      }
      if (typeof info?.currentTime === "number") emit(info.currentTime);
    };
    iframe.addEventListener("load", listen);
    window.addEventListener("message", onMessage);
    return () => {
      iframe.removeEventListener("load", listen);
      window.removeEventListener("message", onMessage);
    };
  }, [src]);

  useImperativeHandle(ref, () => ({
    getVideoElement() { return null; },
    getCurrentTime() { return timeRef.current; },
    isPlaying() { return stateRef.current === 1 || stateRef.current === 3; },
    seek(sec) {
      if (!Number.isFinite(sec)) return;
      timeRef.current = sec;
      postToPlayer(iframeRef.current, { event: "command", func: "seekTo", args: [sec, true] });
      onTimeUpdateRef.current?.(sec);
    },
    play(sec) {
      if (Number.isFinite(sec)) {
        timeRef.current = sec;
        postToPlayer(iframeRef.current, { event: "command", func: "seekTo", args: [sec, true] });
        onTimeUpdateRef.current?.(sec);
      }
      postToPlayer(iframeRef.current, { event: "command", func: "playVideo", args: [] });
    },
    pause(sec) {
      if (Number.isFinite(sec)) {
        timeRef.current = sec;
        postToPlayer(iframeRef.current, { event: "command", func: "seekTo", args: [sec, true] });
      }
      postToPlayer(iframeRef.current, { event: "command", func: "pauseVideo", args: [] });
    },
    pauseOnly() {
      postToPlayer(iframeRef.current, { event: "command", func: "pauseVideo", args: [] });
    },
    playOnly() {
      postToPlayer(iframeRef.current, { event: "command", func: "playVideo", args: [] });
    },
  }), [embed]);

  if (!embed) return null;

  return (
    <div className={className}>
      <div className="relative w-full overflow-hidden rounded-2xl border border-border bg-black" style={{ aspectRatio: "16 / 9" }}>
        <iframe
          key={src}
          id={`lc-yt-${embed.videoId}`}
          ref={iframeRef}
          title="YouTube video player"
          className="absolute inset-0 h-full w-full border-0"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          src={src}
        />
      </div>
    </div>
  );
});

export default YouTubePlayer;
