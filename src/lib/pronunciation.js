// Natural-sounding pronunciation for words and short phrases.
// 1) Real recorded dictionary audio (Youdao dictvoice) played through an <audio> element.
// 2) Fallback: browser speech synthesis with the most natural English voice available.
// Long sentences go straight to speech synthesis (dictionary audio is for words/short phrases).

const DICT_MAX_WORDS = 6;
const DICT_MAX_CHARS = 48;
const DICT_START_TIMEOUT_MS = 3500;

const NOVELTY_VOICES = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|junior|organ|superstar|trinoids|whisper|wobble|zarvox|fred|ralph|kathy|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley)\b/i;
const QUALITY_HINTS = [
  [/\b(natural|neural)\b/i, 60],
  [/\b(premium)\b/i, 50],
  [/\b(enhanced)\b/i, 45],
  [/^google (us|uk) english/i, 40],
  [/\b(online)\b/i, 20],
  [/\b(samantha|ava|allison|susan|zoe|evan|nathan|tom|serena|daniel|karen|moira|tessa|aria|jenny|guy|libby|sonia|ryan)\b/i, 25],
];

export function normalizeAccent(accent = "en-US") {
  return String(accent || "").toLowerCase().startsWith("en-gb") ? "en-GB" : "en-US";
}

export function isDictionaryFriendly(text) {
  const value = String(text || "").trim();
  if (!value || value.length > DICT_MAX_CHARS) return false;
  if (!/^[A-Za-z][A-Za-z\s'’.-]*$/.test(value)) return false;
  return value.split(/\s+/).filter(Boolean).length <= DICT_MAX_WORDS;
}

export function dictionaryAudioUrl(text, accent = "en-US") {
  const value = String(text || "").trim().replace(/’/g, "'").replace(/\s+/g, " ");
  const type = normalizeAccent(accent) === "en-GB" ? 1 : 2;
  return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(value)}&type=${type}`;
}

export function scoreVoice(voice, accent = "en-US") {
  if (!voice) return -Infinity;
  const lang = String(voice.lang || "").replace("_", "-").toLowerCase();
  const name = String(voice.name || "");
  if (!lang.startsWith("en")) return -Infinity;
  let score = 0;
  if (lang === accent.toLowerCase()) score += 30;
  else if (lang.startsWith("en-")) score += 5;
  for (const [pattern, bonus] of QUALITY_HINTS) if (pattern.test(name)) score += bonus;
  if (NOVELTY_VOICES.test(name)) score -= 200;
  if (/compact/i.test(name)) score -= 20;
  return score;
}

export function pickBestVoice(voices = [], accent = "en-US") {
  const target = normalizeAccent(accent);
  let best = null;
  let bestScore = -Infinity;
  for (const voice of voices || []) {
    const score = scoreVoice(voice, target);
    if (score > bestScore) { best = voice; bestScore = score; }
  }
  return bestScore > -100 ? best : null;
}

let audioEl = null;
let playToken = 0;
let voicesHooked = false;

function getWindow() {
  return typeof window === "undefined" ? null : window;
}

function getAudioEl(win) {
  if (audioEl || !win || typeof win.Audio !== "function") return audioEl;
  audioEl = new win.Audio();
  audioEl.preload = "auto";
  audioEl.setAttribute?.("playsinline", "");
  return audioEl;
}

function hookVoices(win) {
  const synth = win?.speechSynthesis;
  if (voicesHooked || !synth) return;
  voicesHooked = true;
  try {
    synth.getVoices?.();
    synth.addEventListener?.("voiceschanged", () => synth.getVoices?.());
  } catch { /* optional */ }
}

export function speakWithSynthesis(text, { accent = "en-US", rate = 0.95, win = getWindow() } = {}) {
  try {
    const synth = win?.speechSynthesis;
    const value = String(text || "").trim();
    if (!synth || !value || typeof win.SpeechSynthesisUtterance !== "function") return false;
    hookVoices(win);
    synth.cancel();
    const lang = normalizeAccent(accent);
    const utterance = new win.SpeechSynthesisUtterance(value);
    utterance.lang = lang;
    utterance.rate = rate;
    const voice = pickBestVoice(synth.getVoices?.() || [], lang);
    if (voice) { utterance.voice = voice; utterance.lang = voice.lang || lang; }
    synth.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

export function stopPronunciation(win = getWindow()) {
  playToken += 1;
  try { audioEl?.pause(); } catch { /* noop */ }
  try { win?.speechSynthesis?.cancel(); } catch { /* noop */ }
}

// Plays the word. Returns "dictionary" | "synthesis" | "none" (initial attempt; may fall back later).
export function pronounce(text, { accent = "en-US", rate = 0.95, win = getWindow() } = {}) {
  const value = String(text || "").trim();
  if (!value || !win) return "none";
  stopPronunciation(win);
  const token = playToken;
  const audio = isDictionaryFriendly(value) ? getAudioEl(win) : null;
  if (!audio) return speakWithSynthesis(value, { accent, rate, win }) ? "synthesis" : "none";

  let settled = false;
  let timer = null;
  const fallback = () => {
    if (timer) clearTimeout(timer);
    if (settled || token !== playToken) return;
    settled = true;
    try { audio.pause(); } catch { /* noop */ }
    speakWithSynthesis(value, { accent, rate, win });
  };
  const started = () => {
    if (timer) clearTimeout(timer);
    if (token === playToken) settled = true;
  };
  audio.onerror = fallback;
  audio.onplaying = started;
  timer = setTimeout(fallback, DICT_START_TIMEOUT_MS);
  try {
    audio.src = dictionaryAudioUrl(value, accent);
    const result = audio.play();
    if (result && typeof result.then === "function") result.then(started, fallback);
  } catch {
    fallback();
  }
  return "dictionary";
}

// iOS Safari only lets an <audio> element play programmatically (e.g. auto-play in 听音选词)
// after it has been played once inside a user gesture. Prime the shared element on first tap.
const SILENT_WAV = "data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA";
let unlocked = false;
export function unlockPronunciationAudio(win = getWindow()) {
  if (unlocked || !win) return;
  const audio = getAudioEl(win);
  if (!audio) return;
  unlocked = true;
  hookVoices(win);
  try {
    if (!audio.src || audio.src === "") {
      audio.src = SILENT_WAV;
      const result = audio.play();
      if (result && typeof result.catch === "function") result.catch(() => { unlocked = false; });
    }
  } catch { unlocked = false; }
}

export function __resetPronunciationForTests() {
  audioEl = null;
  playToken = 0;
  voicesHooked = false;
  unlocked = false;
}
