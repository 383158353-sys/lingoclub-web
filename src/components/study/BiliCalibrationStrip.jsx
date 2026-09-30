import React, { useRef, useState, useEffect } from "react";
import { Check, X } from "lucide-react";

// 校准浮层只占视频底部一条窄带（B 站进度条所在区域），视频其余部分不被遮挡；
// 两根标线细且半透明，用户可透过标尺看清 B 站真实进度条端点来对齐宽度。几何
// 存 localStorage，供本站进度条等宽渲染。
export default function BiliCalibrationStrip({ initial, onConfirm, onCancel }) {
  const stripRef = useRef(null);
  const [startPct, setStartPct] = useState(initial?.startPct ?? 0.08);
  const [endPct, setEndPct] = useState(initial?.endPct ?? 0.88);
  const drag = useRef(null);

  const apply = (clientX) => {
    const el = stripRef.current;
    if (!el || !drag.current) return;
    const rect = el.getBoundingClientRect();
    let p = (clientX - rect.left) / rect.width;
    p = Math.max(0, Math.min(1, p));
    if (drag.current === "start") setStartPct((e) => Math.min(p, endPct - 0.02));
    else setEndPct((s) => Math.max(p, startPct + 0.02));
  };
  useEffect(() => {
    const move = (e) => apply(e.clientX);
    const up = () => { drag.current = null; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [startPct, endPct]);

  const Handle = ({ which, pct }) => (
    <div
      onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); drag.current = which; }}
      className="absolute inset-y-0 z-30 flex w-10 -translate-x-1/2 cursor-ew-resize items-center justify-center touch-none"
      style={{ left: `${(pct * 100).toFixed(2)}%` }}
    >
      <div className="h-full w-px bg-mint/70 shadow-[0_0_4px_hsl(var(--mint))]" />
      <div className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border border-mint/70 bg-background/30" />
    </div>
  );

  return (
    <div className="absolute inset-x-0 bottom-0 z-40 select-none" style={{ height: "28%" }}>
      <div className="absolute inset-0 bg-black/20" />
      <div ref={stripRef} className="absolute inset-0">
        <div
          className="absolute inset-y-0"
          style={{
            left: `${(startPct * 100).toFixed(2)}%`,
            width: `${((endPct - startPct) * 100).toFixed(2)}%`,
            borderTop: "1px dashed hsl(var(--mint) / 0.45)",
            borderBottom: "1px dashed hsl(var(--mint) / 0.45)",
          }}
        />
        <Handle which="start" pct={startPct} />
        <Handle which="end" pct={endPct} />
      </div>
      <p className="pointer-events-none absolute inset-x-0 top-1 text-center text-[10px] leading-tight text-white/85">
        两线对准 B 站进度条的左右端点
      </p>
      <div className="absolute right-2 bottom-1.5 flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-white/30 px-2.5 py-0.5 text-[11px] text-white hover:bg-white/10"
        >
          <X size={10} className="inline" />
        </button>
        <button
          type="button"
          onClick={() => onConfirm({ startPct, endPct })}
          className="inline-flex items-center gap-1 rounded-full bg-mint px-3 py-0.5 text-[11px] font-medium text-background"
        >
          <Check size={11} /> 完成
        </button>
      </div>
    </div>
  );
}