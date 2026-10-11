// iOS Safari only allows audio after a user gesture. Install once at app start so the tap that
// opens 复习 (or any earlier tap) already unlocks pronunciation audio and the answer-sound engine,
// which makes the first 听音选词 card auto-play reliably.
import { unlockPronunciationAudio } from "@/lib/pronunciation";
import { unlockReviewSounds } from "@/lib/reviewSounds";

const EVENTS = ["pointerdown", "touchend", "click", "keydown"];
let installed = false;

export function installAudioUnlock(doc = typeof document !== "undefined" ? document : null) {
  if (installed || !doc) return;
  installed = true;
  const unlock = () => {
    try { unlockPronunciationAudio(); } catch { /* noop */ }
    try { unlockReviewSounds(); } catch { /* noop */ }
  };
  EVENTS.forEach((name) => doc.addEventListener(name, unlock, { capture: true, passive: true }));
}
