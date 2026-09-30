import { useEffect, useRef } from "react";

const EDITABLE_TARGET_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='textbox']",
  "[role='searchbox']",
  "[role='combobox']",
].join(",");

/** Bind study keyboard controls without owning playback or close-reading state. */
export function useGlobalVideoSpace({ togglePlayback, enabled = true, isCloseReadingLoop, exitCloseReading, startCloseReading, focusCurrentCue }) {
  const toggleRef = useRef(togglePlayback);
  const loopingRef = useRef(isCloseReadingLoop);
  const exitRef = useRef(exitCloseReading);
  const startRef = useRef(startCloseReading);
  const focusRef = useRef(focusCurrentCue);
  const altPressedRef = useRef(false);
  const altChordRef = useRef(false);
  toggleRef.current = togglePlayback;
  loopingRef.current = isCloseReadingLoop;
  exitRef.current = exitCloseReading;
  startRef.current = startCloseReading;
  focusRef.current = focusCurrentCue;

  useEffect(() => {
    if (!enabled) return undefined;

    const isEditableOrModal = (event) => {
      const target = event.target;
      return (target instanceof Element && target.closest(EDITABLE_TARGET_SELECTOR))
        || Boolean(document.querySelector("[role='dialog'], dialog[open], [data-radix-dialog-content]"));
    };

    const isAltKey = (event) => event.code === "AltLeft" || event.code === "AltRight";

    const onKeyDown = (event) => {
      if (event.defaultPrevented || event.isComposing || isEditableOrModal(event)) return;

      if (isAltKey(event)) {
        // A bare Alt is handled on keyup. Delay the action so Alt+Tab and other
        // browser/OS chords never toggle close reading accidentally.
        event.preventDefault();
        if (!event.repeat && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
          altPressedRef.current = true;
          altChordRef.current = false;
        }
        return;
      }

      if (altPressedRef.current) {
        altChordRef.current = true;
        if (event.altKey) event.preventDefault();
      }

      if (event.code === "Space" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        // Space always controls playback, including while a button has focus.
        // Capture phase prevents the focused button's native Space activation.
        event.preventDefault();
        if (event.repeat) return;
        focusRef.current?.();
        if (loopingRef.current) exitRef.current?.();
        toggleRef.current?.();
        return;
      }
    };

    const onKeyUp = (event) => {
      if (!isAltKey(event)) return;
      const shouldToggle = altPressedRef.current && !altChordRef.current && !isEditableOrModal(event);
      altPressedRef.current = false;
      altChordRef.current = false;
      event.preventDefault();
      if (shouldToggle) startRef.current?.();
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      altPressedRef.current = false;
      altChordRef.current = false;
    };
  }, [enabled]);
}
