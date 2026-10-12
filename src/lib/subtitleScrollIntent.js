// Classifies subtitle-list scroll events as user vs programmatic, and decides whether a
// row click is a real tap (→ seek) or the tail of a scroll gesture (→ ignore).
// Pure logic (no DOM) so it can be unit-tested with node --test.
//
// Why: on iOS a scroll is only "manual" if a finger/wheel started it. Relying on a timer
// flag around our own scrollTo() misclassified momentum + smooth scroll, and a tap that
// stops momentum scrolling fires `click` → the row seeked the video while the user was
// just scrolling.
export const TAP_MOVE_PX = 10;          // finger travel beyond this = scroll, not tap
export const MOMENTUM_GRACE_MS = 1200;  // iOS momentum keeps emitting scroll after touchend
export const WHEEL_GRACE_MS = 300;
export const SCROLLING_RECENT_MS = 150; // touch that lands on a still-moving list = "stop" tap

export function createScrollIntentTracker(now = () => Date.now()) {
  let touching = false;
  let startX = 0, startY = 0;
  let moved = false;
  let userUntil = 0;       // scroll events before this timestamp count as user-driven
  let lastScrollAt = -Infinity;
  let suppressClick = false;

  return {
    touchStart(x, y) {
      const t = now();
      touching = true; moved = false; startX = x; startY = y;
      // Tapping a list that is still gliding just stops it — must not seek.
      suppressClick = t - lastScrollAt < SCROLLING_RECENT_MS;
      userUntil = Infinity;
    },
    touchMove(x, y) {
      if (!touching) return;
      if (Math.abs(x - startX) > TAP_MOVE_PX || Math.abs(y - startY) > TAP_MOVE_PX) { moved = true; suppressClick = true; }
    },
    touchEnd() {
      touching = false;
      userUntil = now() + (moved ? MOMENTUM_GRACE_MS : 0);
    },
    wheel() { userUntil = Math.max(userUntil === Infinity ? 0 : userUntil, now() + WHEEL_GRACE_MS); },
    // Explicit programmatic scroll (↑ / auto-follow) ends any lingering user window.
    programmatic() { if (!touching) userUntil = 0; },
    /** @returns {boolean} true if this scroll event was caused by the user */
    scroll() {
      const t = now();
      lastScrollAt = t;
      const isUser = touching || t <= userUntil;
      if (isUser && touching) { moved = true; suppressClick = true; }
      return isUser;
    },
    /** @returns {boolean} true if the click should be treated as a tap (allowed to seek) */
    consumeClick() {
      const ok = !suppressClick;
      suppressClick = false;
      return ok;
    },
  };
}
