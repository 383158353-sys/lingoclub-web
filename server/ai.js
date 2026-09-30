export function endpoint(baseUrl) {
  const clean = String(baseUrl || "").replace(/\/+$/, "");
  return clean.endsWith("/chat/completions") ? clean : `${clean}/chat/completions`;
}

function geminiEndpoint(baseUrl, model) {
  const clean = String(baseUrl || "").replace(/\/+$/, "");
  return `${clean}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

export function parseJsonContent(content) {
  if (content && typeof content === "object") return content;
  const text = String(content || "").trim();
  try { return JSON.parse(text); } catch (directError) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch { /* throw the original parse error below */ }
    }
    throw directError;
  }
}

const BASIC_WORDS = new Set(["a", "an", "the", "i", "you", "he", "she", "it", "we", "they", "to", "of", "in", "on", "and", "or", "but", "is", "are", "was", "were", "be", "been", "do", "does", "did", "know"]);
const ENGLISH_EXPRESSION = /^[A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*){0,4}$/;

function cleanField(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function validExpression(value) {
  const clean = cleanField(value);
  if (!clean || clean.length > 80 || !ENGLISH_EXPRESSION.test(clean)) return "";
  if (BASIC_WORDS.has(clean.toLowerCase())) return "";
  return clean;
}

function normalizeWordItem(item) {
  if (!item || typeof item !== "object") return null;
  const word = [item.word, item.headword, item.term, item.expression, item.phrase]
    .map(validExpression)
    .find(Boolean);
  if (!word) return null;
  const partOfSpeech = cleanField(item.partOfSpeech || item.pos);
  return {
    word,
    meaning: cleanField(item.meaning || item.definition),
    contextMeaning: cleanField(item.contextMeaning || item.context),
    phonetic: cleanField(item.phonetic || item.phonetic_us),
    partOfSpeech,
    pos: partOfSpeech,
  };
}

function normalizePhraseItem(item) {
  if (!item || typeof item !== "object") return null;
  const phrase = validExpression(item.phrase || item.expression);
  if (!phrase) return null;
  return {
    phrase,
    meaning: cleanField(item.meaning),
    usage: cleanField(item.usage),
  };
}

export function normalizeAnalysisResult(result) {
  if (!result || typeof result !== "object") return result;
  const words = Array.isArray(result.words)
    ? result.words.map(normalizeWordItem).filter(Boolean).filter((item, index, list) => list.findIndex((candidate) => candidate.word.toLowerCase() === item.word.toLowerCase()) === index).slice(0, 3)
    : [];
  const phrases = Array.isArray(result.phrases)
    ? result.phrases.map(normalizePhraseItem).filter(Boolean).slice(0, 2)
    : [];
  return {
    ...result,
    translation: cleanField(result.translation),
    words,
    phrases,
    grammar: cleanField(result.grammar),
    cultural: cleanField(result.cultural),
    pronunciation: cleanField(result.pronunciation),
  };
}

const FAST_TASKS = new Set(["word_lookup", "translate_sentence", "generate_distractors"]);
const IN_FLIGHT = new Map();
const AI_TIMEOUT_MS = 25_000;

function schemaForTask(task) {
  const stringSchema = { type: "STRING" };
  const arrayOfStrings = { type: "ARRAY", items: stringSchema };
  if (task === "generate_distractors") {
    return {
      type: "OBJECT",
      properties: {
        meaning_options: arrayOfStrings,
        expression_options: arrayOfStrings,
        listening_options: arrayOfStrings,
      },
      required: ["meaning_options", "expression_options", "listening_options"],
    };
  }
  if (task === "subtitle_batch") {
    const learningItem = {
      type: "OBJECT",
      properties: {
        expression: stringSchema,
        type: stringSchema,
        basicMeaning: stringSchema,
        contextMeaning: stringSchema,
        partOfSpeech: stringSchema,
        cueId: stringSchema,
      },
      required: ["expression", "type", "basicMeaning", "contextMeaning", "partOfSpeech", "cueId"],
    };
    return {
      type: "OBJECT",
      properties: {
        episodeContext: stringSchema,
        cues: { type: "ARRAY", items: { type: "OBJECT", properties: { cueId: stringSchema, translation: stringSchema, difficultWords: { type: "ARRAY", items: learningItem }, phrases: { type: "ARRAY", items: learningItem } }, required: ["cueId", "translation", "difficultWords", "phrases"] } },
      },
      required: ["episodeContext", "cues"],
    };
  }
  if (task === "word_lookup" || task === "vocab-profile" || task === "vocabulary_analysis") {
    return {
      type: "OBJECT",
      properties: {
        meaning: stringSchema,
        pos: stringSchema,
        phonetic_us: stringSchema,
        phonetic_uk: stringSchema,
        roots: { type: "ARRAY", items: { type: "OBJECT", properties: { part: stringSchema, meaning: stringSchema, type: stringSchema } } },
        synthesis: stringSchema,
        example_en: stringSchema,
        example_zh: stringSchema,
        synonyms: { type: "ARRAY", items: { type: "OBJECT", properties: { expression: stringSchema, meaning: stringSchema } } },
        same_root: { type: "ARRAY", items: { type: "OBJECT", properties: { word: stringSchema, meaning: stringSchema } } },
        distractors: { type: "OBJECT", properties: { confusable_meanings: arrayOfStrings, confusable_words: arrayOfStrings, soundalikes: arrayOfStrings } },
      },
      required: ["meaning", "pos", "phonetic_us"],
    };
  }
  return {
    type: "OBJECT",
    properties: {
      translation: stringSchema,
      words: { type: "ARRAY", items: { type: "OBJECT", properties: { word: stringSchema, meaning: stringSchema, contextMeaning: stringSchema, phonetic: stringSchema, partOfSpeech: stringSchema, pos: stringSchema }, required: ["word", "meaning", "contextMeaning", "phonetic", "partOfSpeech"] } },
      phrases: { type: "ARRAY", items: { type: "OBJECT", properties: { phrase: stringSchema, meaning: stringSchema, usage: stringSchema }, required: ["phrase", "meaning"] } },
      pronunciation: stringSchema,
      grammar: stringSchema,
      cultural: stringSchema,
      expressions: { type: "ARRAY", items: { type: "OBJECT", properties: { expression: stringSchema, meaning: stringSchema } } },
    },
    required: ["translation", "words", "phrases", "grammar", "cultural"],
  };
}

function retryable(error) {
  return error?.name === "AbortError" || error?.name === "TimeoutError"
    || error?.status === 429 || (error?.status >= 500 && error?.status <= 599)
    || error instanceof TypeError;
}

async function requestJson(url, options) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const raw = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(raw?.error?.message || raw?.error || `AI API 请求失败 (${response.status})`);
        error.status = response.status;
        throw error;
      }
      return raw;
    } catch (error) {
      lastError = error?.name === "AbortError" ? Object.assign(new Error("AI 请求超时，请稍后重试"), { name: "TimeoutError" }) : error;
      if (attempt >= 2 || !retryable(lastError)) throw lastError;
      await new Promise((resolve) => setTimeout(resolve, 250));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function promptFor(body) {
  if (body.task === "subtitle_batch") {
    const cues = Array.isArray(body.cues) ? body.cues.slice(0, 40) : [];
    if (!cues.length) throw new Error("cues are required");
    const input = cues.map((cue) => `${cue.target ? "TARGET" : "CONTEXT"} [${cue.cueId}] ${cue.start || ""} ${cue.text || ""}`).join("\n");
    const known = (Array.isArray(body.known_expressions) ? body.known_expressions : []).slice(0, 100).map((item) => `${item.expression} (${item.contextMeaning || item.basicMeaning})`).join("; ");
    return `You are preparing contextual subtitle study data for a Chinese learner. Translate every TARGET cue naturally and concisely into Chinese. Keep cueId exactly unchanged and do not alter subtitle text or timing. Use adjacent CONTEXT cues and the rolling episode context to resolve names, references, tone, ellipsis, and scene meaning.\nCurrent episode context: ${body.episode_context || "Not established yet; infer only a very brief context from the cues."}\nExpressions already identified elsewhere in this episode: ${known || "none"}. Do not repeat one when the contextual meaning is the same; include it again only if this cue gives it a clearly different contextual sense.\nCues:\n${input}\nFor each TARGET cue, include up to 2 genuinely useful difficultWords and up to 2 phrases. Prefer fixed expressions, phrasal verbs, idioms, slang, spoken expressions, plot-important words, or ordinary words with a special meaning here. Do not include basic words such as the, I, you, good, have, can unless their contextual sense is notably special. Prefer a phrase over its component words. Each item must contain expression, type (word, phrasal-verb, idiom, slang, phrase, or spoken-expression), basicMeaning, contextMeaning, partOfSpeech, cueId. Do not repeat the same expression with the same contextual meaning. Also return a rolling episodeContext summary of at most 50 Chinese characters, updated with relevant scene continuity. Return strict JSON: {episodeContext, cues:[{cueId,translation,difficultWords,phrases}]}. Include only TARGET cues in cues; no explanations outside JSON.`;
  }
  if (["translate_sentence", "analyze-subtitle"].includes(body.task)) {
    const text = String(body.text_en || body.text || "").trim();
    if (!text) throw new Error("text_en is required");
    if (text.length > 600) throw new Error("text too long");
    const prior = Array.isArray(body.previous_cues) ? body.previous_cues.slice(-5).map((cue) => cue.text || "").join("\n") : "";
    const next = Array.isArray(body.next_cues) ? body.next_cues.slice(0, 5).map((cue) => cue.text || "").join("\n") : "";
    const known = Array.isArray(body.known_expressions) ? body.known_expressions.slice(0, 12).map((item) => `${item.expression}: ${item.contextMeaning || item.basicMeaning}`).join("; ") : "";
    return `Translate and analyze this English subtitle for a Chinese learner.\nEpisode context: ${body.episode_context || ""}\nPrevious cues: ${prior}\nTarget subtitle: "${text}"\nNext cues: ${next}\nAlready identified expressions: ${known}\nSpeaker: ${body.speaker || "unknown"}\nReturn strict JSON only with: translation (natural Chinese), words (up to 3 worthwhile words or fixed expressions, each with word, meaning, contextMeaning, phonetic, partOfSpeech), phrases (up to 2 objects with phrase, meaning), grammar (one short Chinese sentence), cultural (one short Chinese sentence). Do not include basic words such as I, you, the, or know. Prefer reusing identified expressions. word must be only the English word or fixed expression, never a sentence or explanation. Keep all Chinese concise; describe grammar/cultural detail only when necessary.`;
  }
  if (["word_lookup", "vocabulary_analysis", "vocab-profile"].includes(body.task)) {
    const expression = String(body.expression_en || body.text || "").trim();
    if (!expression) throw new Error("expression_en is required");
    if (expression.length > 300) throw new Error("expression too long");
    if (body.task === "word_lookup" || body.quick === true) {
      return `You are a dictionary for Chinese learners of English. Look up "${expression}" for the precise sense in the current scene. Film/show context: ${body.context || "film and TV"}. Current and neighboring subtitle context: ${body.subtitle_text || "not provided"}. Return strict JSON only with meaning (concise Chinese), pos (part of speech in Chinese), and phonetic_us (US IPA). Prefer the contextual sense when it differs from the default dictionary sense.`;
    }
    return `Build a concise word profile for Chinese learners for "${expression}". Context: ${body.context || "film and TV"}. Return strict JSON only with meaning, pos, phonetic_us, phonetic_uk, roots (array of {part,meaning,type}), synthesis, example_en, example_zh, synonyms (array of {expression,meaning}), same_root (array of {word,meaning}), and distractors containing confusable_meanings, confusable_words, soundalikes arrays.`;
  }
  if (body.task === "generate_distractors") {
    const expression = String(body.expression_en || body.text || "").trim();
    const meaning = String(body.meaning_zh || body.meaning || "").trim();
    if (!expression || !meaning) throw new Error("expression_en and meaning_zh are required");
    return `Create plausible multiple-choice distractors for a Chinese learner reviewing the English expression "${expression}" meaning "${meaning}". Return strict JSON only with meaning_options (3 incorrect Chinese meanings), expression_options (3 incorrect English expressions), and listening_options (3 confusable English expressions). Never include the correct answer.`;
  }
  throw new Error("unsupported AI task");
}

export async function handleAI(req, res, body, env) {
  if (!env.AI_BASE_URL || !env.AI_API_KEY || !env.AI_MODEL) {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: "请先配置 AI_BASE_URL、AI_API_KEY、AI_MODEL" }));
    return;
  }
  const prompt = promptFor(body);
  const isGemini = String(env.AI_PROVIDER || "").trim().toLowerCase() === "gemini";
  const model = FAST_TASKS.has(body.task) ? (env.AI_FAST_MODEL || env.AI_MODEL) : env.AI_MODEL;
  const requestUrl = isGemini ? geminiEndpoint(env.AI_BASE_URL, model) : endpoint(env.AI_BASE_URL);
  const requestOptions = isGemini
    ? {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.AI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
            responseSchema: schemaForTask(body.task),
            thinkingConfig: { thinkingLevel: "low" },
          },
        }),
      }
    : {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.AI_API_KEY}` },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
          response_format: { type: "json_object" },
        }),
      };
  const run = () => requestJson(requestUrl, requestOptions);
  const dedupeKey = body.task === "translate_sentence" && (body.video_id || body.subtitle_text || body.text_en)
    ? `${body.task}|${body.video_id || "local"}|${body.cache_key || body.subtitle_text || body.text_en}`
    : body.task === "subtitle_batch" ? `${body.task}|${body.video_id || "local"}|${body.subtitle_hash || ""}|${body.block_id || ""}` : null;
  let raw;
  if (dedupeKey && IN_FLIGHT.has(dedupeKey)) raw = await IN_FLIGHT.get(dedupeKey);
  else {
    const pending = run();
    if (dedupeKey) IN_FLIGHT.set(dedupeKey, pending);
    try { raw = await pending; } finally { if (dedupeKey) IN_FLIGHT.delete(dedupeKey); }
  }
  const content = isGemini
    ? raw?.candidates?.[0]?.content?.parts?.map((part) => part?.text || "").join("")
    : raw?.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI API 未返回可解析的内容");
  const parsed = parseJsonContent(content);
  const result = ["translate_sentence", "analyze-subtitle"].includes(body.task)
    ? normalizeAnalysisResult(parsed)
    : parsed;
  res.statusCode = 200;
  const key = body.task === "subtitle_batch" ? "batch" : ["translate_sentence", "analyze-subtitle"].includes(body.task)
    ? "analysis"
    : body.task === "generate_distractors" ? "distractors" : "profile";
  res.end(JSON.stringify({ [key]: result }));
}
