import test from "node:test";
import assert from "node:assert/strict";
import { dictionaryAudioUrl, isDictionaryFriendly, pickBestVoice, pronounce, __resetPronunciationForTests } from "../src/lib/pronunciation.js";
import { SOUND_PATTERNS, patternDuration, isReviewSoundEnabled, setReviewSoundEnabled } from "../src/lib/reviewSounds.js";

test("dictionary audio is used for words and short phrases only", () => {
  assert.equal(isDictionaryFriendly("resilient"), true);
  assert.equal(isDictionaryFriendly("give up"), true);
  assert.equal(isDictionaryFriendly("rock 'n' roll"), true);
  assert.equal(isDictionaryFriendly("well-being"), true);
  assert.equal(isDictionaryFriendly("I think we should probably go home before it rains."), false);
  assert.equal(isDictionaryFriendly("你好"), false);
  assert.equal(isDictionaryFriendly(""), false);
});

test("dictionary URL picks US/UK accent and encodes text", () => {
  assert.equal(dictionaryAudioUrl("give up"), "https://dict.youdao.com/dictvoice?audio=give%20up&type=2");
  assert.equal(dictionaryAudioUrl(" colour ", "en-GB"), "https://dict.youdao.com/dictvoice?audio=colour&type=1");
  assert.equal(dictionaryAudioUrl("don’t"), "https://dict.youdao.com/dictvoice?audio=don't&type=2");
});

test("best voice prefers natural/enhanced English voices and skips novelty voices", () => {
  const voices = [
    { name: "Fred", lang: "en-US" },
    { name: "Albert", lang: "en-US" },
    { name: "Ting-Ting", lang: "zh-CN" },
    { name: "Samantha", lang: "en-US" },
    { name: "Ava (Enhanced)", lang: "en-US" },
    { name: "Daniel", lang: "en-GB" },
  ];
  assert.equal(pickBestVoice(voices, "en-US").name, "Ava (Enhanced)");
  assert.equal(pickBestVoice(voices, "en-GB").name, "Ava (Enhanced)");
  assert.equal(pickBestVoice([{ name: "Microsoft Aria Online (Natural) - English (United States)", lang: "en-US" }, { name: "Microsoft David", lang: "en-US" }]).name.includes("Aria"), true);
  assert.equal(pickBestVoice([{ name: "Daniel", lang: "en-GB" }, { name: "Alex", lang: "en-US" }], "en-GB").name, "Daniel");
  assert.equal(pickBestVoice([{ name: "Zarvox", lang: "en-US" }, { name: "Ting-Ting", lang: "zh-CN" }]), null);
});

function fakeWindow({ playRejects = false } = {}) {
  const spoken = [];
  const audios = [];
  class FakeAudio {
    constructor() { this.src = ""; audios.push(this); }
    setAttribute() {}
    pause() { this.paused = true; }
    play() { this.played = this.src; return playRejects ? Promise.reject(new Error("NotAllowedError")) : Promise.resolve(); }
  }
  class Utterance { constructor(text) { this.text = text; } }
  const win = {
    Audio: FakeAudio,
    SpeechSynthesisUtterance: Utterance,
    speechSynthesis: {
      cancel() {},
      getVoices: () => [{ name: "Fred", lang: "en-US" }, { name: "Samantha", lang: "en-US" }],
      speak(u) { spoken.push(u); },
    },
  };
  return { win, spoken, audios };
}

test("pronounce plays dictionary audio for a word, synthesis for a sentence", async () => {
  __resetPronunciationForTests();
  const { win, spoken, audios } = fakeWindow();
  assert.equal(pronounce("resilient", { win }), "dictionary");
  assert.match(audios[0].played, /audio=resilient&type=2/);
  assert.equal(pronounce("This is a long sentence that should use the voice engine.", { win }), "synthesis");
  assert.equal(spoken.at(-1).voice.name, "Samantha");
  assert.equal(spoken.at(-1).rate, 0.95);
});

test("pronounce falls back to speech synthesis when dictionary audio cannot play", async () => {
  __resetPronunciationForTests();
  const { win, spoken } = fakeWindow({ playRejects: true });
  pronounce("marquee", { win });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].text, "marquee");
});

test("review feedback sounds are short and distinct; toggle persists", () => {
  assert.ok(patternDuration("correct") < 0.4);
  assert.ok(patternDuration("wrong") < 0.4);
  assert.notDeepEqual(SOUND_PATTERNS.correct, SOUND_PATTERNS.wrong);
  assert.ok(SOUND_PATTERNS.correct[1][0] > SOUND_PATTERNS.correct[0][0], "correct sound rises");
  assert.ok(SOUND_PATTERNS.wrong[1][0] < SOUND_PATTERNS.wrong[0][0], "wrong sound falls");
  const map = new Map();
  const store = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
  assert.equal(isReviewSoundEnabled(store), true);
  setReviewSoundEnabled(false, store);
  assert.equal(isReviewSoundEnabled(store), false);
  setReviewSoundEnabled(true, store);
  assert.equal(isReviewSoundEnabled(store), true);
});
