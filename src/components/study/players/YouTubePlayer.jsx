import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle, useMemo } from "react";
import { checkYouTubeEmbeddable, createYouTubeCueAutoplayVars, createYouTubeEmbedUrl, createYouTubePlayerVars, describeYouTubeEmbedError } from "@/lib/youtubePlayerConfig";

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

const YouTubePlayer = forwardRef(function YouTubePlayer({ url, className = "", onTimeUpdate, onUserSeek, autoPlayFrom, cueAutoplay = false }, ref) {
  const embed = useMemo(() => parseYouTube(url), [url]);
  const [playerErrorCode, setPlayerErrorCode] = useState(null);
  const [embedUnavailable, setEmbedUnavailable] = useState(false);
  const [embeddable, setEmbeddable] = useState(null);
  const [gestureNeeded, setGestureNeeded] = useState(false);

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
  const cueAutoplayRef = useRef(cueAutoplay);
  cueAutoplayRef.current = cueAutoplay;
  const unmutedRef = useRef(false);
  const lastClockRef = useRef({ time: null, at: 0 });
  const suppressSeekDetectionUntilRef = useRef(0);

  useEffect(() => {
    if (!embed?.videoId) return;
    setPlayerErrorCode(null);
    setEmbedUnavailable(false);
    setEmbeddable(null);
    let cancelled = false;
    const host = ytHostRef.current;
    if (!host) return;
    const mount = document.createElement("div");
    mount.style.width = "100%";
    mount.style.height = "100%";
    host.innerHTML = "";
    host.appendChild(mount);

    const origin = typeof window !== "undefined" ? window.location.origin : undefined;
    const cueStart = autoPlayFromRef.current;
    const cuePlayback = cueAutoplayRef.current && Number.isFinite(cueStart);
    const playerVars = cuePlayback ? createYouTubeCueAutoplayVars(origin, cueStart) : createYouTubePlayerVars(origin);
    unmutedRef.current = false;
    if (cuePlayback) setGestureNeeded(false);

    const armCuePlayback = (player) => {
      if (!cuePlayback || !player) return;
      try { player.mute?.(); } catch { /* noop */ }
      if (Number.isFinite(cueStart)) {
        try { player.seekTo?.(cueStart, true); } catch { /* noop */ }
      }
      try { player.playVideo?.(); } catch { /* autoplay may still be blocked */ }
    };

    const revealGesture = () => {
      if (!cancelled && cuePlayback) setGestureNeeded(true);
    };

    // Fallback: if YT IFrame API doesn't load within 6s, inject a plain iframe (enablejsapi=1).
    // When the API arrives later we attach YT.Player to THIS iframe, so time sync, highlight and
    // the playing-state check keep working (previously the player bound to a detached node).
    let fallbackIframe = null;
    const fallbackTimer = setTimeout(() => {
      if (cancelled || ytPlayerRef.current) return;
      host.innerHTML = "";
      const iframe = document.createElement("iframe");
      iframe.src = createYouTubeEmbedUrl(embed.videoId, origin, cuePlayback ? { autoplay: true, start: cueStart, mute: true } : undefined);
      iframe.style.cssText = "width:100%;height:100%;border:0";
      iframe.allow = "autoplay; fullscreen; encrypted-media";
      iframe.referrerPolicy = "strict-origin-when-cross-origin";
      iframe.title = "YouTube video player";
      iframe.setAttribute("allowfullscreen", "");
      host.appendChild(iframe);
      fallbackIframe = iframe;
    }, 6000);
    const gestureTimer = setTimeout(() => {
      if (cancelled || !cuePlayback) return;
      const state = ytPlayerRef.current?.getPlayerState?.();
      if (state !== 1 && state !== 3) setGestureNeeded(true);
    }, 1500);
    const availabilityTimer = setTimeout(() => {
      const state = ytPlayerRef.current?.getPlayerState?.();
      const t = lastClockRef.current.time;
      if (!cancelled && state !== 1 && state !== 3 && !(t > 0)) setEmbedUnavailable(true);
    }, 12000);

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
      const target = fallbackIframe && fallbackIframe.isConnected ? fallbackIframe : mount;
      ytPlayerRef.current = new window.YT.Player(target, {
        ...(target === mount ? { videoId: embed.videoId, width: "100%", height: "100%", playerVars } : {}),
        events: {
          onReady: (e) => {
            if (cancelled) return;
            try {
              const frame = e.target.getIframe?.();
              if (frame) frame.setAttribute("allow", "autoplay; fullscreen; encrypted-media; picture-in-picture");
            } catch { /* noop */ }
            if (cuePlayback) {
              armCuePlayback(e.target);
              ytPendingPlay.current = false;
              return;
            }
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
            if (e.data === 1 || e.data === 3) { setEmbedUnavailable(false); setPlayerErrorCode(null); }
            if (cuePlayback && e.data === 1) {
              setGestureNeeded(false);
              if (!unmutedRef.current) {
                unmutedRef.current = true;
                try { e.target.unMute?.(); e.target.setVolume?.(100); } catch { /* iOS may ignore unmute until a tap */ }
                const player = e.target;
                setTimeout(() => {
                  if (cancelled) return;
                  let stillMuted = false;
                  try { stillMuted = Boolean(player.isMuted?.()); } catch { stillMuted = false; }
                  if (stillMuted) setGestureNeeded(true);
                }, 500);
              }
            }
            // 1=playing, 2=paused, 3=buffering → emit time for snappy scrub feedback
            if (e.data === 1 || e.data === 2 || e.data === 3) {
              try { emit(e.target.getCurrentTime()); } catch { /* noop */ }
            }
          },
          onAutoplayBlocked: () => revealGesture(),
          onError: (e) => {
            const code = Number(e?.data) || 0;
            setPlayerErrorCode(code);
            if (host) host.dataset.ytError = String(code);
            console.info("[YouTubePlayer] embedded playback error", { code, videoId: embed.videoId, origin });
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
        // Time is advancing → the embed is really playing; drop any stale "unavailable" warning.
        if (previous.time != null && time > previous.time + 0.05) { setEmbedUnavailable(false); setPlayerErrorCode(null); }
        lastClockRef.current = { time, at: now };
        emit(time);
      } catch { /* not ready */ }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(fallbackTimer);
      clearTimeout(gestureTimer);
      clearTimeout(availabilityTimer);
      if (ytTickRef.current) { clearInterval(ytTickRef.current); ytTickRef.current = null; }
      try { ytPlayerRef.current?.destroy?.(); } catch { /* noop */ }
      ytPlayerRef.current = null;
      lastEmittedRef.current = -1;
      lastClockRef.current = { time: null, at: 0 };
      if (host) host.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embed?.videoId]);

  // 101/150 is ambiguous (embedding disabled vs. YouTube bot check on this
  // network); ask oEmbed once so the message says which one it is.
  useEffect(() => {
    if (!embed?.videoId || (playerErrorCode !== 101 && playerErrorCode !== 150)) return undefined;
    let active = true;
    checkYouTubeEmbeddable(embed.videoId).then((value) => { if (active) setEmbeddable(value); });
    return () => { active = false; };
  }, [embed?.videoId, playerErrorCode]);

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
      try {
        if (cueAutoplayRef.current) { player.unMute?.(); player.setVolume?.(100); }
        if (Number.isFinite(sec)) player.seekTo?.(sec, true);
        player.playVideo?.();
      } catch { /* noop */ }
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
        {gestureNeeded && (
          <button
            type="button"
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/45 text-sm font-medium text-background touch-manipulation [-webkit-tap-highlight-color:transparent]"
            onClick={() => {
              const player = ytPlayerRef.current;
              const startAt = autoPlayFromRef.current;
              try {
                if (Number.isFinite(startAt)) player?.seekTo?.(startAt, true);
                player?.unMute?.();
                player?.setVolume?.(100);
                player?.playVideo?.();
              } catch { /* the next tap can retry */ }
              setGestureNeeded(false);
            }}
          >
            <span className="rounded-full bg-mint px-4 py-2.5">播放原句</span>
          </button>
        )}
      </div>
      {(playerErrorCode !== null || embedUnavailable) && <p role="status" className="mt-2 text-xs text-amber-300/90">
        {describeYouTubeEmbedError(playerErrorCode, embeddable)}
        {" "}<a href={`https://www.youtube.com/watch?v=${embed.videoId}`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">在 YouTube 打开</a>
      </p>}
    </div>
  );
});

export default YouTubePlayer;
