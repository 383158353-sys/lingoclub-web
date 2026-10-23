import { isHeadwordOnly } from "./sourceSentenceFocus.js";
import { inferExpressionType } from "./wordProfile.js";

const MUSIC_NOTE = /[♪♫♩♬\u2669-\u266F]/;

/** Collapse subtitle music notes and line breaks into one prose sentence. */
export function compactExpressionText(expression = "") {
  return String(expression || "").replace(new RegExp(MUSIC_NOTE.source, "g"), " ").replace(/\s+/g, " ").trim();
}

/**
 * Long sentences and lyric cues stay in the compact detail style.
 * A single headword keeps the large dictionary title.
 */
export function detailExpressionPresentation(expression = "", expressionType = "") {
  const raw = String(expression || "");
  const text = compactExpressionText(raw);
  const type = ["word", "phrase", "sentence"].includes(expressionType) ? expressionType : inferExpressionType(text || raw);
  const lyricLike = MUSIC_NOTE.test(raw) || /[\r\n]/.test(raw);
  const words = text ? text.split(/\s+/).length : 0;
  const compact = type === "sentence" || lyricLike || text.length > 48 || words > 8;
  return { text: text || raw.trim(), compact, expressionType: type };
}

/** sent. / phr. are type tags, not part-of-speech labels on the detail card. */
export function detailPosLabel(pos = "") {
  const label = String(pos || "").trim();
  if (!label || /^(sent|phr)\.?$/i.test(label)) return "";
  return label;
}

export function showRecallSentence(sentence, expression, { compact = false } = {}) {
  const visibleSentence = compact ? compactExpressionText(sentence) : String(sentence || "").trim();
  if (!visibleSentence) return false;
  const headword = compact ? compactExpressionText(expression) : expression;
  return !isHeadwordOnly(visibleSentence, headword);
}
