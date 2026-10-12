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

// ---- "↑ 回到当前台词" helpers ----
// Target scrollTop that puts `row` at the top of `container` (minus padTop), clamped to range.
// Uses layout rects instead of scrollIntoView (iOS ignores/cancels it during momentum).
export function computeRowScrollTop({ scrollTop, rowTop, containerTop, padTop = 12, scrollHeight = Infinity, clientHeight = 0 }) {
  const raw = scrollTop + (rowTop - containerTop) - padTop;
  const max = Math.max(0, scrollHeight - clientHeight);
  return Math.round(Math.min(Math.max(0, raw), max));
}

// Pick the cue that should be "current" at time t (seconds): last cue whose start <= t.
export function cueIndexAtTime(starts, t) {
  if (!Number.isFinite(t) || !starts.length) return -1;
  let lo = 0, hi = starts.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (Number.isFinite(starts[mid]) && starts[mid] <= t + 0.05) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

// Hard-jump a scroll container to `getTarget()`; robust against iOS momentum scrolling:
// 1) briefly set overflow hidden (kills momentum), 2) assign scrollTop directly,
// 3) after the position is stable for 2 frames verify; retry once if not reached.
// Calls onDone(reached:boolean). Returns a cancel function.
export function forceScrollTo(container, getTarget, { onDone, raf = (cb) => requestAnimationFrame(cb), tolerance = 4, maxFrames = 60 } = {}) {
  let cancelled = false;
  let attempts = 0;
  const jump = () => {
    attempts += 1;
    const prev = container.style.overflowY;
    container.style.overflowY = "hidden";
    container.scrollTop = getTarget();
    // Re-enable scrolling on the next frame (setting it back in the same frame can resume momentum on iOS).
    raf(() => { container.style.overflowY = prev; container.scrollTop = getTarget(); waitStable(); });
  };
  let last = null, stable = 0, frames = 0;
  const waitStable = () => {
    if (cancelled) return;
    frames += 1;
    const pos = container.scrollTop;
    stable = pos === last ? stable + 1 : 0;
    last = pos;
    if (stable < 2 && frames < maxFrames) { raf(waitStable); return; }
    const reached = Math.abs(container.scrollTop - getTarget()) <= tolerance;
    if (!reached && attempts < 2) { last = null; stable = 0; frames = 0; jump(); return; }
    onDone?.(reached);
  };
  jump();
  return () => { cancelled = true; };
}
