// Short, soft answer-feedback sounds generated with the Web Audio API (no audio files).
const STORAGE_KEY = "lingoclub.reviewSounds";

// Each note: [frequencyHz, startSec, durationSec, waveType, peakGain, endFrequencyHz?]
export const SOUND_PATTERNS = {
  correct: [
    [659.25, 0, 0.12, "sine", 0.16],
    [987.77, 0.09, 0.2, "sine", 0.14],
  ],
  wrong: [
    [233.08, 0, 0.16, "triangle", 0.18, 207.65],
    [174.61, 0.13, 0.22, "triangle", 0.16, 155.56],
  ],
};

export function patternDuration(name) {
  const notes = SOUND_PATTERNS[name] || [];
  return notes.reduce((max, [, start, duration]) => Math.max(max, start + duration), 0);
}

function storage() {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
}

export function isReviewSoundEnabled(store = storage()) {
  try { return store?.getItem(STORAGE_KEY) !== "off"; } catch { return true; }
}

export function setReviewSoundEnabled(enabled, store = storage()) {
  try { store?.setItem(STORAGE_KEY, enabled ? "on" : "off"); } catch { /* noop */ }
}

let ctx = null;

function getContext() {
  if (typeof window === "undefined") return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!ctx) {
    try { ctx = new AudioCtx(); } catch { ctx = null; }
  }
  return ctx;
}

// Call from a tap/click/keydown handler: creates/resumes the AudioContext (required on iOS Safari).
export function unlockReviewSounds() {
  const context = getContext();
  if (context && context.state !== "running") {
    try { context.resume?.(); } catch { /* noop */ }
  }
  return context;
}

export function playReviewSound(name) {
  if (!isReviewSoundEnabled()) return false;
  const notes = SOUND_PATTERNS[name];
  const context = unlockReviewSounds();
  if (!notes || !context) return false;
  try {
    const now = context.currentTime + 0.01;
    const master = context.createGain();
    master.gain.value = 1;
    master.connect(context.destination);
    for (const [freq, start, duration, type, peak, endFreq] of notes) {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now + start);
      if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, now + start + duration);
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(peak, now + start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
      osc.connect(gain);
      gain.connect(master);
      osc.start(now + start);
      osc.stop(now + start + duration + 0.02);
    }
    return true;
  } catch {
    return false;
  }
}
