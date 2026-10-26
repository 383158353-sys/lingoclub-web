import React, { useEffect, useRef, useState } from "react";
import {
  formatOffsetInputSeconds,
  formatSubtitleOffset,
  nudgeSubtitleOffsetMs,
  parseSubtitleOffsetInput,
  SUBTITLE_OFFSET_STEPS_MS,
} from "@/lib/subtitleOffset";

const buttonClass = "inline-flex min-h-9 items-center justify-center rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-copper/50 hover:text-copper";

function cueLine(cue) {
  return String(cue?.text_en || cue?.text_zh || "").replace(/\s+/g, " ").trim();
}

export function SubtitleOffsetCaption({ cue, pulse = 0 }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!pulse) return undefined;
    setVisible(true);
    const id = setTimeout(() => setVisible(false), 2200);
    return () => clearTimeout(id);
  }, [pulse]);
  if (!visible) return null;
  const text = cueLine(cue);
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-8 z-40 flex justify-center" data-testid="subtitle-offset-caption">
      <p className={`max-w-full rounded-lg px-3 py-1.5 text-center text-sm font-medium leading-snug text-white shadow-lg line-clamp-3 ${text ? "bg-copper/90" : "bg-black/80"}`}>
        {text || "此刻没有对上的台词"}
      </p>
    </div>
  );
}

export default function SubtitleOffsetControl({ offsetMs = 0, onChange, assist = null }) {
  const [draft, setDraft] = useState(() => formatOffsetInputSeconds(offsetMs));
  const [inputError, setInputError] = useState("");
  const [localNotice, setLocalNotice] = useState("");
  const inputRef = useRef(null);
  const draftRef = useRef(draft);
  const focusedRef = useRef(false);
  draftRef.current = draft;

  const writeDraft = (value) => {
    draftRef.current = value;
    setDraft(value);
  };

  useEffect(() => {
    if (focusedRef.current) return;
    writeDraft(formatOffsetInputSeconds(offsetMs));
    setInputError("");
  }, [offsetMs]);

  const commit = (event) => {
    event?.preventDefault?.();
    const raw = inputRef.current?.value ?? draftRef.current;
    const parsed = parseSubtitleOffsetInput(raw);
    if (parsed == null) {
      setInputError("请输入秒数，例如 1.2、-0.5，或毫秒 800ms");
      return;
    }
    setInputError("");
    writeDraft(formatOffsetInputSeconds(parsed));
    setLocalNotice(`已设为 ${formatSubtitleOffset(parsed)}`);
    onChange?.(parsed);
  };

  const direction = offsetMs > 0 ? "字幕延后" : offsetMs < 0 ? "字幕提前" : "与字幕文件一致";
  const status = assist?.notice || localNotice;
  const matched = cueLine(assist?.matchedCue);

  return (
    <section data-testid="subtitle-offset" className="relative z-10 mt-4 rounded-xl border border-border bg-background-elev/40 p-3" aria-label="字幕时间轴偏移">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium text-foreground">时间轴偏移</h4>
        <p className="text-[11px] text-muted-foreground">正数延后，负数提前</p>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        下载的字幕如果整体比画面早或晚，在这里统一平移。画面字幕、台词高亮、点击跳转和精读循环都会跟着移动。视频仍按原速度播放。
      </p>
      <p className="mt-1 text-xs leading-relaxed text-copper">
        先点要对的那句 → 把视频停到真正说这句的地方 → 点对齐到此处
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {SUBTITLE_OFFSET_STEPS_MS.map((step) => (
          <button key={`minus-${step}`} type="button" className={buttonClass} onClick={() => onChange?.(nudgeSubtitleOffsetMs(offsetMs, -step), "nudge")}>
            -{step / 1000}s
          </button>
        ))}
        <span className="inline-flex min-h-9 items-center gap-2 rounded-full bg-background px-3 py-1">
          <span className="text-[11px] text-muted-foreground">当前偏移</span>
          <span data-testid="subtitle-offset-value" className="font-mono text-sm font-medium text-copper" aria-live="polite">{formatSubtitleOffset(offsetMs)}</span>
        </span>
        {[...SUBTITLE_OFFSET_STEPS_MS].reverse().map((step) => (
          <button key={`plus-${step}`} type="button" className={buttonClass} onClick={() => onChange?.(nudgeSubtitleOffsetMs(offsetMs, step), "nudge")}>
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
          commit(event);
        }}
      >
        <label className="text-[11px] text-muted-foreground" htmlFor="subtitle-offset-input">精确偏移</label>
        <input
          ref={inputRef}
          id="subtitle-offset-input"
          data-testid="subtitle-offset-input"
          value={draft}
          inputMode="text"
          autoComplete="off"
          enterKeyHint="done"
          onFocus={() => { focusedRef.current = true; }}
          onBlur={() => { focusedRef.current = false; }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            commit(event);
          }}
          onChange={(event) => {
            writeDraft(event.target.value);
            if (inputError) setInputError("");
          }}
          placeholder="1.2、-0.5 或 800ms"
          className="h-9 w-36 rounded-lg border border-border bg-background px-2.5 text-sm text-foreground focus:border-copper/50 focus:outline-none"
        />
        <button
          type="button"
          data-testid="subtitle-offset-commit"
          onPointerDown={(event) => {
            if (event.pointerType === "mouse") event.preventDefault();
          }}
          onClick={commit}
          className="relative z-10 inline-flex min-h-9 items-center rounded-full bg-copper px-3.5 py-1.5 text-xs font-medium text-copper-foreground"
        >
          确定
        </button>
        <span className="text-[11px] text-muted-foreground">单位默认是秒</span>
      </form>
      {inputError && <p className="mt-2 text-xs text-rose-300">{inputError}</p>}

      {assist && (
        <div className="mt-3 rounded-lg border border-border/70 bg-background/50 p-2.5" data-testid="subtitle-offset-snap">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" data-testid="subtitle-offset-use-active" className={buttonClass} onClick={() => assist.pickActiveCue?.()}>
              用当前高亮句卡点
            </button>
            <button
              type="button"
              data-testid="subtitle-offset-align"
              className="inline-flex min-h-9 items-center justify-center rounded-full bg-mint px-3.5 py-1.5 text-xs font-medium text-background disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => assist.alignToPlayhead?.()}
              disabled={!assist.anchor}
            >
              对齐到此处
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground" data-testid="subtitle-offset-anchor">
            {assist.anchor
              ? `卡点句：${assist.anchor.text} · 原时间 ${assist.anchor.timeLabel}`
              : "还没选卡点句。点台词列表里的一句，或用上面的按钮记下当前高亮句。"}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-foreground/80" data-testid="subtitle-offset-matched">
            {matched ? `此刻应对：${matched}` : "此刻没有对上的台词"}
          </p>
        </div>
      )}
      {status && <p className="mt-2 text-xs text-mint" aria-live="polite" data-testid="subtitle-offset-notice">{status}</p>}
    </section>
  );
}
