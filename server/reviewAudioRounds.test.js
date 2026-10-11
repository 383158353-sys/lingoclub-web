import test from "node:test";
import assert from "node:assert/strict";
import { answerFeedbackPlan, encodeWav, patternDuration, renderPatternSamples, soundDataUri } from "../src/lib/reviewSounds.js";
import { isPronunciationUnlocked, pronounce, unlockPronunciationAudio, __resetPronunciationForTests } from "../src/lib/pronunciation.js";

test("every round gets a correct/wrong sound; rounds 1 and 2 then say the English word after the chime", () => {
  for (const mode of ["r1", "r2", "r3"]) {
    assert.equal(answerFeedbackPlan(mode, true).sound, "correct");
    assert.equal(answerFeedbackPlan(mode, false).sound, "wrong");
  }
  for (const mode of ["r1", "r2"]) {
    for (const correct of [true, false]) {
      const { sound, pronounceDelayMs } = answerFeedbackPlan(mode, correct);
      assert.ok(pronounceDelayMs >= patternDuration(sound) * 1000, "word starts after the chime");
      assert.ok(pronounceDelayMs < 700, "word starts before the card auto-advances");
    }
  }
  assert.equal(answerFeedbackPlan("r3", true).pronounceDelayMs, null);
});

test("answer sounds render to a valid, audible, short WAV for <audio> playback (works with iPhone silent switch)", () => {
  for (const name of ["correct", "wrong"]) {
    const samples = renderPatternSamples(name);
    const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    assert.ok(peak > 0.05 && peak <= 1, `${name} audible but not clipping`);
    const wav = encodeWav(samples);
    assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
    assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
    assert.ok(samples.length / 22050 < 0.4);
    assert.match(soundDataUri(name), /^data:audio\/wav;base64,UklGR/);
  }
  assert.notEqual(soundDataUri("correct"), soundDataUri("wrong"));
});

function fakeWin({ playOk = true } = {}) {
  const audios = [];
  class FakeAudio {
    constructor() { this.src = ""; this.paused = true; this.ended = false; this.plays = []; audios.push(this); }
    setAttribute() {}
    pause() { this.paused = true; }
    play() { this.plays.push(this.src); this.paused = false; return playOk ? Promise.resolve() : Promise.reject(Object.assign(new Error("x"), { name: "NotAllowedError" })); }
  }
  return { audios, win: { Audio: FakeAudio, SpeechSynthesisUtterance: class { constructor(t) { this.text = t; } }, speechSynthesis: { cancel() {}, getVoices: () => [], speak() {} } } };
}

test("a tap primes the shared pronunciation element so later auto-play (听音选词) reuses the unlocked element", async () => {
  __resetPronunciationForTests();
  const { win, audios } = fakeWin();
  unlockPronunciationAudio(win);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(isPronunciationUnlocked(), true);
  assert.match(audios[0].plays[0], /^data:audio\/wav/);
  pronounce("marquee", { win });
  pronounce("resilient", { win });
  assert.equal(audios.length, 1, "same element reused for every card");
  assert.match(audios[0].plays.at(-1), /audio=resilient/);
});

test("unlock retries on the next tap if the first attempt was blocked, and never interrupts a playing word", async () => {
  __resetPronunciationForTests();
  const blocked = fakeWin({ playOk: false });
  unlockPronunciationAudio(blocked.win);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(isPronunciationUnlocked(), false);
  unlockPronunciationAudio(blocked.win);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(blocked.audios[0].plays.length, 2, "second tap tries again");

  __resetPronunciationForTests();
  const ok = fakeWin();
  ok.audios.length = 0;
  pronounce("marquee", { win: ok.win });
  const playing = ok.audios[0];
  playing.play = () => new Promise(() => {}); // still loading
  unlockPronunciationAudio(ok.win);
  assert.match(playing.src, /audio=marquee/, "word not replaced by silent unlock clip");
});
