import React, { useMemo, forwardRef } from "react";
import YouTubePlayer from "./players/YouTubePlayer";
import BilibiliPlayer from "./players/BilibiliPlayer";
import NativeVideoPlayer from "./players/NativeVideoPlayer";

/**
 * 视频播放器调度器：根据 URL 类型选择对应的独立播放器组件。
 *
 * 三种播放器完全独立运行，各自管理自己的嵌入/播放/暂停/跳转逻辑：
 *   · YouTube  → YouTubePlayer.jsx（IFrame Player API）
 *   · B站      → BilibiliPlayer.jsx（iframe 重载模拟 seek/play/pause）
 *   · 本地文件  → NativeVideoPlayer.jsx（原生 <video>）
 *
 * 调度器仅做类型检测和组件选择，不包含任何播放逻辑。
 * 修改某一侧的播放器不会影响其他两侧。
 */

function detectType(url) {
  if (!url) return "native";
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");
    if (host === "b23.tv") return "bilibili";
    if (host.endsWith("bilibili.com") && u.pathname.match(/\/video\/(BV[\w]+|av\d+)/i)) return "bilibili";
    if (host === "youtu.be" || host.endsWith("youtube.com") || host === "i.ytimg.com" || host === "img.youtube.com") return "youtube";
    return "native";
  } catch {
    return "native";
  }
}

const VideoPlayer = forwardRef(function VideoPlayer({ url, className = "", onTimeUpdate, onPlaybackError, onUserSeek, autoPlayFrom, controls = true }, ref) {
  const type = useMemo(() => detectType(url), [url]);

  if (type === "youtube") {
    return <YouTubePlayer ref={ref} url={url} className={className} onTimeUpdate={onTimeUpdate} onUserSeek={onUserSeek} autoPlayFrom={autoPlayFrom} />;
  }

  if (type === "bilibili") {
    return <BilibiliPlayer ref={ref} url={url} className={className} onUserSeek={onUserSeek} />;
  }

  return <NativeVideoPlayer ref={ref} url={url} className={className} onTimeUpdate={onTimeUpdate} onPlaybackError={onPlaybackError} onSeeking={onUserSeek} autoPlayFrom={autoPlayFrom} controls={controls} />;
});

export default VideoPlayer;
