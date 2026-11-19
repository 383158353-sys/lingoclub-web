const COMMON_CONFUSABLES = {
  though: { expressions: ["thought", "through", "thorough"], meanings: ["想法", "通过", "彻底的"] },
  thought: { expressions: ["though", "through", "thorough"], meanings: ["虽然", "通过", "彻底的"] },
  through: { expressions: ["though", "thought", "thorough"], meanings: ["虽然", "想法", "彻底的"] },
  thorough: { expressions: ["though", "thought", "through"], meanings: ["虽然", "想法", "通过"] },
};

const normalize = (value) => String(value || "").trim().toLowerCase();
const meaningKey = (value) => normalize(value).split(/[\s，。；;、,：:！!？?（）()\[\]【】/\\·]+/).filter(Boolean).sort().join("");
const isChineseMeaning = (value) => /[\u3400-\u9fff]/.test(value) && !/[a-z]/i.test(value);

function nearDuplicateMeaning(left, right) {
  const a = meaningKey(left);
  const b = meaningKey(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 6) return false;
  return editDistance(a, b) / Math.max(a.length, b.length) <= 0.12;
}

function editDistance(a, b) {
  const left = normalize(a);
  const right = normalize(b);
  const row = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = row[j];
      row[j] = left[i - 1] === right[j - 1] ? diagonal : Math.min(diagonal + 1, row[j] + 1, row[j - 1] + 1);
      diagonal = above;
    }
  }
  return row[right.length];
}

function profileOf(card) {
  return card?.profile && typeof card.profile === "object" ? card.profile : {};
}

function tokens(value) {
  return normalize(value).split(/[^a-z0-9]+/).filter(Boolean);
}

function characterPairs(value, minimum = 1) {
  const text = String(value || "").replace(/\s/g, "");
  const size = text.length > 3 ? 2 : 1;
  const pairs = new Set();
  for (let index = 0; index <= text.length - size; index += 1) pairs.add(text.slice(index, index + size));
  if (pairs.size < minimum && text) pairs.add(text);
  return pairs;
}

function diceSimilarity(left, right) {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return (2 * shared) / (left.size + right.size);
}

