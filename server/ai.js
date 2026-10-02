import { getUserCredential } from "./aiCredentials.js";
import { normalizeOpenAICompatibleEndpoint, openAICompatibleRequest, readOpenAICompatibleResponse } from "./aiProviders/openaiCompatible.js";
import { geminiEndpoint, geminiModelsEndpoint, geminiRequest, readGeminiResponse } from "./aiProviders/gemini.js";
import { openAIResponsesEndpoint, openAIResponsesRequest, readOpenAIResponsesResponse } from "./aiProviders/openaiResponses.js";

export function endpoint(baseUrl) {
  return normalizeOpenAICompatibleEndpoint(baseUrl);
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

const FAST_TASKS = new Set(["word_lookup", "subtitle_translate_batch", "subtitle_learning_batch", "generate_distractors", "vocabulary_analysis", "vocab-profile"]);
// Interactive relay study actions use the tested main model, like the
// connection test. Keep background batch jobs on Fast Model.
const LEGACY_RELAY_GEMINI_FAST_TASKS = new Set(["generate_distractors", "subtitle_translate_batch", "subtitle_learning_batch"]);
const IN_FLIGHT = new Map();
const AI_TIMEOUT_MS = 25_000;

function isGeminiTextOutputModel(model) {
  return !/(?:^|[-_.])tts(?:$|[-_.])/i.test(String(model || ""));
}

export function isGeminiTextModelInfo(item) {
  const name = `${item?.name || ""} ${item?.displayName || ""} ${item?.description || ""}`;
  if (/\btts\b|text[- ]to[- ]speech|speech generation|audio generation/i.test(name)) return false;
  const outputs = item?.supportedOutputModalities || item?.outputModalities || item?.responseModalities;
  if (Array.isArray(outputs) && outputs.length > 0 && !outputs.some((mode) => String(mode).toUpperCase() === "TEXT")) return false;
  if (item?.outputModalities && typeof item.outputModalities === "string" && /AUDIO/i.test(item.outputModalities) && !/TEXT/i.test(item.outputModalities)) return false;
  return true;
}

function schemaForTask(task, expressionType = "word") {
  const stringSchema = { type: "STRING" };
  const arrayOfStrings = { type: "ARRAY", items: stringSchema };
  if (task === "ai_connection_test") {
    return { type: "OBJECT", properties: { ok: { type: "BOOLEAN" }, message: stringSchema }, required: ["ok", "message"] };
  }
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
  if (task === "subtitle_translate_batch") {
    return {
      type: "OBJECT",
      properties: {
        cues: { type: "ARRAY", items: { type: "OBJECT", properties: { cueId: stringSchema, translation: stringSchema }, required: ["cueId", "translation"] } },
      },
      required: ["cues"],
    };
  }
  if (task === "subtitle_learning_batch") {
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
        cues: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              cueId: stringSchema,
              difficultWords: { type: "ARRAY", items: learningItem },
              phrases: { type: "ARRAY", items: learningItem },
            },
            required: ["cueId", "difficultWords", "phrases"],
          },
        },
      },
      required: ["cues"],
    };
  }
  if (task === "word_lookup" || task === "vocab-profile" || task === "vocabulary_analysis") {
    if (task === "word_lookup") {
      return {
        type: "OBJECT",
        properties: { meaning: stringSchema, pos: stringSchema, phonetic_us: stringSchema, phonetic_uk: stringSchema },
        required: ["meaning", "pos", "phonetic_us"],
      };
    }
    const senseSchema = {
      type: "OBJECT",
      properties: { pos: stringSchema, meanings: arrayOfStrings },
      required: ["pos", "meanings"],
    };
    if (expressionType === "phrase" || expressionType === "sentence") {
      return {
        type: "OBJECT",
        properties: { expression_type: stringSchema, senses: { type: "ARRAY", items: senseSchema } },
        required: ["expression_type", "senses"],
      };
    }
    return {
      type: "OBJECT",
      properties: {
        expression_type: stringSchema,
        phonetic_us: stringSchema,
        phonetic_uk: stringSchema,
        roots: { type: "ARRAY", items: { type: "OBJECT", properties: { part: stringSchema, type: stringSchema, meaning: stringSchema }, required: ["part", "type", "meaning"] } },
        synthesis: stringSchema,
        senses: { type: "ARRAY", items: senseSchema },
      },
      required: ["expression_type", "phonetic_us", "phonetic_uk", "senses", "roots", "synthesis"],
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

async function requestJson(url, options, secret = "", { retry = true, timeoutMs = AI_TIMEOUT_MS } = {}) {
  let lastError;
  const startedAt = Date.now();
  const maxAttempts = retry ? 2 : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let responseStatus = 0;
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      responseStatus = response.status;
      let raw = {};
      let responseParseFailed = false;
      try { raw = await response.json(); } catch { responseParseFailed = true; }
      if (!response.ok) {
        const upstreamMessage = typeof raw?.error === "string" ? raw.error : raw?.error?.message || raw?.message || "";
        const error = new Error("AI upstream request failed");
        error.status = response.status;
        error.upstreamStatus = response.status;
        error.providerCode = raw?.error?.code || raw?.code || raw?.error?.type || "";
        error.providerMessage = String(upstreamMessage).slice(0, 500).split(secret).join("[redacted]").replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]");
        throw error;
      }
      if (responseParseFailed) {
        const error = new Error("AI upstream returned a non-JSON success response");
        Object.assign(error, { code: "UPSTREAM_OK_PARSE_FAILED", status: 502, upstreamStatus: response.status });
        throw error;
      }
      return raw;
    } catch (error) {
      lastError = error?.name === "AbortError" ? Object.assign(new Error("AI 请求超时，请稍后重试"), { name: "TimeoutError" }) : error;
      Object.assign(lastError, {
        durationMs: Date.now() - startedAt,
        ...(responseStatus || lastError?.upstreamStatus ? { upstreamStatus: responseStatus || lastError.upstreamStatus } : {}),
        timeout: lastError?.name === "TimeoutError" || lastError?.name === "AbortError",
        aborted: error?.name === "AbortError" || controller.signal.aborted,
      });
      if (!lastError.providerMessage && !responseStatus) lastError.providerMessage = String(lastError.message || "Network request failed").slice(0, 300).split(secret).join("[redacted]").replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]");
      if (lastError.code === "UPSTREAM_OK_PARSE_FAILED" && !lastError.providerMessage) lastError.providerMessage = "Upstream returned non-JSON content with a success status";
      if (attempt >= maxAttempts || !retryable(lastError)) throw lastError;
      await new Promise((resolve) => setTimeout(resolve, 250));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function fetchGeminiModels(baseUrl, apiKey) {
  const url = geminiModelsEndpoint(baseUrl);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { method: "GET", headers: { "x-goog-api-key": apiKey }, signal: controller.signal });
    const raw = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error("Gemini API Key 无效或无法访问模型列表");
      error.code = "GEMINI_MODELS_UNAVAILABLE";
      error.status = 502;
      error.upstreamStatus = response.status;
      error.stage = "models";
      error.officialGemini = true;
      error.providerType = "official";
      error.provider = "gemini";
      error.model = "";
      error.providerCode = raw?.error?.status || raw?.error?.code || "";
      error.providerMessage = String(raw?.error?.message || "").slice(0, 500).split(apiKey).join("[redacted]");
      error.endpoint = url;
      error.durationMs = Date.now() - startedAt;
      throw error;
    }
    const models = (Array.isArray(raw?.models) ? raw.models : [])
      .filter((item) => Array.isArray(item.supportedGenerationMethods) && item.supportedGenerationMethods.includes("generateContent"))
      .filter(isGeminiTextModelInfo)
      .map((item) => ({
        id: String(item.name || "").replace(/^models\//, ""),
        name: String(item.name || "").replace(/^models\//, ""),
        displayName: String(item.displayName || ""),
        supportedGenerationMethods: item.supportedGenerationMethods,
      }))
      .filter((item) => item.id);
    return { status: response.status, models, modelIds: models.map((item) => item.id) };
  } catch (error) {
    if (error?.code === "GEMINI_MODELS_UNAVAILABLE") throw error;
    const failure = new Error(error?.name === "AbortError" ? "Gemini 模型列表请求超时" : "Gemini API Key 无效或无法访问模型列表");
    failure.code = error?.name === "AbortError" ? "GEMINI_MODELS_TIMEOUT" : "GEMINI_MODELS_UNAVAILABLE";
    failure.status = error?.status || 502;
    failure.upstreamStatus = error?.upstreamStatus;
    failure.endpoint = url;
    failure.stage = "models";
    failure.officialGemini = true;
    failure.providerType = "official";
    failure.provider = "gemini";
    failure.model = "";
    failure.durationMs = Number(error?.durationMs) || Date.now() - startedAt;
    failure.timeout = error?.name === "AbortError" || error?.name === "TimeoutError";
    failure.aborted = error?.name === "AbortError";
    throw failure;
  } finally { clearTimeout(timer); }
}

