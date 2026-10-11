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

// Feedback plan for an answer: which sound to play and, for rounds 1/2, when to say the English word
// (after the chime so the two never overlap). Round 3 already played the word before the answer.
export function answerFeedbackPlan(mode, correct) {
  const sound = correct ? "correct" : "wrong";
  const pronounceDelayMs = mode === "r1" || mode === "r2" ? Math.round(patternDuration(sound) * 1000) + 80 : null;
  return { sound, pronounceDelayMs };
}

// Render a pattern to mono PCM samples (same envelope as the Web Audio version).
export function renderPatternSamples(name, sampleRate = 22050) {
  const notes = SOUND_PATTERNS[name] || [];
  const total = Math.ceil((patternDuration(name) + 0.03) * sampleRate);
  const out = new Float32Array(total);
  for (const [freq, start, duration, type, peak, endFreq] of notes) {
    const s0 = Math.floor(start * sampleRate);
    const n = Math.floor(duration * sampleRate);
    const attack = Math.max(1, Math.floor(0.012 * sampleRate));
    let phase = 0;
    for (let i = 0; i < n && s0 + i < total; i += 1) {
      const t = i / n;
      const f = endFreq ? freq * Math.pow(endFreq / freq, t) : freq;
      phase += (2 * Math.PI * f) / sampleRate;
      const cyc = (phase / (2 * Math.PI)) % 1;
      const wave = type === "triangle" ? 1 - 4 * Math.abs(cyc - 0.5) : Math.sin(phase);
      const env = i < attack ? peak * (i / attack) : peak * Math.pow(0.0001 / peak, (i - attack) / Math.max(1, n - attack));
      out[s0 + i] += wave * env;
    }
  }
  return out;
}

export function encodeWav(samples, sampleRate = 22050) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const writeStr = (offset, str) => { for (let i = 0; i < str.length; i += 1) bytes[offset + i] = str.charCodeAt(i); };
  writeStr(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); writeStr(8, "WAVE");
  writeStr(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeStr(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.max(-1, Math.min(1, samples[i] * 1.6));
    view.setInt16(44 + i * 2, Math.round(v * 32767), true);
  }
  return bytes;
}

const uriCache = {};
export function soundDataUri(name) {
  if (uriCache[name]) return uriCache[name];
  const bytes = encodeWav(renderPatternSamples(name));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  uriCache[name] = `data:audio/wav;base64,${btoa(binary)}`;
  return uriCache[name];
}

let ctx = null;
let feedbackEl = null;

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

// Plays through an <audio> element first: on iPhone, Web Audio is muted by the ring/silent switch,
// while media elements still play (same as the word pronunciation). Web Audio is the fallback.
export function playReviewSound(name) {
  if (!isReviewSoundEnabled() || !SOUND_PATTERNS[name]) return false;
  try {
    if (typeof window !== "undefined" && typeof window.Audio === "function") {
      if (!feedbackEl) {
        feedbackEl = new window.Audio();
        feedbackEl.preload = "auto";
        feedbackEl.setAttribute?.("playsinline", "");
      }
      feedbackEl.pause();
      feedbackEl.src = soundDataUri(name);
      const result = feedbackEl.play();
      if (result && typeof result.catch === "function") {
        result.catch((error) => { if (error?.name !== "AbortError") playWithWebAudio(name); });
      }
      return true;
    }
  } catch { /* fall through */ }
  return playWithWebAudio(name);
}

function playWithWebAudio(name) {
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