function stableTieBreak(left, right) {
  const input = `${left}:${right}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  return hash >>> 0;
}

export function createReviewDistractorIndex(pool) {
  return {
    entries: (Array.isArray(pool) ? pool : []).map((card) => {
      const profile = profileOf(card);
      const expression = card?.expression_en || card?.text_en || "";
      const meaning = card?.meaning_zh || card?.text_zh || "";
      return {
        card,
        expression: normalize(expression),
        expressionChars: characterPairs(expression, 2),
        expressionTokens: new Set(tokens(expression)),
        meaningKey: meaningKey(meaning),
        meaningChars: characterPairs(String(meaning).replace(/[^\u3400-\u9fff]/g, ""), 1),
        pos: normalize(profile.pos || card?.pos),
        type: normalize(card?.type || "phrase"),
        source: normalize(card?.source_movie_id || card?.source_movie_title),
      };
    }),
  };
}

function indexedPool(pool) {
  return pool && Array.isArray(pool.entries) ? pool : createReviewDistractorIndex(pool);
}

function distractorScore(target, candidate, mode) {
  const expressionSimilarity = Math.max(
    diceSimilarity(target.expressionChars, candidate.expressionChars),
    diceSimilarity(target.expressionTokens, candidate.expressionTokens),
  );
  const meaningSimilarity = diceSimilarity(target.meaningChars, candidate.meaningChars);
  const samePos = target.pos && candidate.pos && target.pos === candidate.pos ? 1 : 0;
  const sameSource = target.source && candidate.source && target.source === candidate.source ? 1 : 0;
  const sameType = target.type && candidate.type && target.type === candidate.type ? 1 : 0;
  return mode === "r2"
    ? expressionSimilarity * 0.62 + samePos * 0.18 + meaningSimilarity * 0.12 + sameSource * 0.06 + sameType * 0.02
    : meaningSimilarity * 0.48 + expressionSimilarity * 0.25 + samePos * 0.17 + sameSource * 0.08 + sameType * 0.02;
}

function localLists(card, mode) {
  const expr = normalize(card?.expression_en || card?.text_en);
  const profile = profileOf(card);
  const known = COMMON_CONFUSABLES[expr] || {};
  const distractors = profile.distractors || {};
  if (mode === "r1" || mode === "r3") return [...(distractors.confusable_meanings || []), ...(known.meanings || [])];
  return [...(distractors.confusable_words || []), ...(distractors.soundalikes || []), ...(known.expressions || [])];
}

function poolCandidates(card, pool, mode) {
  const usesMeaning = mode === "r1" || mode === "r3";
  const target = createReviewDistractorIndex([card]).entries[0];
  const correct = normalize(usesMeaning ? card?.meaning_zh || card?.text_zh : card?.expression_en || card?.text_en);
  return indexedPool(pool).entries.map((entry) => {
    if (!entry?.card || entry.card.id === card?.id) return null;
    const expressionSimilarity = Math.max(
      diceSimilarity(target.expressionChars, entry.expressionChars),
      diceSimilarity(target.expressionTokens, entry.expressionTokens),
    );
    const meaningSimilarity = diceSimilarity(target.meaningChars, entry.meaningChars);
    const hasLexicalOverlap = mode === "r2"
      ? expressionSimilarity >= 0.15
      : expressionSimilarity >= 0.12 || meaningSimilarity >= 0.12;
    if (!hasLexicalOverlap) return null;
    const value = String(usesMeaning ? entry.card.meaning_zh || entry.card.text_zh || "" : entry.card.expression_en || entry.card.text_en || "").trim();
    const key = usesMeaning ? meaningKey(value) : normalize(value);
    if (!value || !key || key === (usesMeaning ? meaningKey(correct) : correct)) return null;
    if (usesMeaning && (!isChineseMeaning(value) || nearDuplicateMeaning(value, correct))) return null;
    return { value, score: distractorScore(target, entry, mode), tie: stableTieBreak(card?.id, entry.card.id) };
  }).filter(Boolean).sort((a, b) => b.score - a.score || a.tie - b.tie).map((item) => item.value);
}

export function buildLocalDistractors(card, pool, mode) {
  const usesMeaning = mode === "r1" || mode === "r3";
  const correct = normalize(usesMeaning ? card?.meaning_zh || card?.text_zh : card?.expression_en || card?.text_en);
  const seen = new Set(correct ? [mode === "r3" ? meaningKey(correct) : correct] : []);
  const result = [];
  for (const value of [...localLists(card, mode), ...poolCandidates(card, pool, mode)]) {
    const clean = String(value || "").trim();
    const key = mode === "r3" ? meaningKey(clean) : normalize(clean);
    if (!clean || (usesMeaning && !isChineseMeaning(clean)) || seen.has(key) || (usesMeaning && (nearDuplicateMeaning(clean, correct) || result.some((item) => nearDuplicateMeaning(clean, item))))) continue;
    seen.add(key);
    result.push(clean);
    if (result.length === 3) break;
  }
  return result;
}

export function fisherYatesShuffle(items, random = Math.random) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function buildReviewQuestion(card, pool, mode, distractors = buildLocalDistractors(card, pool, mode), random = Math.random) {
  const usesMeaning = mode === "r1" || mode === "r3";
  const correct = String(usesMeaning ? card?.meaning_zh || card?.text_zh : card?.expression_en || card?.text_en || "").trim();
  const correctAnswerId = normalize(correct);
  const seen = new Set([mode === "r3" ? meaningKey(correct) : correctAnswerId]);
  const options = correct ? [{ id: correctAnswerId, value: correct }] : [];
  for (const value of distractors || []) {
    const clean = String(value || "").trim();
    const id = normalize(clean);
    const key = mode === "r3" ? meaningKey(clean) : id;
    if (!clean || (mode === "r3" && !isChineseMeaning(clean)) || seen.has(key) || (mode === "r3" && (nearDuplicateMeaning(clean, correct) || options.slice(1).some((option) => nearDuplicateMeaning(clean, option.value))))) continue;
    seen.add(key);
    options.push({ id, value: clean });
    if (options.length === 4) break;
  }
  return {
    correctAnswer: correct,
    correctAnswerId,
    options: options.length === 4 ? fisherYatesShuffle(options, random) : options,
  };
}

// r3 is an audio-only prompt before answering; the spelling is revealed after a choice.
export function getReviewQuestionPresentation(card, mode, answered = false) {
  const expression = card?.expression_en || card?.text_en || "";
  if (mode === "r3") {
    return {
      promptText: answered ? expression : "",
      audioText: expression,
      instruction: "播放英文，再选择正确的中文释义",
      answerText: answered ? card?.meaning_zh || card?.text_zh || "" : "",
      phonetic: answered ? card?.profile?.phonetic_us || card?.phonetic_us || card?.profile?.phonetic_uk || card?.phonetic_uk || "" : "",
    };
  }
  return { promptText: mode === "r1" ? expression : card?.meaning_zh || card?.text_zh || "", audioText: "", instruction: "", answerText: "", phonetic: "" };
}

export function isCorrectReviewAnswer(question, option) {
  return Boolean(question?.correctAnswerId && option?.id === question.correctAnswerId);
}

export function buildReviewOptions(card, pool, mode, distractors = buildLocalDistractors(card, pool, mode)) {
  return buildReviewQuestion(card, pool, mode, distractors).options;
}

const reviewDistractorCache = new Map();
const REVIEW_MODES = ["r1", "r2", "r3"];

const distractorCacheKey = (card, mode) => `${card?.id ?? ""}:${mode}`;

export function clearReviewDistractorCache() {
  reviewDistractorCache.clear();
}

export function cachedReviewDistractors(card, mode) {
  return reviewDistractorCache.get(distractorCacheKey(card, mode)) || null;
}

export function rememberReviewDistractors(card, mode, values) {
  const list = (Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean).slice(0, 8);
  if (!card?.id || !list.length) return;
  reviewDistractorCache.set(distractorCacheKey(card, mode), list);
}

export function distractorValuesFromRemote(remote, mode) {
  if (Array.isArray(remote)) return remote;
  const data = remote?.distractors || remote || {};
  const list = mode === "r2" ? data.expression_options : mode === "r3" ? data.listening_options : data.meaning_options;
  return Array.isArray(list) ? list : [];
}

function takeDistractors(values, card, mode, limit = 3) {
  const usesMeaning = mode === "r1" || mode === "r3";
  const correct = normalize(usesMeaning ? card?.meaning_zh || card?.text_zh : card?.expression_en || card?.text_en);
  const seen = new Set(correct ? [mode === "r3" ? meaningKey(correct) : correct] : []);
  const result = [];
  for (const value of values) {
    const clean = String(value || "").trim();
    const key = mode === "r3" ? meaningKey(clean) : normalize(clean);
    if (!clean || (mode === "r3" && !isChineseMeaning(clean)) || seen.has(key) || (mode === "r3" && (nearDuplicateMeaning(clean, correct) || result.some((item) => nearDuplicateMeaning(clean, item))))) continue;
    seen.add(key);
    result.push(clean);
    if (result.length === limit) break;
  }
  return result;
}

// Prefer similar entries from the user's own vocabulary. AI results only fill
// gaps when the local collection cannot supply three distinct choices.
export function distractorsForReview(card, pool, mode) {
  const cached = cachedReviewDistractors(card, mode) || [];
  return takeDistractors([
    ...buildLocalDistractors(card, pool, mode),
    ...cached,
  ], card, mode, 3);
}

const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));

export async function prepareReviewDistractors(cards, pool, loader, { signal, onPrepared, chunkSize = 12, concurrency = 2 } = {}) {
  const uniqueCards = [...new Map((cards || []).filter((card) => card?.id).map((card) => [card.id, card])).values()];
  const needsRemote = [];
  const index = indexedPool(pool);
  for (let offset = 0; offset < uniqueCards.length; offset += chunkSize) {
    if (signal?.aborted) return;
    const chunk = uniqueCards.slice(offset, offset + chunkSize);
    for (const card of chunk) {
      let missingOptions = false;
      for (const mode of REVIEW_MODES) {
        const local = buildLocalDistractors(card, index, mode);
        const cached = cachedReviewDistractors(card, mode) || [];
        if (takeDistractors([...local, ...cached], card, mode).length < 3) missingOptions = true;
        if (local.length && cached.length < 3) rememberReviewDistractors(card, mode, local);
      }
      if (missingOptions) needsRemote.push(card);
    }
    onPrepared?.(chunk.map((card) => card.id));
    if (offset + chunkSize < uniqueCards.length) await yieldToBrowser();
  }

  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), needsRemote.length) }, async () => {
    while (!signal?.aborted) {
      const card = needsRemote[next];
      next += 1;
      if (!card) return;
      try {
        const remote = await loader?.(card, { signal });
        for (const mode of REVIEW_MODES) {
          const values = distractorValuesFromRemote(remote, mode);
          if (values.length) rememberReviewDistractors(card, mode, values);
        }
        onPrepared?.([card.id]);
      } catch {
        // The current card already has its best local choices; failed supplements must not block review.
      }
    }
  });
  await Promise.all(workers);
}
