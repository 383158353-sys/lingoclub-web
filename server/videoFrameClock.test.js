import test from "node:test";
import assert from "node:assert/strict";
import { observeVideoFrames } from "../src/lib/videoFrameClock.js";

function createVideo() {
  const listeners = new Map();
  const callbacks = new Map();
  let nextId = 0;
  return {
    currentTime: 0,
    paused: true,
    ended: false,
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
    removeEventListener(name, callback) {
      if (listeners.get(name) === callback) listeners.delete(name);
    },
    emit(name) {
      listeners.get(name)?.();
    },
    requestVideoFrameCallback(callback) {
      const id = ++nextId;
      callbacks.set(id, callback);
      return id;
    },
    cancelVideoFrameCallback(id) {
      callbacks.delete(id);
    },
    renderFrame() {
      const [id, callback] = callbacks.entries().next().value || [];
      if (callback) {
        callbacks.delete(id);
        callback();
      }
    },
    pendingFrameCount() {
      return callbacks.size;
    },
    listenerCount() {
      return listeners.size;
    },
  };
}

test("native video frames update the clock between sparse timeupdate events", () => {
  const video = createVideo();
  const sampledTimes = [];
  const stop = observeVideoFrames(video, (time) => sampledTimes.push(time));

  video.paused = false;
  video.emit("play");
  video.currentTime = 1.1;
  video.renderFrame();
  video.currentTime = 1.2;
  video.renderFrame();

  assert.deepEqual(sampledTimes, [0, 1.1, 1.2]);
  assert.equal(video.pendingFrameCount(), 1);

  video.paused = true;
  video.emit("pause");
  assert.equal(video.pendingFrameCount(), 0);
  stop();
  assert.equal(video.listenerCount(), 0);
});
