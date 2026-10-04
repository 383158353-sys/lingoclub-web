const NOTES = [
  { frequency: 523.25, offset: 0 },
  { frequency: 783.99, offset: 0.085 },
];

/** A quiet, short two-note success cue for a correct review answer. */
export function playCorrectAnswerChime({ AudioContextConstructor, scheduleClose = setTimeout } = {}) {
  const Context = AudioContextConstructor || globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context) return false;

  let context;
  try {
    context = new Context();
    const play = () => {
      const now = context.currentTime;
      const master = context.createGain();
      master.gain.setValueAtTime(0.16, now);
      master.connect(context.destination);

      for (const note of NOTES) {
        const start = now + note.offset;
        const oscillator = context.createOscillator();
        const envelope = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(note.frequency, start);
        envelope.gain.setValueAtTime(0.0001, start);
        envelope.gain.exponentialRampToValueAtTime(0.24, start + 0.025);
        envelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.27);
        oscillator.connect(envelope);
        envelope.connect(master);
        oscillator.start(start);
        oscillator.stop(start + 0.29);
      }
      scheduleClose(() => { context.close?.().catch?.(() => {}); }, 650);
    };

    if (context.state === "suspended" && context.resume) {
      Promise.resolve(context.resume()).then(play).catch(() => context.close?.().catch?.(() => {}));
    } else {
      play();
    }
    return true;
  } catch {
    try { context?.close?.().catch?.(() => {}); } catch { /* audio is optional */ }
    return false;
  }
}
