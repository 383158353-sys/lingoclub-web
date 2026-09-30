import { useCallback, useRef, useState } from "react";
import { findCueAtTime } from "@/lib/timecode";

/** Resolve keyboard actions from the player clock and request the shared transcript list to focus that cue. */
export function useTranscriptCueFocus({ subtitles, videoRef, fallbackTime, setActiveId }) {
  const requestSequenceRef = useRef(0);
  const [focusRequest, setFocusRequest] = useState(null);

  const resolvePlaybackCue = useCallback(() => {
    const playerTime = videoRef.current?.getCurrentTime?.();
    const time = Number.isFinite(playerTime) ? playerTime : fallbackTime;
    return findCueAtTime(subtitles, time);
  }, [fallbackTime, subtitles, videoRef]);

  const focusCurrentTranscriptCue = useCallback(() => {
    const cue = resolvePlaybackCue();
    if (!cue) return null;
    setActiveId(cue.id);
    requestSequenceRef.current += 1;
    setFocusRequest({ cueId: cue.id, requestId: requestSequenceRef.current });
    return cue;
  }, [resolvePlaybackCue, setActiveId]);

  return { focusRequest, focusCurrentTranscriptCue, resolvePlaybackCue };
}
