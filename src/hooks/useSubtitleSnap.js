import { useCallback, useEffect, useRef, useState } from "react";
import { fromSec, toSec } from "@/lib/timecode";
import {
  activeCueForLocalStudy,
  alignSubtitleOffsetMs,
  clampSubtitleOffsetMs,
  cueForOffsetPreview,
  formatSubtitleOffset,
  previewStillOnParkedFrame,
  subtitleOffsetPreviewSpan,
} from "@/lib/subtitleOffset";

const PREVIEW_LEAD_MS = 80;

function oneLine(text, max = 48) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export function cueAnchorFromSubtitle(cue) {
  if (!cue) return null;
  const startSec = toSec(cue.time_start ?? cue.startSec);
  if (!Number.isFinite(startSec)) return null;
  return {
    id: cue.id ?? null,
    text: oneLine(cue.text_en || cue.text_zh || cue.text, 80) || "（无文本）",
    startSec,
    timeLabel: fromSec(startSec),
  };
}

function readClock(getCurrentTime) {
  try {
    const time = Number(getCurrentTime?.());
    return Number.isFinite(time) ? time : null;
  } catch {
    return null;
  }
}

export function offsetPreviewControls({ simulated, videoRef, setSimTime, setClockRunning }) {
  const play = (sec) => {
    if (simulated) {
      if (Number.isFinite(sec)) setSimTime?.(sec);
      setClockRunning?.(true);
      return;
    }
    const api = videoRef?.current;
    if (!api) return;
    try {
      if (Number.isFinite(sec)) api.play?.(sec);
      else api.playOnly?.();
    } catch { /* autoplay can reject */ }
  };
  const pause = (sec) => {
    if (simulated) {
      if (Number.isFinite(sec)) setSimTime?.(sec);
      setClockRunning?.(false);
      return;
    }
    const api = videoRef?.current;
    if (!api) return;
    try {
      if (Number.isFinite(sec)) api.pause?.(sec);
      else api.pauseOnly?.();
    } catch { /* noop */ }
  };
  return { play, pause };
}

export function useSubtitleSnap({
  subtitles,
  offsetMs,
  setOffsetMs,
  getCurrentTime,
  getActiveCue,
  focusCue,
  setActiveId,
  play,
  pause,
}) {
  const [anchor, setAnchor] = useState(null);
  const [notice, setNotice] = useState("");
  const [previewToken, setPreviewToken] = useState(0);
  const parkedRef = useRef(null);
  const previewSpanRef = useRef(null);
  const timersRef = useRef([]);
  const subsRef = useRef(subtitles);
  const offsetRef = useRef(offsetMs);
  const getCurrentTimeRef = useRef(getCurrentTime);
  const getActiveCueRef = useRef(getActiveCue);
  const focusCueRef = useRef(focusCue);
  const setActiveIdRef = useRef(setActiveId);
  const setOffsetMsRef = useRef(setOffsetMs);
  const playRef = useRef(play);
  const pauseRef = useRef(pause);
  subsRef.current = subtitles;
  offsetRef.current = offsetMs;
  getCurrentTimeRef.current = getCurrentTime;
  getActiveCueRef.current = getActiveCue;
  focusCueRef.current = focusCue;
  setActiveIdRef.current = setActiveId;
  setOffsetMsRef.current = setOffsetMs;
  playRef.current = play;
  pauseRef.current = pause;

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((id) => clearTimeout(id));
    timersRef.current = [];
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const sampleTime = useCallback(() => {
    const live = readClock(getCurrentTimeRef.current);
    const parked = parkedRef.current;
    if (previewStillOnParkedFrame(live, parked, previewSpanRef.current)) return parked;
    parkedRef.current = null;
    previewSpanRef.current = null;
    return Number.isFinite(live) ? live : null;
  }, []);

  const preview = useCallback((time, cue, offset) => {
    const span = cue ? subtitleOffsetPreviewSpan(cue, offset) : null;
    const start = span?.start ?? time;
    const end = span?.end ?? (Number.isFinite(time) ? Math.round((time + 1.6) * 1000) / 1000 : null);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    if (parkedRef.current == null && Number.isFinite(time)) parkedRef.current = time;
    previewSpanRef.current = { start, end };
    clearTimers();
    const playId = setTimeout(() => {
      playRef.current?.(start);
      const stopId = setTimeout(() => pauseRef.current?.(), Math.max(400, (end - start) * 1000));
      timersRef.current.push(stopId);
    }, PREVIEW_LEAD_MS);
    timersRef.current.push(playId);
  }, [clearTimers]);

  const applyOffset = useCallback((nextMs, source = "set", explicitTime = null, preferredCue = null) => {
    const value = clampSubtitleOffsetMs(nextMs);
    setOffsetMsRef.current?.(value);
    const time = Number.isFinite(explicitTime) ? explicitTime : sampleTime();
    const cue = cueForOffsetPreview(subsRef.current, time ?? 0, value, preferredCue);
    if (cue) focusCueRef.current?.(cue);
    else setActiveIdRef.current?.(null);
    const label = formatSubtitleOffset(value);
    const line = cue ? `正在播放：${oneLine(cue.text_en || cue.text_zh)}` : "此刻没有对上的台词";
    setNotice(source === "align" ? `已对齐为 ${label}。${line}` : `已设为 ${label}。${line}`);
    setPreviewToken((current) => current + 1);
    if (time != null || cue) preview(time, cue, value);
    return value;
  }, [preview, sampleTime]);

  const pickCue = useCallback((cue) => {
    const next = cueAnchorFromSubtitle(cue);
    if (!next) {
      setNotice("这句没有时间码，不能当作卡点");
      return null;
    }
    setAnchor(next);
    setNotice(`已记下卡点：${next.text}`);
    return next;
  }, []);

  const pickActiveCue = useCallback(() => {
    const time = readClock(getCurrentTimeRef.current);
    const fromClock = Number.isFinite(time) ? activeCueForLocalStudy(subsRef.current, time, offsetRef.current) : null;
    const cue = fromClock || getActiveCueRef.current?.() || null;
    if (!cue) {
      setNotice("当前没有高亮句。先播放，或在台词列表点一句。");
      return null;
    }
    return pickCue(cue);
  }, [pickCue]);

  const alignToPlayhead = useCallback(() => {
    if (!anchor) {
      setNotice("先点要对的那句，或点「用当前高亮句卡点」");
      return null;
    }
    parkedRef.current = null;
    previewSpanRef.current = null;
    clearTimers();
    const time = readClock(getCurrentTimeRef.current);
    if (time == null) {
      setNotice("还读不到播放位置。先把视频停在说出这句的地方。");
      return null;
    }
    pauseRef.current?.(time);
    const value = alignSubtitleOffsetMs(time, anchor.startSec);
    if (value == null) return null;
    const cue = subsRef.current.find((item) => anchor.id != null && String(item.id) === String(anchor.id))
      || { id: anchor.id, time_start: anchor.startSec, text_en: anchor.text };
    return applyOffset(value, "align", time, cue);
  }, [anchor, applyOffset, clearTimers]);

  const liveTime = readClock(getCurrentTime);
  const matchedCue = activeCueForLocalStudy(subtitles, liveTime, offsetMs);

  return {
    anchor,
    notice,
    matchedCue,
    previewToken,
    applyOffset,
    pickCue,
    pickActiveCue,
    alignToPlayhead,
  };
}
