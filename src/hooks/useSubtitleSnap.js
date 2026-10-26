import { useCallback, useEffect, useRef, useState } from "react";
import { fromSec, toSec } from "@/lib/timecode";
import {
  activeCueForLocalStudy,
  alignSubtitleOffsetMs,
  clampSubtitleOffsetMs,
  formatSubtitleOffset,
  snapSampleTime,
} from "@/lib/subtitleOffset";

const PREVIEW_LEAD_MS = 280;
const PREVIEW_PLAY_MS = 1600;

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
    const sampled = snapSampleTime(live, parkedRef.current);
    if (sampled == null) return null;
    if (sampled !== parkedRef.current) parkedRef.current = null;
    return sampled;
  }, []);

  const reveal = useCallback((nextOffset, time) => {
    const cue = Number.isFinite(time) ? activeCueForLocalStudy(subsRef.current, time, nextOffset) : null;
    if (cue) focusCueRef.current?.(cue);
    else setActiveIdRef.current?.(null);
    return cue;
  }, []);

  const preview = useCallback((time) => {
    if (!Number.isFinite(time)) return;
    if (parkedRef.current == null) parkedRef.current = time;
    const start = parkedRef.current;
    clearTimers();
    pauseRef.current?.(start);
    const playId = setTimeout(() => {
      playRef.current?.(start);
      const stopId = setTimeout(() => {
        pauseRef.current?.();
        parkedRef.current = null;
      }, PREVIEW_PLAY_MS);
      timersRef.current.push(stopId);
    }, PREVIEW_LEAD_MS);
    timersRef.current.push(playId);
  }, [clearTimers]);

  const applyOffset = useCallback((nextMs, source = "set", explicitTime = null) => {
    if (source !== "nudge") parkedRef.current = null;
    const value = clampSubtitleOffsetMs(nextMs);
    setOffsetMsRef.current?.(value);
    const time = Number.isFinite(explicitTime) ? explicitTime : sampleTime();
    const cue = reveal(value, time);
    const label = formatSubtitleOffset(value);
    const line = cue ? `此刻应对：${oneLine(cue.text_en || cue.text_zh)}` : "此刻没有对上的台词";
    setNotice(source === "align" ? `已对齐为 ${label}。${line}` : `已设为 ${label}。${line}`);
    setPreviewToken((current) => current + 1);
    if (time != null) preview(time);
    return value;
  }, [preview, reveal, sampleTime]);

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
    clearTimers();
    const time = readClock(getCurrentTimeRef.current);
    if (time == null) {
      setNotice("还读不到播放位置。先把视频停在说出这句的地方。");
      return null;
    }
    pauseRef.current?.(time);
    const value = alignSubtitleOffsetMs(time, anchor.startSec);
    if (value == null) return null;
    return applyOffset(value, "align", time);
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
