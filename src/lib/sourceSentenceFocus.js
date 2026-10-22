import { articleParagraphs } from "./dailyArticlesFormat.js";
import { toSec } from "./timecode.js";

const ABBREVIATION = /\b(?:Mr|Mrs|Ms|Dr|St|Prof|Sr|Jr|vs|etc|e\.g|i\.e|U\.S|U\.K)\./gi;

/** Split a paragraph or cue into sentences. Newlines are boundaries, same as transcript import. */
export function splitSourceSentences(text) {
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return [];
  const protectedText = raw.replace(ABBREVIATION, (match) => match.replaceAll(".", "\u0001"));
  return protectedText
    .split(/(?<=[.!?。！？]["”'’)]?)\s+|(?<=[。！？])(?=[^\s])|\n+/)
    .map((part) => part.replaceAll("\u0001", ".").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function expressionPattern(expression) {
  const tokens = String(expression || "").trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const body = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  return new RegExp(`(?:^|[^A-Za-z0-9])(${body})(?=$|[^A-Za-z0-9])`, "i");
}

export function textHasExpression(text, expression) {
  const pattern = expressionPattern(expression);
  return Boolean(pattern && pattern.test(String(text || "")));
}

export function focusSourceText(text, expression) {
  const sentences = splitSourceSentences(text);
  if (!sentences.length) return { before: "", sentence: "", after: "", index: -1, sentences, matched: false };
  const pattern = expressionPattern(expression);
  let index = pattern ? sentences.findIndex((sentence) => pattern.test(sentence)) : -1;
  const matched = index >= 0;
  if (!matched) index = 0;
  return {
    before: sentences[index - 1] || "",
    sentence: sentences[index] || "",
    after: sentences[index + 1] || "",
    index,
    sentences,
    matched,
  };
}

export function highlightParts(text, expression) {
  const source = String(text || "");
  const pattern = expressionPattern(expression);
  if (!pattern || !source) return [{ text: source, match: false }];
  const global = new RegExp(pattern.source, "ig");
  const parts = [];
  let cursor = 0;
  for (const match of source.matchAll(global)) {
    const word = match[1];
    const start = match.index + (match[0].length - word.length);
    if (start < cursor) continue;
    if (start > cursor) parts.push({ text: source.slice(cursor, start), match: false });
    parts.push({ text: source.slice(start, start + word.length), match: true });
    cursor = start + word.length;
  }
  if (cursor < source.length) parts.push({ text: source.slice(cursor), match: false });
  return parts.length ? parts : [{ text: source, match: false }];
}

/** Sentence-aligned translation. A paragraph-length gloss that does not line up is omitted. */
export function focusedTranslation(enText, zhText, expression) {
  const en = focusSourceText(enText, expression);
  const zhSentences = splitSourceSentences(zhText);
  if (!en.sentence || !zhSentences.length) return "";
  if (zhSentences.length === en.sentences.length) return zhSentences[en.index] || "";
  if (zhSentences.length === 1 && en.sentences.length === 1) return zhSentences[0];
  return "";
}

export function isHeadwordOnly(sentence, expression) {
  const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").trim();
  const left = normalize(sentence);
  const right = normalize(expression);
  return Boolean(left) && left === right;
}

export function shouldShowSentenceTranslation(translation, meaning) {
  const text = String(translation || "").trim();
  if (!text) return false;
  const gloss = String(meaning || "").trim();
  if (!gloss) return true;
  const glossHead = gloss.split(/[；;]/)[0].trim();
  return text !== gloss && text !== glossHead;
}

function cueStartSeconds(cue) {
  const numeric = Number(cue?.time_start);
  if (Number.isFinite(numeric) && String(cue?.time_start).trim() !== "" && !String(cue?.time_start).includes(":")) return numeric;
  const parsed = toSec(cue?.time_start);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/** Prefer the subtitle cue that actually contains the word, then the saved cue id. */
export function selectSentenceCue(source, subtitles, expression) {
  const list = Array.isArray(subtitles) ? subtitles : [];
  const matches = list.filter((cue) => textHasExpression(cue?.text_en, expression));
  if (!matches.length) return null;
  const preferredId = source?.source_subtitle_id;
  const byId = matches.find((cue) => preferredId && String(cue.id) === String(preferredId));
  if (byId) return byId;
  const anchor = Number(source?.source_time_start ?? source?.source_timestamp_seconds);
  if (Number.isFinite(anchor)) {
    const timed = matches
      .map((cue) => ({ cue, start: cueStartSeconds(cue) }))
      .filter((item) => Number.isFinite(item.start))
      .sort((a, b) => Math.abs(a.start - anchor) - Math.abs(b.start - anchor) || String(a.cue.text_en || "").length - String(b.cue.text_en || "").length);
    if (timed.length) return timed[0].cue;
  }
  return [...matches].sort((a, b) => String(a.text_en || "").length - String(b.text_en || "").length)[0];
}

/**
 * Keep a one-sentence cue on its existing loop range.
 * Only a cue whose text contains several sentences is narrowed to the sentence with the word.
 */
export function narrowLoopToSentence(loop, cueText, expression) {
  if (!loop || !Number.isFinite(loop.start) || !Number.isFinite(loop.end) || loop.end <= loop.start) return loop;
  const focus = focusSourceText(cueText, expression);
  if (!focus.matched || focus.sentences.length <= 1) return { start: loop.start, end: loop.end };
  const lengths = focus.sentences.map((sentence) => sentence.length);
  const total = lengths.reduce((sum, length) => sum + length, 0) || 1;
  const before = lengths.slice(0, focus.index).reduce((sum, length) => sum + length, 0);
  const duration = loop.end - loop.start;
  const start = loop.start + duration * (before / total);
  const end = Math.min(loop.end, loop.start + duration * ((before + lengths[focus.index]) / total));
  const safeEnd = Math.max(end, start + 0.35);
  return { start, end: Math.min(loop.end, safeEnd > start ? safeEnd : start + 0.35) };
}

export function articleReturnPath(source = {}) {
  const id = source.source_record_id;
  if (!id || !["article", "library_article"].includes(source.source_type)) return "";
  const base = source.source_type === "library_article"
    ? `/library-articles/${encodeURIComponent(id)}`
    : `/articles/${encodeURIComponent(id)}`;
  const expression = source.expression_en || source.text_en || "";
  const focus = focusSourceText(source.source_sentence_en || "", expression);
  const params = new URLSearchParams();
  if (focus.sentence) params.set("sentence", focus.sentence);
  if (expression) params.set("word", expression);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export function locateArticleSentence(body, { sentence = "", word = "" } = {}) {
  const wanted = String(sentence || "").trim();
  const paragraphs = articleParagraphs(body);
  let fallback = null;
  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
    const list = splitSourceSentences(paragraphs[paragraphIndex]);
    const sentences = list.length ? list : [paragraphs[paragraphIndex]];
    if (wanted) {
      let sentenceIndex = sentences.findIndex((item) => item === wanted);
      if (sentenceIndex < 0) sentenceIndex = sentences.findIndex((item) => item.includes(wanted));
      if (sentenceIndex < 0) sentenceIndex = sentences.findIndex((item) => wanted.includes(item) && item.length > 24);
      if (sentenceIndex >= 0) return { paragraphIndex, sentenceIndex };
    }
    if (word && textHasExpression(paragraphs[paragraphIndex], word) && !fallback) {
      const focus = focusSourceText(paragraphs[paragraphIndex], word);
      if (focus.matched) fallback = { paragraphIndex, sentenceIndex: focus.index };
    }
  }
  return fallback;
}
