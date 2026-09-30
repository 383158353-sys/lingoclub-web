import React, { useEffect, useRef, useState } from "react";

// 纯净「马赛克」遮挡方块：无任何按钮，本体即一块半透明马赛克。
// 可在视频区域内拖动移动；右下角内缩的细角标可拖拽调整长宽，仅在悬停时
// 显现。无关闭按钮——通过视频下方工具栏的「字幕遮挡」开关统一移除。
// 外层 pointer-events:none，仅方块本体接收事件，不挡视频其余区域。
export default function SubtitleMask() {
  const wrapRef = useRef(null);
  const [rect, setRect] = useState({ x: 0, y: 0, w: 220, h: 30 });
  const [hover, setHover] = useState(false);

  const clamp = (r) => {
    const W = wrapRef.current?.clientWidth || 9999;
    const H = wrapRef.current?.clientHeight || 9999;
    const w = Math.max(72, Math.min(r.w, W));
    const h = Math.max(24, Math.min(r.h, H));
    const x = Math.max(0, Math.min(r.x, W - w));
    const y = Math.max(0, Math.min(r.y, H - h));
    return { x, y, w, h };
  };

  // 默认遮在硬字幕常见位置：水平居中、位于画面下三分之一偏下处
  // (约离底部 1/4、略高于播放器底栏)，窄长条形，仅盖住一两行字幕。
  useEffect(() => {
    const W = wrapRef.current?.clientWidth || 320;
    const H = wrapRef.current?.clientHeight || 180;
    const w = Math.round(W * 0.5);
    setRect(clamp({
      x: Math.round((W - w) / 2),
      y: Math.round(H * 0.74),
      w,
      h: Math.max(26, Math.round(H * 0.07)),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startMove = (e) => {
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const start = { ...rect };
    const move = (ev) => setRect(clamp({ ...start, x: start.x + (ev.clientX - sx), y: start.y + (ev.clientY - sy) }));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startResize = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY;
    const start = { ...rect };
    const move = (ev) => setRect(clamp({ ...start, w: start.w + (ev.clientX - sx), h: start.h + (ev.clientY - sy) }));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div ref={wrapRef} className="absolute inset-0 z-30" style={{ pointerEvents: "none" }}>
      <div
        className="absolute select-none"
        style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, pointerEvents: "auto", cursor: "move", touchAction: "none" }}
        onPointerDown={startMove}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        {/* 半透明磨砂玻璃：弱化黑度、加重模糊，让方块只盖住字幕而与画面更自然融合 */}
        <div
          className="absolute inset-0 rounded-md"
          style={{
            backgroundColor: "rgba(8,6,4,0.34)",
            backdropFilter: "blur(14px) saturate(120%)",
            WebkitBackdropFilter: "blur(14px) saturate(120%)",
            boxShadow: "0 1px 6px rgba(0,0,0,0.22)",
          }}
        />
        {/* 右下角细角标：仅悬停时显现，拖动调整大小；无圆形按钮 */}
        <div
          onPointerDown={startResize}
          title="拖动调整大小"
          className="absolute -bottom-0.5 -right-0.5 h-3 w-3 cursor-nwse-resize"
          style={{
            opacity: hover ? 1 : 0,
            transition: "opacity 160ms ease",
            borderRight: "2px solid rgba(255,255,255,0.55)",
            borderBottom: "2px solid rgba(255,255,255,0.55)",
          }}
        />
      </div>
    </div>
  );
}