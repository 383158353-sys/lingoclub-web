/** Layout numbers for the floating subtitle pill. */

export const SUBTITLE_WIDTH_MIN = 120;
export const SUBTITLE_HEIGHT_MIN = 32;
export const SUBTITLE_FONT_MIN = 10;
/** High enough that a large dragged box can be filled, not stuck at a small cap. */
export const SUBTITLE_FONT_MAX = 320;
/** Used only before the user has dragged a box. A dragged box refits from scratch. */
export const SUBTITLE_FONT_DEFAULT = 22;
/** Tightest leading. The fit starts here so glyphs can grow before an extra wrap overshoots. */
export const SUBTITLE_LINE_HEIGHT_MIN = 1.05;
/** Loosest leading. After the font is chosen, leading opens until the block reaches the box. */
export const SUBTITLE_LINE_HEIGHT_MAX = 2.2;
/** Comfortable leading when the user has nudged the font inside a fixed box. */
export const SUBTITLE_LINE_HEIGHT = 1.2;
/**
 * Leftover vertical space is split above:below. The cue sits a little above
 * the box center instead of hugging the top or leaving the whole gap underneath.
 */
export const SUBTITLE_NUDGE_SPACE_ABOVE = 2;
export const SUBTITLE_NUDGE_SPACE_BELOW = 3;
export const SUBTITLE_TEXT_PAD_Y = 4;
export const SUBTITLE_FONT_NUDGE = 2;

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

export function clampSubtitleFont(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return SUBTITLE_FONT_DEFAULT;
  return Math.max(SUBTITLE_FONT_MIN, Math.min(SUBTITLE_FONT_MAX, n));
}

/** A saved manual size, or null when the box should auto-fit. Ignores empty values. */
export function readManualSubtitleFont(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return clampSubtitleFont(n);
}

export function nudgeSubtitleFont(current, delta) {
  return clampSubtitleFont(Number(current) + Number(delta));
}

/** Top of a shorter cue inside a fixed box. More space stays below than above. */
export function subtitleCueTop(boxHeight, textHeight) {
  const box = Math.max(0, Number(boxHeight) || 0);
  const text = Math.max(0, Math.min(box, Number(textHeight) || 0));
  const leftover = box - text;
  const parts = SUBTITLE_NUDGE_SPACE_ABOVE + SUBTITLE_NUDGE_SPACE_BELOW;
  return leftover * SUBTITLE_NUDGE_SPACE_ABOVE / parts;
}

/**
 * Fill a fixed box.
 * `measure(fontPx, lineHeight)` returns the text block's scrollHeight.
 * The search first takes the largest font that fits at the tightest leading
 * (so a wrap cliff cannot freeze the type too small), then opens the leading
 * until the block reaches the bottom of the box.
 */
export function fitSubtitleBlock(measure, boxHeight, options = {}) {
  const minFont = options.minFont ?? SUBTITLE_FONT_MIN;
  const maxFont = options.maxFont ?? SUBTITLE_FONT_MAX;
  const minLh = options.minLineHeight ?? SUBTITLE_LINE_HEIGHT_MIN;
  const maxLh = options.maxLineHeight ?? SUBTITLE_LINE_HEIGHT_MAX;
  const slack = options.slack ?? 1;
  const height = Number(boxHeight);
  const fontLimit = Math.max(minFont, Math.min(maxFont, Math.floor(Number.isFinite(height) ? height : minFont)));
  let lo = minFont;
  let hi = fontLimit;
  let font = minFont;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (Number(measure(mid, minLh)) <= height + slack) {
      font = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  let lhLo = Math.round(minLh * 100);
  let lhHi = Math.round(maxLh * 100);
  let lineHeight = minLh;
  while (lhLo <= lhHi) {
    const mid = (lhLo + lhHi) >> 1;
    const lh = mid / 100;
    if (Number(measure(font, lh)) <= height + slack) {
      lineHeight = lh;
      lhLo = mid + 1;
    } else {
      lhHi = mid - 1;
    }
  }
  return {
    font,
    lineHeight,
    height: Number(measure(font, lineHeight)),
  };
}
