/** Layout numbers for the floating subtitle pill. */

export const SUBTITLE_FONT_MIN = 14;
export const SUBTITLE_FONT_MAX = 48;
export const SUBTITLE_FONT_DEFAULT = 21;
export const SUBTITLE_WIDTH_MIN = 120;
/** Font pixels gained per pointer pixel while dragging the resize handle down. */
export const SUBTITLE_FONT_DRAG_SCALE = 0.5;

export function clampSubtitleFont(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return SUBTITLE_FONT_DEFAULT;
  return Math.max(SUBTITLE_FONT_MIN, Math.min(SUBTITLE_FONT_MAX, n));
}

/**
 * Old builds stored a hard clip height in `${key}_h` and shrank the font to fit.
 * Approximate the font that one line would have used inside that height
 * (about 12px of vertical padding, line-height 1.35). Multi-line clips come
 * out a bit large; auto height then grows instead of shrinking the type.
 */
export function fontFromLegacySubtitleHeight(heightPx) {
  const height = Number(heightPx);
  if (!Number.isFinite(height) || height <= 0) return SUBTITLE_FONT_DEFAULT;
  return clampSubtitleFont((height - 12) / 1.35);
}

export function readSubtitleBoxWidth(raw) {
  const v = parseInt(raw, 10);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.max(SUBTITLE_WIDTH_MIN, v);
}

/** Prefer a saved font. Fall back to a legacy `_h` clip, then the default. */
export function readSubtitleFontSize(fontRaw, legacyHeightRaw) {
  const saved = parseFloat(fontRaw);
  if (Number.isFinite(saved) && saved > 0) return clampSubtitleFont(saved);
  const legacyH = parseInt(legacyHeightRaw, 10);
  if (Number.isFinite(legacyH) && legacyH > 0) return fontFromLegacySubtitleHeight(legacyH);
  return SUBTITLE_FONT_DEFAULT;
}

export function fontAfterVerticalDrag(startFont, deltaY) {
  return clampSubtitleFont(Number(startFont) + Number(deltaY) * SUBTITLE_FONT_DRAG_SCALE);
}
