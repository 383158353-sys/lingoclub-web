import React, { forwardRef, useRef, useImperativeHandle } from "react";

/**
 * 原生视频播放器：处理本地文件（MP4 / WebM / MOV 等）。
 * 完全独立，不依赖 YouTube / B站 逻辑。
 */
const NativeVideoPlayer = forwardRef(function NativeVideoPlayer({ url, className = "", onTimeUpdate, onPlaybackError, onSeeking, autoPlayFrom, controls = true }, ref) {
  const videoRef = useRef(null);

  useImperativeHandle(ref, () => ({
    getVideoElement() { return videoRef.current; },
    getCurrentTime() { return videoRef.current?.currentTime ?? null; },
    isPlaying() { return Boolean(videoRef.current && !videoRef.current.paused && !videoRef.current.ended); },
    seek(sec) {
      if (!Number.isFinite(sec)) return;
      const v = videoRef.current;
      if (v) { try { v.currentTime = sec; } catch { /* not seekable yet */ } }
    },
    play(sec) {
      const v = videoRef.current;
      if (!v) return;
      if (Number.isFinite(sec)) { try { v.currentTime = sec; } catch { /* noop */ } }
      try { v.play?.(); } catch { /* noop */ }
    },
    pause(sec) {
      const v = videoRef.current;
      if (!v) return;
      if (Number.isFinite(sec)) { try { v.currentTime = sec; } catch { /* noop */ } }
      try { v.pause?.(); } catch { /* noop */ }
    },
    pauseOnly() {
      const v = videoRef.current;
      if (v) { try { v.pause?.(); } catch { /* noop */ } }
    },
    playOnly() {
      const v = videoRef.current;
      if (v) { try { v.play?.(); } catch { /* noop */ } }
    },
  }), []);

  return (
    <video
      ref={videoRef}
      src={url}
      controls={controls}
      playsInline
      onLoadedMetadata={(event) => {
        if (!Number.isFinite(autoPlayFrom)) return;
        const video = event.currentTarget;
        try { video.currentTime = autoPlayFrom; } catch { /* browser may not be seekable yet */ }
        const playResult = video.play?.();
        playResult?.catch?.(() => {});
      }}
      onTimeUpdate={onTimeUpdate ? (e) => onTimeUpdate(e.currentTarget.currentTime) : undefined}
      onSeeking={onSeeking ? (e) => onSeeking(e.currentTarget.currentTime) : undefined}
      onError={onPlaybackError ? () => onPlaybackError(url) : undefined}
      className={`w-full rounded-2xl border border-border bg-black ${className}`}
      style={{ aspectRatio: "auto 16 / 9" }}
    />
  );
});

export default NativeVideoPlayer;
