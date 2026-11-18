// Matches the 12px gutter (p-3) around the theater workspace, so the bar only
// opens from the strip outside the panels and never while reading inside them.
export const THEATER_TOOLBAR_EDGE_PX = 12;

// Touch has no hover: a tap in the right-hand strip is the only way to open it.
export const THEATER_TOOLBAR_TOUCH_RATIO = 0.18;

/**
 * Whether the theater's right-hand toolbar should be showing.
 * `barReach` is how far the open bar extends from the right edge, so the
 * pointer can travel from the edge onto its buttons without it closing.
 */
export function theaterToolbarVisible({ visible, distanceFromRight, viewportWidth, barReach = 0, finePointer }) {
  if (!finePointer) return distanceFromRight < viewportWidth * THEATER_TOOLBAR_TOUCH_RATIO;
  if (distanceFromRight <= THEATER_TOOLBAR_EDGE_PX) return true;
  return Boolean(visible) && distanceFromRight <= barReach;
}
