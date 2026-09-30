import React, { useRef } from "react";
import { Play, Pause, Minus, Plus, Ruler } from "lucide-react";
import { fromSec } from "@/lib/timecode";

// 移动端「物理对齐 · 桥接锚点」模型：
//   • 本站进度条紧贴视频下方，与 B 站原生进度条等宽对齐（按用户校准的端点几何）。
//   • 一道竖向锚线从本站进度条向上伸到 B 站进度条处，作为「桥」：用户拖动它把
//     本站进度位置对到 B 站进度条的同一横向位置，物理对齐。不做台词磁吸。
//   • 不重载 iframe；校准单独由 BiliCalibrationStrip 在视频底部窄带完成。
// 桌面端仍沿用「当前点重载 B 站」强同步，行为不变。
export default function BilibiliScrubber({
  value,
  duration,
  running,
  onToggleRun,
  onDrag,
  onRelease,
  onNudge,
  onCalibrate,
  trackStartPct = 0.08,
  trackEndPct = 0.88,
  mobile = false,
}) {
  const containerRef = useRef(null);
  const regionRef = useRef(null);
  const v = value == null ? 0 : Math.max(0, Math.min(duration || 0, value));

  // ===== 移动端：紧贴视频的桥接进度条 =====
  if (mobile) {
    const pct = duration ? Math.max(0, Math.min(1, v / duration)) : 0;
    const trackL = `${(trackStartPct * 100).toFixed(2)}%`;
    const trackW = `${((trackEndPct - trackStartPct) * 100).toFixed(2)}%`;
    const handlePct = trackStartPct + (trackEndPct - trackStartPct) * pct;

    const valFromX = (clientX) => {
      const el = regionRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      let p = (clientX - rect.left) / rect.width;
      p = Math.max(0, Math.min(1, p));
      return Math.max(0, Math.min(duration || 0, p * (duration || 0)));
    };
    const onDown = (e) => {
      e.preventDefault();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
      onDrag?.(valFromX(e.clientX));
    };
    const onMove = (e) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      onDrag?.(valFromX(e.clientX));
    };
    const onUp = (e) => {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
      onRelease?.(valFromX(e.clientX));
    };

    return (
      <div>
        {/* 拖动区：整条高度都可触发起拖，锚线为视觉桥 */}
        <div
          ref={containerRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          className="relative h-11 w-full touch-none"
        >
          {/* 全宽淡淡底线 */}
          <div className="absolute left-0 top-[60%] h-px w-full -translate-y-1/2 bg-border/40" />
          {/* 校准几何对应的轨道区域（仅用于几何读取） */}
          <div ref={regionRef} className="absolute inset-y-0" style={{ left: trackL, width: trackW }} />
          {/* 轨道条 + 已播填充 */}
          <div
            className="absolute top-[60%] h-2.5 -translate-y-1/2 overflow-hidden rounded-full"
            style={{ left: trackL, width: trackW, background: "hsl(var(--mint) / 0.16)" }}
          >
            <div
              className="absolute left-0 top-0 h-full rounded-full bg-mint/70"
              style={{ width: `${(pct * 100).toFixed(2)}%` }}
            />
          </div>
          {/* 桥接锚线：从轨道向上伸到 B 站进度条处，pointer-events-none 不挡 B 站操作 */}
          <div
            className="pointer-events-none absolute z-30 -translate-x-1/2"
            style={{ left: `${(handlePct * 100).toFixed(2)}%`, bottom: "40%", height: 38, marginBottom: -2 }}
          >
            <div className="mx-auto h-full w-[2px] bg-mint shadow-[0_0_6px_hsl(var(--mint))]" />
            <div className="absolute -top-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-mint" />
          </div>
        </div>
        {/* 时间码 / 微调 / 校准 全部在进度条下方 */}
        <div className="mt-1 flex items-center justify-between px-1">
          <span className="font-mono text-[11px] tabular-nums text-mint/90">
            {value == null ? "--:--" : fromSec(Math.floor(v))}
          </span>
          <div className="flex items-center gap-2">
            {onNudge && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onNudge(-1)}
                  title="站内时钟后退 1 秒"
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-mint/40 hover:text-mint"
                >
                  <Minus size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => onNudge(1)}
                  title="站内时钟前进 1 秒"
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-mint/40 hover:text-mint"
                >
                  <Plus size={12} />
                </button>
              </div>
            )}
            {onCalibrate && (
              <button
                type="button"
                onClick={onCalibrate}
                title="校准进度条宽度（在视频底部对准 B 站进度条）"
                className="flex h-7 w-7 items-center justify-center rounded-full border border-mint/40 text-mint transition-colors hover:bg-mint hover:text-background"
              >
                <Ruler size={12} />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ===== 桌面端：沿用「当前点重载 B 站」强同步（不变）=====
  const playTitle = running
    ? "暂停（重载 B 站至当前秒并停下，物理对齐）"
    : "播放（重载 B 站至当前秒并播放，物理对齐）";
  return (
    <div className="mt-3 rounded-2xl border border-border/60 bg-background-elev/40 p-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleRun}
          title={playTitle}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${running ? "bg-mint text-background" : "border border-border text-muted-foreground hover:border-mint/50 hover:text-mint"}`}
        >
          {running ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <span className="font-mono text-[11px] tabular-nums text-mint/90">{value == null ? "--:--" : fromSec(Math.floor(v))}</span>
        <input
          type="range"
          min={0}
          max={Math.max(1, duration || 0)}
          step={0.1}
          value={v}
          onChange={(e) => onDrag?.(parseFloat(e.target.value))}
          onPointerUp={(e) => onRelease?.(parseFloat(e.currentTarget.value))}
          onKeyUp={(e) => onRelease?.(parseFloat(e.currentTarget.value))}
          className="flex-1 cursor-pointer"
          style={{ accentColor: "hsl(var(--mint))" }}
        />
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{fromSec(Math.floor(duration || 0))}</span>
        </div>
        </div>
  );
}