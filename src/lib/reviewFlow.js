const PHASES = ["r1", "r2", "r3"];

export function scheduleReviewAutoAdvance(phase, callback, schedule = setTimeout) {
  return schedule(callback, phase === "r3" ? 1600 : 700);
}

export function advanceReviewQuestion({ phase, idx, queueLength }) {
  const nextIndex = idx + 1;
  if (nextIndex < queueLength) return { phase, idx: nextIndex, done: false };
  const phaseIndex = PHASES.indexOf(phase);
  if (phaseIndex >= 0 && phaseIndex < PHASES.length - 1) {
    return { phase: PHASES[phaseIndex + 1], idx: 0, done: false };
  }
  return { phase: "done", idx: 0, done: true };
}

export function createAnswerCommitGate() {
  let activeToken = null;
  let committedToken = null;
  return {
    activate(token) {
      activeToken = token;
      if (committedToken !== token) committedToken = null;
    },
    tryCommit(token) {
      if (!token || token !== activeToken || committedToken === token) return false;
      committedToken = token;
      return true;
    },
  };
}

export function createReviewQuestionToken(baseToken, previous) {
  if (previous?.baseToken === baseToken) return previous;
  return { baseToken, token: `${baseToken}:${(previous?.epoch || 0) + 1}`, epoch: (previous?.epoch || 0) + 1 };
}
