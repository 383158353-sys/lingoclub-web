import React, { useRef, useCallback } from "react";

// 放在台词滚动列表顶部的拖动条，用来「拉长 / 收缩」列表的纵向高度。
// 拖动点向上 → 列表变高（列表往上延伸，视频自适应缩小）；向下 → 列表变矮。
// 高度（px）由父组件持久化，本组件只负责即时计算与回调。
export default function SubListResizer({ height = 256, onChange, minH = 140, maxH = 640, className = "" }) {
  const dragRef = useRef({ startY: 0, startH: height });

  const onPointerDown = useCallback((e) => {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    dragRef.current = { startY: e.clientY, startH: height };
  }, [height]);

  const onPointerMove = useCallback((e) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const delta = dragRef.current.startY - e.clientY; // 向上拖 → 列表变高
    const next = Math.max(minH, Math.min(maxH, Math.round(dragRef.current.startH + delta)));
    onChange?.(next);
  }, [onChange, minH, maxH]);

  const onPointerUp = useCallback((e) => {
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  }, []);

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="拖动以拉长或收缩台词列表"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      title="向上拖扩大 / 向下拖缩小台词列表"
      className={`group flex h-4 w-full cursor-row-resize touch-none items-center justify-center ${className}`}
    >
      <span className="h-[2px] w-12 rounded-full bg-border/70 transition-colors group-hover:bg-mint/80 group-active:bg-mint" />
    </div>
  );
}