/** Layout numbers for the floating subtitle pill. */

export const SUBTITLE_WIDTH_MIN = 120;
export const SUBTITLE_HEIGHT_MIN = 32;
export const SUBTITLE_FONT_MIN = 10;
/** High enough that a large dragged box can be filled, not stuck at a small cap. */
export const SUBTITLE_FONT_MAX = 320;
/** Used only before the user has dragged a box. A dragged box refits from scratch. */
export const SUBTITLE_FONT_DEFAULT = 22;
export const SUBTITLE_LINE_HEIGHT = 1.375;

/** Original frosted bar, with a small bump so burned-in captions sit a little further back. */
export const SUBTITLE_PILL_BACKGROUND = "rgba(8,6,4,0.62)";
export const SUBTITLE_PILL_BLUR = "blur(14px) saturate(120%)";
export const SUBTITLE_PILL_SHADOW = "0 2px 10px rgba(0,0,0,0.32)";

export function readSubtitleBoxAxis(raw) {
  const v = parseInt(raw, 10);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Horizontal padding that keeps the cue off the study button.
 * Wide boxes use a symmetric inset so the line stays centered; narrow boxes
 * give the glyphs more of the width.
 */
export function subtitleTextPadX(boxWidth) {
  const clearButton = 48;
  const width = Number(boxWidth);
  if (!Number.isFinite(width) || width <= 0) return clearButton;
  const roomy = Math.floor((width - 64) / 2);
  return Math.max(8, Math.min(clearButton, roomy));
}

/** Corner drag sets both edges. Font is fitted afterwards. */
export function nextSubtitleBoxSize(startW, startH, dx, dy) {
  const width = Math.round(Number(startW) + Number(dx));
  const height = Math.round(Number(startH) + Number(dy));
  return {
    width: Math.max(SUBTITLE_WIDTH_MIN, Number.isFinite(width) ? width : SUBTITLE_WIDTH_MIN),
    height: Math.max(SUBTITLE_HEIGHT_MIN, Number.isFinite(height) ? height : SUBTITLE_HEIGHT_MIN),
  };
}

/**
 * Largest integer font whose measured block still fits in `boxHeight`.
 * `measure(fontPx)` returns the text block's scrollHeight at that size
 * (padding included). A taller box therefore resolves to a larger font.
 */
export function fitFontSizeToBox(measure, boxHeight, options = {}) {
  const min = options.min ?? SUBTITLE_FONT_MIN;
  const max = options.max ?? SUBTITLE_FONT_MAX;
  const slack = options.slack ?? 1;
  const height = Number(boxHeight);
  const limit = Math.max(min, Math.min(max, Math.floor(Number.isFinite(height) ? height : min)));
  let lo = min;
  let hi = limit;
  let best = min;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (Number(measure(mid)) <= height + slack) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}
