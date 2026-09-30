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

function localLists(card, mode) {
  const expr = normalize(card?.expression_en || card?.text_en);
  const profile = profileOf(card);
  const known = COMMON_CONFUSABLES[expr] || {};
  const distractors = profile.distractors || {};
  if (mode === "r1" || mode === "r3") return [...(distractors.confusable_meanings || []), ...(known.meanings || [])];
  return [...(distractors.confusable_words || []), ...(distractors.soundalikes || []), ...(known.expressions || [])];
}

function poolCandidates(card, pool, mode) {
  const expr = normalize(card?.expression_en || card?.text_en);
  const profile = profileOf(card);
  const pos = normalize(profile.pos || card?.pos);
  return (pool || []).map((candidate) => {
    if (!candidate || candidate.id === card?.id) return null;
    const candidateExpr = normalize(candidate.expression_en || candidate.text_en);
    const candidateMeaning = normalize(candidate.meaning_zh || candidate.text_zh);
    const candidatePos = normalize(candidate.profile?.pos || candidate.pos);
    const usesMeaning = mode === "r1" || mode === "r3";
    const value = usesMeaning ? candidateMeaning : candidate.expression_en || candidate.text_en;
    if (!value || normalize(value) === normalize(usesMeaning ? card?.meaning_zh || card?.text_zh : expr)) return null;
    let score = 0;
    if (pos && candidatePos === pos) score += 5;
    if (candidateExpr[0] && expr[0] && candidateExpr[0] === expr[0]) score += 2;
    if (editDistance(candidateExpr, expr) <= Math.max(2, Math.floor(expr.length / 3))) score += 4;
    if (score <= 0 || (mode === "r3" && score < 7)) return null;
    return { value: String(value).trim(), score };
  }).filter(Boolean).sort((a, b) => b.score - a.score).map((item) => item.value);
}

export function buildLocalDistractors(card, pool, mode) {
  const usesMeaning = mode === "r1" || mode === "r3";
  const correct = normalize(usesMeaning ? card?.meaning_zh || card?.text_zh : card?.expression_en || card?.text_en);
  const seen = new Set(correct ? [mode === "r3" ? meaningKey(correct) : correct] : []);
  const result = [];
  for (const value of [...localLists(card, mode), ...poolCandidates(card, pool, mode)]) {
    const clean = String(value || "").trim();
    const key = mode === "r3" ? meaningKey(clean) : normalize(clean);
    if (!clean || (mode === "r3" && !isChineseMeaning(clean)) || seen.has(key) || (mode === "r3" && (nearDuplicateMeaning(clean, correct) || result.some((item) => nearDuplicateMeaning(clean, item))))) continue;
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
