import { isMasteredCard } from "./srs.js";

/** Corpus and mistake-list rows do not offer destructive actions inline. */
export function listRowBuryControl() {
  return null;
}

/** Keep the legacy bury action available to older callers; current detail views delete. */
export function detailBuryControl(card, { onBury, onRestore, onDelete } = {}) {
  if (typeof onDelete === "function") return { label: "删除", action: "delete" };
  if (isMasteredCard(card)) {
    if (typeof onRestore !== "function") return null;
    return { label: "取消斩", action: "restore" };
  }
  if (typeof onBury !== "function") return null;
  return { label: "斩", action: "bury" };
}
