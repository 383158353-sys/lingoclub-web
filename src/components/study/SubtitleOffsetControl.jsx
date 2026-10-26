import React, { useEffect, useState } from "react";
import {
  formatOffsetInputSeconds,
  formatSubtitleOffset,
  nudgeSubtitleOffsetMs,
  parseSubtitleOffsetInput,
  SUBTITLE_OFFSET_STEPS_MS,
} from "@/lib/subtitleOffset";

const buttonClass = "inline-flex min-h-9 items-center justify-center rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-copper/50 hover:text-copper";

export default function SubtitleOffsetControl({ offsetMs = 0, onChange }) {
  const [draft, setDraft] = useState(() => formatOffsetInputSeconds(offsetMs));
  const [inputError, setInputError] = useState("");

  useEffect(() => {
    setDraft(formatOffsetInputSeconds(offsetMs));
    setInputError("");
  }, [offsetMs]);

  const commit = () => {
    const parsed = parseSubtitleOffsetInput(draft);
    if (parsed == null) {
      setInputError("请输入秒数，例如 1.2、-0.5，或毫秒 800ms");
      return;
    }
    setInputError("");
    onChange?.(parsed);
  };

  const direction = offsetMs > 0 ? "字幕延后" : offsetMs < 0 ? "字幕提前" : "与字幕文件一致";

  return (
    <section data-testid="subtitle-offset" className="mt-4 rounded-xl border border-border bg-background-elev/40 p-3" aria-label="字幕时间轴偏移">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium text-foreground">时间轴偏移</h4>
        <p className="text-[11px] text-muted-foreground">正数延后，负数提前</p>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        下载的字幕如果整体比画面早或晚，在这里统一平移。画面字幕、台词高亮、点击跳转和精读循环都会跟着移动。视频仍按原速度播放。
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {SUBTITLE_OFFSET_STEPS_MS.map((step) => (
          <button key={`minus-${step}`} type="button" className={buttonClass} onClick={() => onChange?.(nudgeSubtitleOffsetMs(offsetMs, -step))}>
            -{step / 1000}s
          </button>
        ))}
        <span className="inline-flex min-h-9 items-center gap-2 rounded-full bg-background px-3 py-1">
          <span className="text-[11px] text-muted-foreground">当前偏移</span>
          <span data-testid="subtitle-offset-value" className="font-mono text-sm font-medium text-copper" aria-live="polite">{formatSubtitleOffset(offsetMs)}</span>
        </span>
        {[...SUBTITLE_OFFSET_STEPS_MS].reverse().map((step) => (
          <button key={`plus-${step}`} type="button" className={buttonClass} onClick={() => onChange?.(nudgeSubtitleOffsetMs(offsetMs, step))}>
            +{step / 1000}s
          </button>
        ))}
        <button type="button" className={`${buttonClass} disabled:cursor-not-allowed disabled:opacity-40`} onClick={() => onChange?.(0)} disabled={offsetMs === 0}>
          重置
        </button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">{direction}</p>

      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          commit();
        }}
      >
        <label className="text-[11px] text-muted-foreground" htmlFor="subtitle-offset-input">精确偏移</label>
        <input
          id="subtitle-offset-input"
          data-testid="subtitle-offset-input"
          value={draft}
          inputMode="text"
          onChange={(event) => {
            setDraft(event.target.value);
            if (inputError) setInputError("");
          }}
          placeholder="1.2、-0.5 或 800ms"
          className="h-9 w-36 rounded-lg border border-border bg-background px-2.5 text-sm text-foreground focus:border-copper/50 focus:outline-none"
        />
        <button type="submit" className="inline-flex min-h-9 items-center rounded-full bg-copper px-3.5 py-1.5 text-xs font-medium text-copper-foreground">
          确定
        </button>
        <span className="text-[11px] text-muted-foreground">单位默认是秒</span>
      </form>
      {inputError && <p className="mt-2 text-xs text-rose-300">{inputError}</p>}
    </section>
  );
}
