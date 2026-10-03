const LOC_TC_PREFIX_RX =
  /^\s*(?:\d+\s*(?:分(?:鐘|钟)?|min(?:ute)?s?)\s*(?:\d+\s*(?:秒(?:钟)?|sec(?:ond)?s?))?|\d+\s*(?:秒(?:钟)?|sec(?:ond)?s?))\s*[-–—:♪♫♩♬\s]*/i;

export function cleanSubtitleText(text) {
  if (!text) return "";
  return String(text).replace(LOC_TC_PREFIX_RX, "").replace(/\s+/g, " ").trim();
}

const TERMINAL_PUNCTUATION = /[.!?…]["'’”)]?$/;
const CONTINUATION_START = /^(?:and|but|or|so|because|that|which|if|when|while|though|although|unless|until|as|to|of|in|on|at|by|for|with|from|into|over|under|about|who|whose|whom|where|what|how|than|then)\b/i;
const NEW_THOUGHT_START = /^(?:i|it's|it is|he|she|they|we|you|that is|that's|this is|there is|there's|well|look|listen|anyway|so)\b/i;

function toSeconds(value) {
  if (value == null || value === "") return NaN;
  const parts = String(value).replace(",", ".").trim().split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return NaN;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts.length === 1 ? parts[0] : NaN;
}

function stableTextHash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function sentenceParts(text) {
  const parts = [];
  const matcher = /[^.!?]+(?:[.!?]+["'’”)]*)?|[.!?]+/g;
  let match;
  while ((match = matcher.exec(text)) !== null) {
    const part = match[0].trim();
    if (part) parts.push(part);
  }
  const withDiscourseSplits = (parts.length ? parts : [text.trim()]).flatMap((part) => {
    const matches = [...part.matchAll(/\s+(?=(?:it's just like|it's like|well,|look,|listen,|anyway,|the thing is)\b)/gi)];
    if (!matches.length) return [part];
    const result = [];
    let cursor = 0;
    for (const match of matches) {
      const at = match.index + match[0].length;
      if (at > cursor) result.push(part.slice(cursor, at).trim());
      cursor = at;
    }
    if (cursor < part.length) result.push(part.slice(cursor).trim());
    return result.filter(Boolean);
  });
  return withDiscourseSplits;
}

/**
 * Convert timed caption fragments into learning sentences while retaining the
 * exact source-fragment range. Caption timing is never divided proportionally:
 * each sentence spans the first through last fragment that supplied its words.
 */
export function mergeFragments(subs, opts = {}) {
  if (!Array.isArray(subs) || !subs.length) return [];
  const maxGapSec = opts.maxGapSec ?? 2.6;
  const maxLen = opts.maxLen ?? 360;
  const fragments = subs.map((source, index) => ({
    ...source,
    sourceSubtitleId: source.sourceSubtitleId || source.id || `source-${index}`,
    sourceIndex: Number.isInteger(source.sourceIndex) ? source.sourceIndex : index,
    text_en: cleanSubtitleText(source.text_en || source.text || ""),
  })).filter((fragment) => fragment.text_en);

  // Split genuine punctuation boundaries within a fragment, but retain that
  // fragment's complete original time span for every resulting sentence.
  const units = fragments.flatMap((fragment) => sentenceParts(fragment.text_en).map((text) => ({ ...fragment, text_en: text })));
  const sentences = [];
  let current = null;
  const finish = () => {
    if (!current) return;
    const uniqueFragments = [...new Map(current.fragments.map((fragment) => [fragment.sourceSubtitleId, fragment])).values()];
    const first = uniqueFragments[0];
    const last = uniqueFragments.at(-1);
    const text = current.text.trim();
    const sentenceId = `sentence:${uniqueFragments.map((fragment) => fragment.sourceSubtitleId).join("+")}:${stableTextHash(text.toLowerCase())}`;
    sentences.push({
      ...(first || {}),
      id: sentenceId,
      sentenceId,
      text_en: text,
      time_start: first?.time_start || "",
      time_end: last?.time_end || last?.time_start || "",
      start: first?.time_start || "",
      end: last?.time_end || last?.time_start || "",
      sourceFragmentIds: uniqueFragments.map((fragment) => fragment.sourceSubtitleId),
      sourceStartIndex: first?.sourceIndex ?? 0,
      sourceEndIndex: last?.sourceIndex ?? 0,
      order: sentences.length + 1,
    });
    current = null;
  };

  for (const fragment of units) {
    const text = fragment.text_en.trim();
    if (!current) {
      current = { text, fragments: [fragment] };
      continue;
    }
    const previousText = current.text.trim();
    const lastFragment = current.fragments.at(-1);
    const end = toSeconds(lastFragment?.time_end);
    const nextStart = toSeconds(fragment.time_start);
    const gap = Number.isFinite(end) && Number.isFinite(nextStart) ? nextStart - end : 0;
    const explicitEnd = TERMINAL_PUNCTUATION.test(previousText);
    const continuation = CONTINUATION_START.test(text);
    const capitalizedThought = /^[A-Z]/.test(text) && NEW_THOUGHT_START.test(text);
    const longGap = gap > maxGapSec;
    const lengthGuard = current.text.length + text.length + 1 > maxLen;
    const split = explicitEnd || (!continuation && (capitalizedThought || longGap || lengthGuard));
    if (split) finish();
    if (!current) current = { text, fragments: [fragment] };
    else {
      current.text = `${current.text} ${text}`;
      current.fragments.push(fragment);
    }
  }
  finish();

  return sentences.map((sentence) => ({
    ...sentence,
    text_en: TERMINAL_PUNCTUATION.test(sentence.text_en) ? sentence.text_en : `${sentence.text_en}.`,
    timestamp: sentence.time_start,
  }));
}