function promptFor(body) {
  if (body.task === "ai_connection_test") return "Reply only with OK";
  if (body.task === "subtitle_batch") {
    const cues = Array.isArray(body.cues) ? body.cues.slice(0, 40) : [];
    if (!cues.length) throw new Error("cues are required");
    const input = cues.map((cue) => `${cue.target ? "TARGET" : "CONTEXT"} [${cue.cueId}] ${cue.start || ""} ${cue.text || ""}`).join("\n");
    const known = (Array.isArray(body.known_expressions) ? body.known_expressions : []).slice(0, 100).map((item) => `${item.expression} (${item.contextMeaning || item.basicMeaning})`).join("; ");
    return `You are preparing contextual subtitle study data for a Chinese learner. Translate every TARGET cue naturally and concisely into Chinese. Keep cueId exactly unchanged and do not alter subtitle text or timing. Use adjacent CONTEXT cues and the rolling episode context to resolve names, references, tone, ellipsis, and scene meaning.\nCurrent episode context: ${body.episode_context || "Not established yet; infer only a very brief context from the cues."}\nExpressions already identified elsewhere in this episode: ${known || "none"}. Do not repeat one when the contextual meaning is the same; include it again only if this cue gives it a clearly different contextual sense.\nCues:\n${input}\nFor each TARGET cue, include up to 2 genuinely useful difficultWords and up to 2 phrases. Prefer fixed expressions, phrasal verbs, idioms, slang, spoken expressions, plot-important words, or ordinary words with a special meaning here. Do not include basic words such as the, I, you, good, have, can unless their contextual sense is notably special. Prefer a phrase over its component words. Each item must contain expression, type (word, phrasal-verb, idiom, slang, phrase, or spoken-expression), basicMeaning, contextMeaning, partOfSpeech, cueId. Do not repeat the same expression with the same contextual meaning. Also return a rolling episodeContext summary of at most 50 Chinese characters, updated with relevant scene continuity. Return strict JSON: {episodeContext, cues:[{cueId,translation,difficultWords,phrases}]}. Include only TARGET cues in cues; no explanations outside JSON.`;
  }
  if (body.task === "subtitle_translate_batch") {
    const cues = Array.isArray(body.cues) ? body.cues.slice(0, 128) : [];
    const targets = cues.filter((cue) => cue.target !== false);
    if (!targets.length) throw new Error("cues are required");
    const input = cues.map((cue) => `${cue.target === false ? "CONTEXT" : "TARGET"} [${cue.cueId}] ${cue.text || ""}`).join("\n");
    return `Translate every TARGET subtitle line into concise, natural Simplified Chinese. Use CONTEXT lines only to understand references, tone, and continuity. Preserve cueId exactly. Do not translate CONTEXT lines. Do not analyze vocabulary, phrases, grammar, culture, or episode context. Return exactly one translation for every TARGET cue and no others. Return strict JSON only: {cues:[{cueId,translation}]}\nSubtitles:\n${input}`;
  }
  if (body.task === "subtitle_learning_batch") {
    const cues = Array.isArray(body.cues) ? body.cues.slice(0, 32) : [];
    const targets = cues.filter((cue) => cue.target !== false);
    if (!targets.length) throw new Error("cues are required");
    const input = cues.map((cue) => `${cue.target === false ? "CONTEXT" : "TARGET"} [${cue.cueId}] ${cue.text || ""}`).join("\n");
    return `For each TARGET subtitle, extract only a few genuinely useful English learning items for a Chinese learner. Prefer difficult words, context-specific meanings, phrasal verbs, idioms, slang, and fixed spoken phrases. Skip basic words. Return at most 2 difficultWords and 2 phrases per cue; empty arrays are correct when nothing is useful. Each item: expression,type,basicMeaning,contextMeaning,partOfSpeech,cueId. Use CONTEXT lines only to understand the scene. Do not translate full subtitles. Do not produce vocabulary profiles, roots, grammar, cultural notes, examples, or episode summaries. Return strict JSON only: {cues:[{cueId,difficultWords,phrases}]}.\n${input}`;
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
    const expressionType = ["word", "phrase", "sentence"].includes(body.expression_type) ? body.expression_type : (/\s/.test(expression) ? "phrase" : "word");
    const sourceContext = String(body.source_sentence_en || body.subtitle_text || "").slice(0, 350);
    const sourceTranslation = String(body.source_sentence_zh || "").slice(0, 180);
    const shared = `为中国英语学习者简明分析“${expression}”。影视语境：${sourceContext || "无"}${sourceTranslation ? ` / ${sourceTranslation}` : ""}。中文释义按词性简短分组。`;
    if (expressionType === "word") return `${shared} 只返回 JSON 字段：expression_type="word", phonetic_us, phonetic_uk, senses[{pos,meanings}], roots[{part,type,meaning}], synthesis。只在词源构词可靠且有记忆价值时返回 roots，否则 roots=[]、synthesis=""。不要返回其他字段。`;
    if (expressionType === "phrase") return `${shared} 只返回 JSON：{expression_type:"phrase",senses:[{pos,meanings}]}。词性用 phr.、phrasal v.、idiom 或 expr.。不生成音标、词根或其他字段。`;
    return `${shared} 只返回 JSON：{expression_type:"sentence",senses:[{pos:"sent.",meanings}]}。不生成音标、词根或其他字段。`;
  }
  if (body.task === "generate_distractors") {
    const expression = String(body.expression_en || body.text || "").trim();
    const meaning = String(body.meaning_zh || body.meaning || "").trim();
    if (!expression || !meaning) throw new Error("expression_en and meaning_zh are required");
    return `Create plausible multiple-choice distractors for a Chinese learner reviewing the English expression "${expression}" meaning "${meaning}". Return strict JSON only with meaning_options (3 incorrect Chinese meanings), expression_options (3 incorrect English expressions), and listening_options (3 confusable English expressions). Never include the correct answer.`;
  }
  throw new Error("unsupported AI task");
}

