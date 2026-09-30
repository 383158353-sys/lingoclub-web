import React, { useState, useEffect, useRef, useCallback } from "react";
import { BookOpen, ListVideo, Captions, X as XIcon } from "lucide-react";
import StudyWorkspace from "./StudyWorkspace";

// 全屏沉浸模式：所有悬浮控制统一在右侧竖条（靠近右侧边缘出现）：
//   · 精读开关
//   · 台词列表开关
//   · 字幕开关（与台词列表可同时开启或关闭）
//   · 退出
// 字幕方框：按住背景拖拽移动，右侧唯一拖拽按钮调节大小长宽（自动匹配显示整句），
//   精读按钮与字幕列表精读功能相同。
export default function TheaterOverlay({
  videoSlot,
  analysisSlot,
  subtitleSlot,
  minimalSubSlot,
  hasSubs = false,
  canPlay = false,
  onClose,
  storagePrefix = "theater",
}) {
  const [showAnalysis, setShowAnalysis] = useState(true);
  const [showScrubber, setShowScrubber] = useState(true);
  const [showMinimalSub, setShowMinimalSub] = useState(false);
  const [hoverZone, setHoverZone] = useState(false);
  const hideTimerRef = useRef(null);
  const zoneRef = useRef(false);

  // 鼠标位置判定：靠近右侧边缘时显示控制条
  const onMouseMove = useCallback((e) => {
    const x = e.clientX / window.innerWidth;
    const near = x > 0.82;
    if (near !== zoneRef.current) {
      zoneRef.current = near;
      setHoverZone(near);
    }
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (!near) {
      hideTimerRef.current = setTimeout(() => setHoverZone(false), 800);
    }
  }, []);

  useEffect(() => {
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
  }, []);

  const minSubOn = showMinimalSub && canPlay && hasSubs;
  const videoWithMin = (
    <div className="relative min-h-0">
      {videoSlot}
      {minSubOn && minimalSubSlot && React.cloneElement(minimalSubSlot, {
        onToggleAnalysis: () => setShowAnalysis((v) => !v),
        analysisOn: showAnalysis,
      })}
    </div>
  );

  const pillBtn = (on, onClick, Icon, label, disabled) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex w-full items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        on ? "bg-copper text-copper-foreground" : "text-white/70 hover:text-white hover:bg-white/10"
      }`}
    >
      <Icon size={14} /> {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[300] bg-background" onMouseMove={onMouseMove}>
      {/* 主体布局：始终用 StudyWorkspace，切换精读/台词时不卸载 VideoPlayer */}
      <div className="absolute inset-0 p-3">
        <StudyWorkspace
          landscape
          videoSlot={videoWithMin}
          subtitleSlot={showScrubber ? subtitleSlot : null}
          analysisSlot={showAnalysis ? analysisSlot : null}
        />
      </div>

      {/* 右侧统一控制条：所有按钮集中于此 */}
      <div
        className={`absolute right-3 top-1/2 z-[325] flex -translate-y-1/2 flex-col items-stretch gap-2 rounded-2xl glass px-2.5 py-3 transition-all duration-300 ${
          hoverZone ? "opacity-100" : "pointer-events-none translate-x-4 opacity-0"
        }`}
      >
        {pillBtn(showAnalysis, () => setShowAnalysis((v) => !v), BookOpen, "精读")}
        {pillBtn(showScrubber, () => setShowScrubber((v) => !v), ListVideo, "台词")}
        {pillBtn(showMinimalSub, () => setShowMinimalSub((v) => !v), Captions, "字幕")}
        <span className="my-0.5 h-px w-full bg-border/60" />
        <button
          type="button"
          onClick={onClose}
          className="inline-flex w-full items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium text-white/70 hover:text-white hover:bg-white/10"
        >
          <XIcon size={14} /> 退出
        </button>
      </div>
    </div>
  );
}