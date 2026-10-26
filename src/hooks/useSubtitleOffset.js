import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getStudyCueLoopRange } from "@/lib/studyCueNavigation";
import {
  clampSubtitleOffsetMs,
  peekSubtitleOffsetMs,
  shiftLoopRange,
  subtitleOffsetStorageUser,
  writeSubtitleOffsetMs,
} from "@/lib/subtitleOffset";

// Per-video offset. The saved value is read during render, so the playhead
// highlight on that render already uses it. localStorage wins; the movie field
// is the fallback when this browser has no saved value yet.
export function useSubtitleOffset(videoKey, { aliasKeys = [], movieOffsetMs = null, onPersist } = {}) {
  const onPersistRef = useRef(onPersist);
  onPersistRef.current = onPersist;
  const [revision, setRevision] = useState(0);
  const storageUser = subtitleOffsetStorageUser();
  const aliasKey = aliasKeys.filter(Boolean).join("\n");
  const offsetMs = useMemo(
    () => peekSubtitleOffsetMs(videoKey, {
      aliasKeys: aliasKey ? aliasKey.split("\n") : [],
      movieOffsetMs,
    }),
    [videoKey, aliasKey, movieOffsetMs, revision, storageUser],
  );

  const setOffsetMs = useCallback((nextMs) => {
    const value = clampSubtitleOffsetMs(nextMs);
    if (videoKey) writeSubtitleOffsetMs(videoKey, value);
    setRevision((current) => current + 1);
    onPersistRef.current?.(value);
  }, [videoKey]);

  return [offsetMs, setOffsetMs];
}

// When the offset changes during close-reading, keep the loop on the shifted cue.
export function useShiftedCloseReadingLoop({ offsetMs, loopRangeRef, setLoopRange, getCue, getSubs }) {
  const previousRef = useRef(offsetMs);
  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = offsetMs;
    if (previous === offsetMs || !loopRangeRef?.current) return;
    const next = shiftLoopRange(getStudyCueLoopRange(getCue?.(), getSubs?.()), offsetMs);
    if (!next) return;
    loopRangeRef.current = next;
    setLoopRange?.(next);
  }, [offsetMs, getCue, getSubs, loopRangeRef, setLoopRange]);
}
