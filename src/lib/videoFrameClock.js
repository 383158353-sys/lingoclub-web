export function observeVideoFrames(video, onFrame) {
  if (!video || typeof onFrame !== "function") return () => {};

  const usesVideoFrameCallback = typeof video.requestVideoFrameCallback === "function";
  let frameId = null;
  let running = false;

  const cancelFrame = () => {
    if (frameId == null) return;
    if (usesVideoFrameCallback) video.cancelVideoFrameCallback?.(frameId);
    else cancelAnimationFrame(frameId);
    frameId = null;
  };

  const tick = () => {
    frameId = null;
    if (!running) return;
    onFrame(video.currentTime);
    if (!running || video.paused || video.ended) {
      running = false;
      return;
    }
    frameId = usesVideoFrameCallback
      ? video.requestVideoFrameCallback(tick)
      : requestAnimationFrame(tick);
  };

  const start = () => {
    if (running) return;
    running = true;
    tick();
  };

  const stop = () => {
    running = false;
    cancelFrame();
  };

  video.addEventListener("play", start);
  video.addEventListener("pause", stop);
  video.addEventListener("ended", stop);
  if (!video.paused && !video.ended) start();

  return () => {
    stop();
    video.removeEventListener("play", start);
    video.removeEventListener("pause", stop);
    video.removeEventListener("ended", stop);
  };
}
