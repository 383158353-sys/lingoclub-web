import { useCallback, useRef, useState } from "react";
import { findCueAtTime } from "@/lib/timecode";
import { getAdjacentTranscriptCue } from "@/lib/studyCueNavigation";

/** Resolve keyboard actions from the player clock and request the shared transcript list to focus that cue. */
export function useTranscriptCueFocus({ subtitles, videoRef, fallbackTime, setActiveId, setSelectedCueId }) {
  const requestSequenceRef = useRef(0);
  const [focusRequest, setFocusRequest] = useState(null);

  const resolvePlaybackCue = useCallback(() => {
    const playerTime = videoRef.current?.getCurrentTime?.();
    const time = Number.isFinite(playerTime) ? playerTime : fallbackTime;
    return findCueAtTime(subtitles, time);
  }, [fallbackTime, subtitles, videoRef]);

  const focusTranscriptCue = useCallback((cue) => {
    if (!cue) return null;
    setActiveId(cue.id);
    setSelectedCueId?.(cue.id);
    requestSequenceRef.current += 1;
    setFocusRequest({ cueId: cue.id, requestId: requestSequenceRef.current });
    return cue;
  }, [setActiveId, setSelectedCueId]);

  const focusCurrentTranscriptCue = useCallback(() => (
    focusTranscriptCue(resolvePlaybackCue())
  ), [focusTranscriptCue, resolvePlaybackCue]);

  const focusTranscriptCueByIdOrTime = useCallback((cueId, time) => {
    const exact = cueId ? (subtitles || []).find((cue) => String(cue.id) === String(cueId)) : null;
    const byTime = Number.isFinite(Number(time)) ? findCueAtTime(subtitles, Number(time)) : null;
    return focusTranscriptCue(exact || byTime);
  }, [focusTranscriptCue, subtitles]);

  const focusAdjacentTranscriptCue = useCallback((direction) => {
    const playerTime = videoRef.current?.getCurrentTime?.();
    const time = Number.isFinite(playerTime) ? playerTime : fallbackTime;
    return focusTranscriptCue(getAdjacentTranscriptCue(subtitles, time, direction));
  }, [fallbackTime, focusTranscriptCue, subtitles, videoRef]);

  return { focusRequest, focusTranscriptCue, focusTranscriptCueByIdOrTime, focusCurrentTranscriptCue, focusAdjacentTranscriptCue, resolvePlaybackCue };
}
