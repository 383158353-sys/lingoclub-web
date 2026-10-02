import React, { useRef, useEffect, forwardRef, useImperativeHandle, useMemo } from "react";

/**
 * YouTube 播放器：通过 IFrame Player API 嵌入。
 * 完全独立，不依赖 B站 / 原生视频逻辑。
 *
 * 进度同步：轮询 getCurrentTime() 喂给 onTimeUpdate，使页面字幕绑定真实进度条。
 * 播放/暂停/跳转：通过 YT API 的 playVideo / pauseVideo / seekTo 实现。
 */

let ytApiPromise = null;
function loadYTApi() {
  if (typeof window !== "undefined" && window.YT && window.YT.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
  return ytApiPromise;
}

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

const YouTubePlayer = forwardRef(function YouTubePlayer({ url, className = "", onTimeUpdate, onUserSeek, autoPlayFrom }, ref) {
  const embed = useMemo(() => parseYouTube(url), [url]);

  // Host container React owns but renders NO JSX children into — so React never
  // tries to reconcile the iframe the YT API injects/destroys inside it.
  const ytHostRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const ytTickRef = useRef(null);
  const ytPendingSeek = useRef(null);
  const ytPendingPlay = useRef(false);
  const lastEmittedRef = useRef(-1);

  // 用 ref 保存 onTimeUpdate，避免它出现在 useEffect 依赖数组中导致
  // YouTube 播放器被反复销毁重建（黑屏）。
  const onTimeUpdateRef = useRef(onTimeUpdate);
  onTimeUpdateRef.current = onTimeUpdate;
  const onUserSeekRef = useRef(onUserSeek);
  onUserSeekRef.current = onUserSeek;
  const autoPlayFromRef = useRef(autoPlayFrom);
  autoPlayFromRef.current = autoPlayFrom;
  const lastClockRef = useRef({ time: null, at: 0 });
  const suppressSeekDetectionUntilRef = useRef(0);

  useEffect(() => {
    if (!embed?.videoId) return;
    let cancelled = false;
    const host = ytHostRef.current;
    if (!host) return;
    const mount = document.createElement("div");
    mount.style.width = "100%";
    mount.style.height = "100%";
    host.innerHTML = "";
    host.appendChild(mount);

    const origin = typeof window !== "undefined" ? window.location.origin : undefined;

    // Fallback: if YT IFrame API doesn't load within 6s, inject a plain iframe.
    const fallbackTimer = setTimeout(() => {
      if (cancelled || ytPlayerRef.current) return;
      host.innerHTML = "";
      const iframe = document.createElement("iframe");
      const params = new URLSearchParams({ rel: "0", modestbranding: "1", playsinline: "1", enablejsapi: "1" });
      if (origin) params.set("origin", origin);
      iframe.src = `https://www.youtube.com/embed/${embed.videoId}?${params}`;
      iframe.style.cssText = "width:100%;height:100%;border:0";
      iframe.allow = "autoplay; fullscreen; encrypted-media";
      iframe.setAttribute("allowfullscreen", "");
      host.appendChild(iframe);
    }, 6000);

    const emit = (t) => {
      if (typeof t !== "number" || Number.isNaN(t)) return;
      const r = Math.round(t * 10) / 10;
      if (r !== lastEmittedRef.current) {
        lastEmittedRef.current = r;
        if (onTimeUpdateRef.current) onTimeUpdateRef.current(t);
      }
    };

    loadYTApi().then(() => {
      if (cancelled) return;
      try { ytPlayerRef.current?.destroy?.(); } catch { /* noop */ }
      ytPlayerRef.current = new window.YT.Player(mount, {
        videoId: embed.videoId,
        width: "100%",
        height: "100%",
        playerVars: { rel: 0, modestbranding: 1, autoplay: 0, playsinline: 1, origin },
        events: {
          onReady: (e) => {
            if (cancelled) return;
            if (Number.isFinite(autoPlayFromRef.current)) {
              try { e.target.seekTo(autoPlayFromRef.current, true); } catch { /* noop */ }
              try { e.target.playVideo(); } catch { /* autoplay may be blocked by the browser */ }
              ytPendingPlay.current = false;
              return;
            }
            if (Number.isFinite(ytPendingSeek.current)) {
              try { e.target.seekTo(ytPendingSeek.current, true); } catch { /* noop */ }
              ytPendingSeek.current = null;
            }
            if (ytPendingPlay.current) {
              try { e.target.playVideo(); } catch { /* autoplay may be blocked by the browser */ }
              ytPendingPlay.current = false;
            }
          },
          onStateChange: (e) => {
            // 1=playing, 2=paused, 3=buffering → emit time for snappy scrub feedback
            if (e.data === 1 || e.data === 2 || e.data === 3) {
              try { emit(e.target.getCurrentTime()); } catch { /* noop */ }
            }
          },
          onError: (e) => {
            if (host) host.dataset.ytError = String(e.data);
          },
        },
      });
    });

    ytTickRef.current = setInterval(() => {
      const p = ytPlayerRef.current;
      if (!p || typeof p.getCurrentTime !== "function") return;
      try {
        const time = p.getCurrentTime();
        const now = Date.now();
        const previous = lastClockRef.current;
        const elapsed = previous.at ? (now - previous.at) / 1000 : 0;
        const jumpThreshold = Math.max(1.5, elapsed * 4 + 0.75);
        if (previous.time != null && Math.abs(time - previous.time) > jumpThreshold && now >= suppressSeekDetectionUntilRef.current) {
          onUserSeekRef.current?.(time);
        }
        lastClockRef.current = { time, at: now };
        emit(time);
      } catch { /* not ready */ }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(fallbackTimer);
      if (ytTickRef.current) { clearInterval(ytTickRef.current); ytTickRef.current = null; }
      try { ytPlayerRef.current?.destroy?.(); } catch { /* noop */ }
      ytPlayerRef.current = null;
      lastEmittedRef.current = -1;
      lastClockRef.current = { time: null, at: 0 };
      if (host) host.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embed?.videoId]);

  useImperativeHandle(ref, () => ({
    getVideoElement() { return null; },
    getCurrentTime() { try { return ytPlayerRef.current?.getCurrentTime?.() ?? null; } catch { return null; } },
    isPlaying() { try { const state = ytPlayerRef.current?.getPlayerState?.(); return state === 1 || state === 3; } catch { return false; } },
    seek(sec) {
      if (!Number.isFinite(sec)) return;
      suppressSeekDetectionUntilRef.current = Date.now() + 900;
      const p = ytPlayerRef.current;
      if (p && typeof p.seekTo === "function") {
        try { p.seekTo(sec, true); if (onTimeUpdateRef.current) onTimeUpdateRef.current(sec); } catch { /* noop */ }
      } else {
        ytPendingSeek.current = sec;
      }
    },
    play(sec) {
      if (Number.isFinite(sec)) suppressSeekDetectionUntilRef.current = Date.now() + 900;
      const player = ytPlayerRef.current;
      if (!player) {
        if (Number.isFinite(sec)) ytPendingSeek.current = sec;
        ytPendingPlay.current = true;
        return;
      }
      try { if (Number.isFinite(sec)) player.seekTo?.(sec, true); player.playVideo?.(); } catch { /* noop */ }
    },
    pause(sec) {
      const t = Number.isFinite(sec) ? sec : 0;
      if (Number.isFinite(sec)) suppressSeekDetectionUntilRef.current = Date.now() + 900;
      try { ytPlayerRef.current?.seekTo?.(t, true); } catch { /* noop */ }
      try { ytPlayerRef.current?.pauseVideo?.(); } catch { /* noop */ }
    },
    pauseOnly() {
      try { ytPlayerRef.current?.pauseVideo?.(); } catch { /* noop */ }
    },
    playOnly() {
      try { ytPlayerRef.current?.playVideo?.(); } catch { /* noop */ }
    },
  }), [embed]);

  if (!embed) return null;

  return (
    <div className={className}>
      <div className="relative w-full overflow-hidden rounded-2xl border border-border bg-black" style={{ aspectRatio: "16 / 9" }}>
        <div ref={ytHostRef} className="absolute inset-0 h-full w-full" />
      </div>
    </div>
  );
});

export default YouTubePlayer;
