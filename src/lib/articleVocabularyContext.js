import { splitSourceSentences, textHasExpression } from "./sourceSentenceFocus.js";

function words(value) {
  return String(value || "").toLowerCase().match(/[a-z]+(?:['’-][a-z]+)*/g) || [];
}

function forms(token) {
  const result = new Set([token]);
  if (token.endsWith("ies")) result.add(`${token.slice(0, -3)}y`);
  if (token.endsWith("s") && !token.endsWith("ss")) result.add(token.slice(0, -1));
  if (token.endsWith("es")) result.add(token.slice(0, -2));
  for (const item of [...result]) {
    const stem = item.replace(/(?:ing|ed)$/, "");
    result.add(stem);
    result.add(stem.replace(/e$/, ""));
    result.add(stem.replace(/([a-z])\1$/, "$1"));
  }
  return result;
}

function matchesSequence(sentence, expression) {
  const wanted = words(expression).map(forms);
  const actual = words(sentence).map(forms);
  if (!wanted.length) return false;
  return actual.some((_, start) => wanted.every((options, index) => {
    const candidate = actual[start + index];
    return candidate && [...options].some((form) => candidate.has(form));
  }));
}

/** Recover real article text, never a generated example or a headword-only copy. */
export function articleVocabularyContext(body, expression) {
  const phrase = String(expression || "").split(/\+|\s\/\s/)[0].trim();
  const candidates = splitSourceSentences(body).filter((sentence) => words(sentence).length > words(phrase).length);
  const exact = candidates.find((sentence) => textHasExpression(sentence, phrase));
  if (exact) return exact;
  const normalized = phrase.replace(/^be\s+/i, "").replace(/\s+to\s+do$/i, " to");
  return candidates.find((sentence) => matchesSequence(sentence, normalized)) || "";
}