export function resolveProviderRoute(credential) {
  const providerType = String(credential?.provider_type || credential?.type || "").toLowerCase();
  const provider = String(credential?.provider || "").toLowerCase();
  if (providerType === "relay" && ["gemini", "openai-compatible"].includes(provider)) return { providerType, provider, baseUrl: credential.base_url || "" };
  if (providerType === "official" && provider === "gemini") return { providerType, provider, baseUrl: "https://generativelanguage.googleapis.com" };
  if (providerType === "official" && provider === "openai") return { providerType, provider, baseUrl: "https://api.openai.com/v1" };
  const error = new Error("AI credential provider configuration is invalid");
  error.code = "AI_CREDENTIAL_INVALID";
  error.status = 400;
  throw error;
}

function providerDiagnostic({ providerType, provider, endpoint: requestEndpoint, model, httpStatus, raw, upstreamCode, upstreamStatus, upstreamMessage, responseShape, apiKey = "" }) {
  const safeMessage = String(upstreamMessage || "").slice(0, 500).split(apiKey).join("[redacted]").replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]").replace(/\b(?:sk|rk|AIza)[-_][A-Za-z0-9._-]{12,}\b/g, "[redacted]");
  return {
    providerType,
    provider,
    endpoint: requestEndpoint,
    model,
    httpStatus,
    ...(upstreamCode ? { upstreamCode } : {}),
    ...(upstreamStatus ? { upstreamStatus } : {}),
    ...(safeMessage ? { upstreamMessage: safeMessage } : {}),
    responseShape: responseShape || (raw ? (raw.output_text || raw.output ? "responses.output/output_text" : raw.candidates ? "gemini.candidates" : raw.choices ? "chat_completions.choices" : Object.keys(raw).slice(0, 12).join(",")) : "none"),
  };
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

