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
  let ignoreUntil = 0;     // programmatic settle window: scroll events are ours, not the user's

  return {
    touchStart(x, y) {
      const t = now();
      touching = true; moved = false; startX = x; startY = y;
      ignoreUntil = 0; // a real finger always wins over our settle window
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
    // Ignore (non-touch) scroll events for `ms` — covers iOS's late scroll events that
    // fire after our forced jump settled and used to flip follow back to manual.
    ignoreScrollFor(ms) { ignoreUntil = Math.max(ignoreUntil, now() + ms); if (!touching) userUntil = 0; },
    endIgnore() { ignoreUntil = 0; },
    /** @returns {boolean} true if this scroll event was caused by the user */
    scroll() {
      const t = now();
      if (!touching && t < ignoreUntil) return false;
      const isUser = touching || t <= userUntil;
      // Ignored follow-scroll must not stamp lastScrollAt, or the next 精读 tap
      // looks like a tap that stopped momentum. A scroll event by itself is not
      // a drag — touchMove past TAP_MOVE_PX is what cancels the click.
      if (!isUser) return false;
      lastScrollAt = t;
      if (touching) moved = true;
      return true;
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
// After reaching the target it keeps verifying for `settleFrames` (~1s) and re-aligns if the
// target moved (row heights change when translations stream in, images/fonts load...).
export function forceScrollTo(container, getTarget, { onDone, raf = (cb) => requestAnimationFrame(cb), tolerance = 4, maxFrames = 60, settleFrames = 60, isInterrupted = () => false } = {}) {
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
    settle(0, reached);
  };
  const settle = (n, reached) => {
    if (cancelled) return;
    if (isInterrupted()) { onDone?.(reached); return; }
    const target = getTarget();
    if (Math.abs(container.scrollTop - target) > tolerance) container.scrollTop = target;
    if (n >= settleFrames) { onDone?.(Math.abs(container.scrollTop - getTarget()) <= tolerance); return; }
    raf(() => settle(n + 1, reached));
  };
  jump();
  return () => { cancelled = true; };
}

// Live player time with a fallback: the YouTube iframe API returns 0 (or throws /
// returns undefined) before it is ready or right after the iframe was re-attached.
// In that case trust the last time we saw from timeupdate / the active cue.
export function resolvePlaybackTime(live, fallback) {
  const t = Number(live);
  const f = Number(fallback);
  const hasFallback = Number.isFinite(f) && f > 0.5;
  if (!Number.isFinite(t) || t < 0) return hasFallback ? f : NaN;
  if (t < 0.25 && hasFallback) return f;
  return t;
}
