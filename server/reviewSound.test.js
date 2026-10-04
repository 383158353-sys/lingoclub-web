import test from "node:test";
import assert from "node:assert/strict";
import { playCorrectAnswerChime } from "../src/lib/reviewSound.js";

function fakeAudioContext(state = "running") {
  const notes = [];
  const timers = [];
  const context = {
    state,
    currentTime: 10,
    destination: {},
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
    },
    createOscillator() {
      const note = { frequency: { setValueAtTime(value, at) { note.hz = value; note.at = at; } }, connect() {}, start(at) { note.startedAt = at; }, stop(at) { note.stoppedAt = at; } };
      notes.push(note);
      return note;
    },
    resume() { context.resumed = true; return Promise.resolve(); },
    close() { context.closed = true; return Promise.resolve(); },
  };
  class Context { constructor() { return context; } }
  return { Context, context, notes, timers, scheduleClose(callback, delay) { timers.push({ callback, delay }); } };
}

test("correct-answer chime plays a short, quiet ascending two-note cue and releases audio context", () => {
  const audio = fakeAudioContext();
  assert.equal(playCorrectAnswerChime({ AudioContextConstructor: audio.Context, scheduleClose: audio.scheduleClose }), true);
  assert.equal(audio.notes.length, 2);
  assert.deepEqual(audio.notes.map((note) => note.hz), [523.25, 783.99]);
  assert.deepEqual(audio.notes.map((note) => note.startedAt), [10, 10.085]);
  assert.ok(audio.notes.every((note) => note.stoppedAt - note.startedAt < 0.3));
  assert.equal(audio.timers[0].delay, 650);
  audio.timers[0].callback();
  assert.equal(audio.context.closed, true);
});

test("correct-answer chime resumes a suspended mobile audio context", async () => {
  const audio = fakeAudioContext("suspended");
  assert.equal(playCorrectAnswerChime({ AudioContextConstructor: audio.Context, scheduleClose: audio.scheduleClose }), true);
  await Promise.resolve();
  assert.equal(audio.context.resumed, true);
  assert.equal(audio.notes.length, 2);
});

test("correct-answer chime degrades silently when Web Audio is unavailable", () => {
  assert.equal(playCorrectAnswerChime({ AudioContextConstructor: null }), false);
});