export async function handleAI(req, res, body, env) {
  if (!body.credential_id) return sendJson(res, 503, { error: "AI_NOT_CONFIGURED", code: "AI_NOT_CONFIGURED" });
  const { credential } = await getUserCredential(req, env, String(body.credential_id));
  const route = resolveProviderRoute(credential);
  const providerType = route.providerType;
  const provider = route.provider;
  const apiKey = credential.api_key;
  const isOfficialGemini = providerType === "official" && provider === "gemini";
  const isGeminiNative = provider === "gemini";
  const isRelayGemini = providerType === "relay" && isGeminiNative;
  const isOfficialOpenAI = providerType === "official" && provider === "openai";
  const isConnectionTest = body.task === "ai_connection_test";
  const isGeminiVocabularyTask = isOfficialGemini && ["vocabulary_analysis", "vocab-profile"].includes(body.task);
  const useFastModel = isRelayGemini ? LEGACY_RELAY_GEMINI_FAST_TASKS.has(body.task) : FAST_TASKS.has(body.task);
  const model = isConnectionTest ? String(credential.model || "").trim() : isGeminiVocabularyTask ? String(credential.model || "").trim() : (useFastModel ? String(credential.fast_model || credential.model || "").trim() : String(credential.model || "").trim());

  if (body.task === "gemini_list_models") {
    if (!isOfficialGemini) return sendJson(res, 400, { error: "Gemini 官方模型列表仅支持官方 Gemini credential", code: "GEMINI_OFFICIAL_ONLY" });
    const result = await fetchGeminiModels(route.baseUrl, apiKey);
    const endpointUrl = geminiModelsEndpoint(route.baseUrl);
    return sendJson(res, 200, { ...result, providerType, provider, endpoint: endpointUrl, diagnostic: providerDiagnostic({ providerType, provider, endpoint: endpointUrl, model: "", httpStatus: result.status, raw: { models: result.models }, responseShape: "gemini.models", apiKey }) });
  }

  if (!apiKey || (!model && body.task !== "gemini_list_models")) return sendJson(res, 503, { error: "AI_NOT_CONFIGURED", code: "AI_NOT_CONFIGURED" });

  if (isConnectionTest && isOfficialGemini) {
    if (!isGeminiTextOutputModel(model)) return sendJson(res, 400, { error: "该模型用于语音生成，不能用于文本分析", code: "GEMINI_TEXT_MODEL_REQUIRED", model });
    const modelList = await fetchGeminiModels(route.baseUrl, apiKey);
    const modelsEndpoint = geminiModelsEndpoint(route.baseUrl);
    if (!modelList.modelIds.includes(model)) {
      const endpointUrl = geminiEndpoint(route.baseUrl, model || "model");
      const diagnostic = providerDiagnostic({ providerType, provider, endpoint: endpointUrl, model, httpStatus: 409, upstreamStatus: 200, upstreamMessage: `Model ${model || "(empty)"} is not listed for generateContent`, responseShape: "gemini.models", apiKey });
      return sendJson(res, 409, { error: `当前 Gemini API Key 无权使用 ${model || "当前模型"}`, code: "MODEL_NOT_AVAILABLE", model, availableModels: modelList.modelIds, modelsStatus: modelList.status, modelsEndpoint, endpoint: endpointUrl, diagnostic });
    }
    const request = geminiRequest(route.baseUrl, apiKey, model, "Reply only with OK", null, { minimal: true });
    const startedAt = Date.now();
    let raw;
    try { raw = await requestJson(request.url, request.options, apiKey, { retry: false, timeoutMs: AI_TIMEOUT_MS }); }
    catch (error) { Object.assign(error, { officialGemini: true, providerType, provider, model, endpoint: request.url }); throw error; }
    const content = readGeminiResponse(raw);
    if (!content.trim()) {
      const error = new Error("Gemini returned HTTP 200 without readable candidate text");
      Object.assign(error, { code: "UPSTREAM_OK_PARSE_FAILED", status: 502, providerType, provider, model, endpoint: request.url, responseShape: "gemini.candidates" });
      throw error;
    }
    const diagnostic = providerDiagnostic({ providerType, provider, endpoint: request.url, model, httpStatus: 200, raw, upstreamMessage: content, responseShape: "gemini.candidates", apiKey });
    return sendJson(res, 200, { connection: { ok: true, providerType, provider, model, endpoint: request.url, modelsEndpoint, modelsStatus: modelList.status, generateStatus: 200, availableModels: modelList.modelIds, reply: content, durationMs: Date.now() - startedAt }, diagnostic });
  }

  const prompt = promptFor(body);
  const isMinimalTest = isConnectionTest;
  if (isOfficialGemini && !isGeminiTextOutputModel(model)) return sendJson(res, 400, { error: "该模型用于语音生成，不能用于文本分析", code: "GEMINI_TEXT_MODEL_REQUIRED", model });
  let providerRequest;
  let readResponse;
  let responseShape;
  if (providerType === "relay" && provider === "openai-compatible") {
    providerRequest = openAICompatibleRequest(route.baseUrl, apiKey, model, prompt, { jsonResponse: !isMinimalTest });
    readResponse = readOpenAICompatibleResponse;
    responseShape = "chat_completions.choices[0].message.content";
  } else if (isGeminiNative) {
    // lk888's Gemini-compatible relay only gets the Gemini contents payload.
    // Keep official Gemini's structured generation config isolated below this branch.
    providerRequest = geminiRequest(route.baseUrl, apiKey, model, prompt, schemaForTask(body.task, body.expression_type), {
      minimal: isMinimalTest || isRelayGemini,
      includeThinkingConfig: false,
    });
    readResponse = readGeminiResponse;
    responseShape = "gemini.candidates[0].content.parts";
  } else if (isOfficialOpenAI) {
    providerRequest = openAIResponsesRequest(apiKey, model, prompt, { minimal: isMinimalTest });
    readResponse = readOpenAIResponsesResponse;
    responseShape = "responses.output/output_text";
  } else {
    return sendJson(res, 400, { error: "AI credential provider configuration is invalid", code: "AI_CREDENTIAL_INVALID" });
  }

  const requestUrl = providerRequest.url;
  const requestStartedAt = Date.now();
  if (env.NODE_ENV === "development" && isRelayGemini) {
    const requestBody = JSON.parse(providerRequest.options.body);
    const generationConfig = requestBody.generationConfig || {};
    console.info("[AI relay request shape]", {
      task: body.task,
      model,
      endpoint: requestUrl,
      hasGenerationConfig: Boolean(requestBody.generationConfig),
      hasResponseMimeType: Boolean(generationConfig.responseMimeType),
      hasResponseSchema: Boolean(generationConfig.responseSchema),
      hasThinkingConfig: Boolean(generationConfig.thinkingConfig),
      promptLength: String(requestBody.contents?.[0]?.parts?.[0]?.text || "").length,
    });
  }
  const isWordProfileTask = ["vocabulary_analysis", "vocab-profile"].includes(body.task);
  const runForModel = async (requestedModel) => {
    const request = isGeminiNative
      ? geminiRequest(route.baseUrl, apiKey, requestedModel, prompt, schemaForTask(body.task, body.expression_type), {
          minimal: isMinimalTest || isRelayGemini,
          includeThinkingConfig: false,
        })
      : providerRequest;
    const raw = await requestJson(request.url, request.options, apiKey, { retry: !isWordProfileTask && !isConnectionTest, timeoutMs: isWordProfileTask ? 11_000 : AI_TIMEOUT_MS });
    return { raw, model: requestedModel, endpoint: request.url };
  };
  const run = async () => {
    const startedAt = Date.now();
    try {
      try {
        const first = await runForModel(model);
        return { ...first, upstreamDurationMs: Date.now() - startedAt };
      } catch (firstError) {
        if (!isGeminiVocabularyTask || Number(firstError?.status) !== 503) throw firstError;
        await new Promise((resolve) => setTimeout(resolve, 500));
        try {
          const retry = await runForModel(model);
          return { ...retry, upstreamDurationMs: Date.now() - startedAt };
        } catch (retryError) {
          if (Number(retryError?.status) !== 503) throw retryError;
          const fastModel = String(credential.fast_model || "").trim();
          if (!fastModel || fastModel === model) throw retryError;
          if (!isGeminiTextOutputModel(fastModel)) {
            Object.assign(retryError, { code: "GEMINI_TEXT_MODEL_REQUIRED", providerType, provider, model: fastModel, endpoint: geminiEndpoint(route.baseUrl, fastModel) });
            throw retryError;
          }
          const fallback = await runForModel(fastModel);
          return { ...fallback, upstreamDurationMs: Date.now() - startedAt };
        }
      }
    } catch (error) {
      Object.assign(error, { providerType, provider, model: error?.model || model, endpoint: error?.endpoint || requestUrl, requestDurationMs: error?.durationMs, durationMs: Date.now() - startedAt });
      throw error;
    }
  };
  const dedupeKey = body.task === "translate_sentence" && (body.video_id || body.subtitle_text || body.text_en)
    ? `${body.credential_id}|${body.task}|${model}|${body.video_id || "local"}|${body.cache_key || body.subtitle_text || body.text_en}`
    : ["subtitle_batch", "subtitle_translate_batch", "subtitle_learning_batch"].includes(body.task)
      ? `${body.credential_id}|${body.task}|${model}|${body.video_id || "local"}|${body.subtitle_hash || ""}|${body.block_id || ""}`
      : isWordProfileTask ? `${body.credential_id}|${body.task}|${model}|${String(body.expression_en || "").toLowerCase()}|${body.cache_key || body.source_sentence_en || ""}` : null;
  let raw;
  let upstreamDurationMs = null;
  let effectiveModel = model;
  let effectiveEndpoint = requestUrl;
  if (dedupeKey && IN_FLIGHT.has(dedupeKey)) ({ raw, upstreamDurationMs, model: effectiveModel, endpoint: effectiveEndpoint } = await IN_FLIGHT.get(dedupeKey));
  else {
    const pending = run();
    if (dedupeKey) IN_FLIGHT.set(dedupeKey, pending);
    try { ({ raw, upstreamDurationMs, model: effectiveModel, endpoint: effectiveEndpoint } = await pending); } finally { if (dedupeKey) IN_FLIGHT.delete(dedupeKey); }
  }
  const content = readResponse(raw);
  if (!content.trim()) {
    const error = new Error("Upstream returned HTTP 200 without response text");
    Object.assign(error, { code: "UPSTREAM_EMPTY_RESPONSE", status: 502, upstreamStatus: 200, durationMs: upstreamDurationMs, providerType, provider, model: effectiveModel, endpoint: effectiveEndpoint, responseShape, providerCode: raw?.promptFeedback?.blockReason || raw?.candidates?.[0]?.finishReason || "", providerMessage: "Upstream returned HTTP 200 without readable response text" });
    throw error;
  }
  const diagnostic = providerDiagnostic({ providerType, provider, endpoint: effectiveEndpoint, model: effectiveModel, httpStatus: 200, raw, upstreamMessage: isConnectionTest ? content : "", responseShape, apiKey });
  if (isConnectionTest) {
    if (env.NODE_ENV === "development" && isRelayGemini) console.info("[/api/ai] request completed", { task: body.task, credentialId: body.credential_id, providerType, provider, model: effectiveModel, endpoint: effectiveEndpoint, httpStatus: 200, upstreamStatus: 200, candidateTextLength: content.length, parseResult: "connection_text", durationMs: Date.now() - requestStartedAt });
    return sendJson(res, 200, { connection: { ok: true, providerType, provider, model: effectiveModel, endpoint: effectiveEndpoint, reply: content, durationMs: upstreamDurationMs }, diagnostic });
  }

  let parsed;
  const parseStartedAt = Date.now();
  try { parsed = parseJsonContent(content); }
  catch (error) {
    Object.assign(error, { code: "UPSTREAM_OK_PARSE_FAILED", status: 502, upstreamStatus: 200, durationMs: upstreamDurationMs, providerType, provider, model: effectiveModel, endpoint: effectiveEndpoint, responseShape, candidateTextLength: content.length, providerMessage: "Upstream returned text that could not be parsed as JSON" });
    throw error;
  }
  if (env.NODE_ENV === "development" && isRelayGemini) console.info("[/api/ai] request completed", { task: body.task, credentialId: body.credential_id, providerType, provider, model: effectiveModel, endpoint: effectiveEndpoint, httpStatus: 200, upstreamStatus: 200, candidateTextLength: content.length, parseResult: "json_ok", jsonParseMs: Date.now() - parseStartedAt, durationMs: Date.now() - requestStartedAt });
  const result = ["translate_sentence", "analyze-subtitle"].includes(body.task) ? normalizeAnalysisResult(parsed) : parsed;
  const key = body.task === "subtitle_batch" ? "batch" : body.task === "subtitle_translate_batch" ? "translation_batch" : body.task === "subtitle_learning_batch" ? "learning_batch" : ["translate_sentence", "analyze-subtitle"].includes(body.task) ? "analysis" : body.task === "generate_distractors" ? "distractors" : "profile";
  return sendJson(res, 200, { [key]: result, diagnostic, ...(isWordProfileTask ? { profile_diagnostics: { model: effectiveModel, upstreamDurationMs } } : {}) });
}
