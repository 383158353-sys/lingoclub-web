import React, { useMemo, forwardRef, useImperativeHandle, useState, useEffect, useRef } from "react";
import { Play, Pause, Info } from "lucide-react";
import { fromSec } from "@/lib/timecode";

/**
 * B站内嵌播放器：
 *
 * 嵌入 player.bilibili.com 的 iframe，B站视频在本页面内直接播放。
 * 由于跨域无法读取 B站 iframe 内部的 <video> 元素，本组件维护一个
 * 「仿真时钟」——播放时每秒自增，seek/play/pause 通过重载 iframe（?t= 参数）对齐。
 * 同时监听 B站播放器的 postMessage（如可用则获取真实进度，替代仿真）。
 *
 * onTimeUpdate(simTime) 每秒回调，驱动外部字幕高亮。
 */
function parseBvid(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "b23.tv") return { short: true };
    if (host.endsWith("bilibili.com")) {
      const m = u.pathname.match(/\/video\/(BV[\w]+|av\d+)/i);
      if (m) {
        const id = m[1];
        const page = parseInt(u.searchParams.get("p") || "1", 10) || 1;
        return { id, page };
      }
    }
    return null;
  } catch {
    return null;
  }
}

function buildPlayerUrl(info, t, autoplay) {
  if (!info) return "";
  let s = `https://player.bilibili.com/player.html?bvid=${info.id}&page=${info.page}&danmaku=0&high_quality=1&autoplay=${autoplay ? 1 : 0}&as_wide=1`;
  if (Number.isFinite(t) && t > 0) s += `&t=${Math.floor(t)}`;
  return s;
}

const BilibiliPlayer = forwardRef(function BilibiliPlayer({ url, onTimeUpdate, onPlaybackError, onUserSeek, className = "" }, ref) {
  const info = useMemo(() => parseBvid(url), [url]);
  const [simTime, setSimTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [running, setRunning] = useState(false);
  const [seekT, setSeekT] = useState(0);
  const [iframeKey, setIframeKey] = useState(0);
  const lastClockRef = useRef({ time: null, at: 0 });
  const suppressSeekDetectionUntilRef = useRef(0);
  const onUserSeekRef = useRef(onUserSeek);
  onUserSeekRef.current = onUserSeek;

  // 从 B站 API 获取视频时长
  useEffect(() => {
    if (!info?.id) return;
    let cancelled = false;
    fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${info.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.data?.duration) setDuration(data.data.duration);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [info?.id]);

  // 仿真时钟
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setSimTime((t) => (duration > 0 ? Math.min(t + 1, duration) : t + 1));
    }, 1000);
    return () => clearInterval(id);
  }, [running, duration]);

  // 回调外部
  useEffect(() => {
    if (onTimeUpdate) onTimeUpdate(simTime);
  }, [simTime, onTimeUpdate]);

  // 监听 B站播放器 postMessage（如可用则获取真实进度）
  useEffect(() => {
    const handler = (event) => {
      const d = event.data;
      if (!d || typeof d !== "object") return;
      if (typeof d.currentTime === "number") {
        const now = Date.now();
        const previous = lastClockRef.current;
        const elapsed = previous.at ? (now - previous.at) / 1000 : 0;
        if (previous.time != null && Math.abs(d.currentTime - previous.time) > Math.max(2, elapsed * 4 + 0.75) && now >= suppressSeekDetectionUntilRef.current) {
          onUserSeekRef.current?.(d.currentTime);
        }
        lastClockRef.current = { time: d.currentTime, at: now };
        setSimTime(d.currentTime);
      }
      if (typeof d.duration === "number" && d.duration > 0) setDuration(d.duration);
      if (d.type === "playerStateChange" && d.data) {
        const st = typeof d.data.state === "string" ? d.data.state : typeof d.data === "string" ? d.data : "";
        if (/play/i.test(st)) setRunning(true);
        if (/pause/i.test(st)) setRunning(false);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const reloadAt = (t, autoplay) => {
    suppressSeekDetectionUntilRef.current = Date.now() + 900;
    setSeekT(t);
    setSimTime(t);
    setIframeKey((k) => k + 1);
    setRunning(autoplay);
  };

  useImperativeHandle(ref, () => ({
    getVideoElement() { return null; },
    getCurrentTime() { return simTime; },
    isPlaying() { return running; },
    seek(sec) { if (Number.isFinite(sec)) reloadAt(sec, false); },
    play(sec) {
      if (Number.isFinite(sec)) reloadAt(sec, true);
      else { setSeekT(simTime); setIframeKey((k) => k + 1); setRunning(true); }
    },
    pause() { setRunning(false); },
    pauseOnly() { setRunning(false); },
    playOnly() { setRunning(true); },
  }), [simTime, running]);

  if (info?.short) {
    return (
      <div className={`flex items-center justify-center rounded-2xl border border-dashed border-border bg-background-elev/30 p-10 text-center text-sm text-muted-foreground ${className}`}>
        请粘贴完整的 bilibili.com 视频链接（含 BV 号），暂不支持 b23.tv 短链。
      </div>
    );
  }

  if (!info) return null;

  const playerUrl = buildPlayerUrl(info, seekT, running);

  return (
    <div className={className}>
      <div className="relative overflow-hidden rounded-xl border border-border bg-black" style={{ aspectRatio: "16 / 9" }}>
        <iframe
          key={iframeKey}
          src={playerUrl}
          className="absolute inset-0 h-full w-full"
          scrolling="no"
          frameBorder="0"
          allowFullScreen
          allow="autoplay; fullscreen; picture-in-picture"
        />
      </div>
    </div>
  );
});

export default BilibiliPlayer;
