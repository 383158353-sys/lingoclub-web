import { isMasteredCard } from "./srs.js";

/** Corpus and mistake-list rows do not offer 斩 or 取消斩. */
export function listRowBuryControl() {
  return null;
}

/**
 * 斩 is only on the word-detail footer and the review footer.
 * A mastered card offers 取消斩 when restore is wired.
 */
export function detailBuryControl(card, { onBury, onRestore } = {}) {
  if (isMasteredCard(card)) {
    if (typeof onRestore !== "function") return null;
    return { label: "取消斩", action: "restore" };
  }
  if (typeof onBury !== "function") return null;
  return { label: "斩", action: "bury" };
}
