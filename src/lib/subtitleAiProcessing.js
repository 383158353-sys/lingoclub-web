import { invokeAI } from "./localApi.js";
import { toSec } from "./timecode.js";

export const SUBTITLE_BATCH_SIZE = 36;
export const SUBTITLE_BATCH_OVERLAP = 4;
export const CLOSE_READING_VERSION = 2;
const CACHE_PREFIX = "lingoclub:subtitle-ai:v2:";
const BASIC_WORDS = new Set("a an the i you he she it we they me him her us them my your his its our their this that these those be am is are was were been being do does did have has had can could will would should may might must and or but if so to of in on at by for with from as into about up down out off over under good get got go know think see look make take say said tell call want need like just really very here there then now".split(" "));

function hash(value) {
  let result = 2166136261;
  for (let i = 0; i < value.length; i += 1) { result ^= value.charCodeAt(i); result = Math.imul(result, 16777619); }
  return (result >>> 0).toString(36);
}

export function subtitleHash(subtitles = []) {
  return hash(subtitles.map((cue, index) => [cue.id || `cue-${index}`, cue.time_start || cue.start || "", cue.time_end || cue.duration || "", cue.text_en || ""].join("\u001f")).join("\u001e"));
}

function cacheKey(videoId, hashValue) { return `${CACHE_PREFIX}${encodeURIComponent(videoId || "local")}:${hashValue}`; }
function normalizeExpression(value) { return String(value || "").toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]/g, " ").replace(/\s+/g, " ").trim(); }
const PHRASE_PLACEHOLDERS = new Set(["someone", "somebody", "something", "anyone", "anybody", "a", "an", "the", "one", "ones"]);
function expressionMatchesText(expression, text) {
  const normalizedExpression = normalizeExpression(expression);
  const normalizedText = normalizeExpression(text);
  if (!normalizedExpression || !normalizedText) return false;
  if (` ${normalizedText} `.includes(` ${normalizedExpression} `)) return true;
  const anchors = normalizedExpression.split(" ").filter((word) => !PHRASE_PLACEHOLDERS.has(word));
  const words = normalizedText.split(" ");
  if (anchors.length < 2) return false;
  let cursor = -1;
  for (const anchor of anchors) {
    const index = words.indexOf(anchor, cursor + 1);
    if (index < 0 || (cursor >= 0 && index - cursor > 5)) return false;
    cursor = index;
  }
  return true;
}
function emptyCache() { return { contextSummary: "", cues: {}, terms: {}, diagnostics: { totalCues: 0, batches: 0, uniqueDifficultWords: 0, uniquePhrases: 0, cacheHits: 0, cacheMisses: 0, batchTranslationCalls: 0, fallbackWordCalls: 0, closeReadingCalls: 0 } }; }
function readCache(key) {
  try { return { ...emptyCache(), ...(typeof localStorage === "undefined" ? {} : JSON.parse(localStorage.getItem(key) || "null") || {}) }; } catch { return emptyCache(); }
}
function writeCache(key, cache) { try { if (typeof localStorage !== "undefined") localStorage.setItem(key, JSON.stringify(cache)); } catch { /* local cache is opportunistic; cue data is also saved with the movie */ } }

export function getSubtitleProcessingCache(videoId, hashValue) { return readCache(cacheKey(videoId, hashValue)); }
export function recordSubtitleAICall(videoId, hashValue, metric) {
  const key = cacheKey(videoId, hashValue);
  const cache = readCache(key);
  if (Object.prototype.hasOwnProperty.call(cache.diagnostics, metric)) cache.diagnostics[metric] += 1;
  writeCache(key, cache);
}
export function getCachedCueLearning(videoId, hashValue, cueId) {
  const cache = readCache(cacheKey(videoId, hashValue));
  return cache.cues[cueId] || null;
}
export function findCueLearningTerm(cue, clickedWord, sourceText = "") {
  if (!cue) return null;
  const clicked = normalizeExpression(clickedWord);
  const sourceWords = normalizeExpression(sourceText).split(" ").filter(Boolean);
  const phraseItems = (cue.phrases || []).filter((item) => {
    const expressionWords = normalizeExpression(item.expression).split(" ").filter(Boolean);
    if (expressionWords.includes(clicked)) return true;
    if (!sourceWords.includes(clicked)) return false;
    const anchors = expressionWords.filter((word) => !PHRASE_PLACEHOLDERS.has(word));
    const positions = anchors.map((word) => sourceWords.indexOf(word)).filter((index) => index >= 0);
    if (positions.length < 2) return false;
    const left = Math.min(...positions);
    const right = Math.max(...positions);
    const clickedIndex = sourceWords.indexOf(clicked);
    return clickedIndex >= left && clickedIndex <= right;
  }).sort((a, b) => normalizeExpression(b.expression).length - normalizeExpression(a.expression).length);
  const exactWord = (cue.difficultWords || []).find((item) => normalizeExpression(item.expression) === clicked);
  return phraseItems[0] || exactWord || null;
}
export function getCachedTerm(videoId, hashValue, expression, cueId, sourceText = "") {
  const cache = readCache(cacheKey(videoId, hashValue));
  const cue = cache.cues[cueId];
  const cached = findCueLearningTerm(cue, expression, sourceText);
  const globalExact = Object.values(cache.terms).find((item) => normalizeExpression(item.expression) === normalizeExpression(expression));
  return cached || globalExact || null;
}

export function getCueContext(subtitles, cueId, radius = 4) {
  const index = subtitles.findIndex((cue) => cue.id === cueId);
  if (index < 0) return { previous: [], target: null, next: [] };
  const format = (cue) => ({ cueId: cue.id, start: cue.time_start || "", duration: cue.time_end || "", text: cue.text_en || "" });
  return {
    previous: subtitles.slice(Math.max(0, index - radius), index).map(format),
    target: format(subtitles[index]),
    next: subtitles.slice(index + 1, index + radius + 1).map(format),
  };
}

export function buildSubtitleBatches(cues) {
  const blocks = [];
  const step = SUBTITLE_BATCH_SIZE - SUBTITLE_BATCH_OVERLAP;
  for (let start = 0; start < cues.length; start += step) {
    if (start > 0 && start >= cues.length - SUBTITLE_BATCH_OVERLAP) break;
    const end = Math.min(start + SUBTITLE_BATCH_SIZE, cues.length);
    const blockCues = cues.slice(start, end);
    const coreCues = start === 0 ? blockCues : blockCues.slice(SUBTITLE_BATCH_OVERLAP);
    blocks.push({
      id: `b${start}`,
      cues: blockCues,
      coreCues,
      start: toSec(blockCues[0]?.time_start) || 0,
      end: toSec(blockCues.at(-1)?.time_start) || 0,
    });
  }
  return blocks;
}

function sanitizeLearning(items = [], type, cueId) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const expression = String(item.expression || item.word || item.phrase || "").trim();
    if (!expression) return null;
    const normalized = normalizeExpression(expression);
    if (type === "word" && normalized.split(" ").length !== 1) return null;
    const basicMeaning = String(item.basicMeaning || item.meaning || "").trim();
    const contextMeaning = String(item.contextMeaning || item.meaning || "").trim();
    if (type === "word" && BASIC_WORDS.has(normalized) && normalizeExpression(contextMeaning) === normalizeExpression(basicMeaning)) return null;
    return {
      expression,
      type: item.type || type,
      basicMeaning,
      contextMeaning,
      partOfSpeech: String(item.partOfSpeech || item.pos || "").trim(),
      cueId: item.cueId || cueId,
    };
  }).filter((item) => item?.basicMeaning || item?.contextMeaning);
}

export async function processSubtitleEpisode({ videoId, subtitles, getCurrentTime, signal, onProgress }) {
  const hashValue = subtitleHash(subtitles);
  const key = cacheKey(videoId, hashValue);
  const cache = readCache(key);
  for (const cue of subtitles) {
    if (cue.ai_episode_context?.subtitleHash === hashValue) cache.contextSummary = cue.ai_episode_context.summary || cache.contextSummary;
    if (cue.ai_processing?.subtitleHash === hashValue) cache.cues[cue.id] = cue.ai_processing;
  }
  let preparedSubtitles = subtitles.map((cue) => {
    const cached = cache.cues[cue.id];
    if (cached?.subtitleHash === hashValue) {
      for (const item of [...(cached.difficultWords || []), ...(cached.phrases || [])]) {
        const termKey = `${normalizeExpression(item.expression)}|${normalizeExpression(item.contextMeaning)}`;
        cache.terms[termKey] ||= item;
      }
    }
    if (!cached || cached.subtitleHash !== hashValue) return cue;
    return { ...cue, text_zh: cue.text_zh || cached.translation || "", ai_processing: cached };
  });
  const cues = preparedSubtitles.filter((cue) => String(cue.text_en || "").trim());
  cache.diagnostics.totalCues = cues.length;
  const pending = new Map(cues.map((cue) => [cue.id, cue]).filter(([id]) => !cache.cues[id]));
  const allBlocks = buildSubtitleBatches(cues);
  const blocks = allBlocks.filter((block) => block.coreCues.some((cue) => pending.has(cue.id)));
  cache.diagnostics.batches = allBlocks.length;
  cache.diagnostics.cacheHits += cues.length - pending.size;
  cache.diagnostics.cacheMisses = pending.size;
  onProgress?.({ phase: pending.size ? "processing" : "ready", completed: cues.length - pending.size, total: cues.length, diagnostics: cache.diagnostics, subtitles: preparedSubtitles, contextSummary: cache.contextSummary, hash: hashValue });
  const attemptedBlocks = new Set();

  while (blocks.some((block) => !attemptedBlocks.has(block.id) && block.coreCues.some((cue) => pending.has(cue.id)))) {
    if (signal?.aborted) return { subtitles: preparedSubtitles, cache, hash: hashValue, cancelled: true };
    const currentTime = Number(getCurrentTime?.()) || 0;
    const distance = (block) => currentTime < block.start ? block.start - currentTime : currentTime > block.end ? currentTime - block.end : 0;
    blocks.sort((a, b) => distance(a) - distance(b));
    const block = blocks.find((item) => !attemptedBlocks.has(item.id) && item.coreCues.some((cue) => pending.has(cue.id)));
    if (!block) break;
    attemptedBlocks.add(block.id);
    const targetIds = new Set(block.coreCues.filter((cue) => pending.has(cue.id)).map((cue) => cue.id));
    const payloadCues = block.cues.map((cue) => ({ cueId: cue.id, start: cue.time_start || "", duration: cue.time_end || "", text: cue.text_en, target: targetIds.has(cue.id) }));
    const knownExpressions = Object.values(cache.terms)
      .filter((item) => block.cues.some((cue) => expressionMatchesText(item.expression, cue.text_en)))
      .slice(0, 30);
    cache.diagnostics.batchTranslationCalls += 1;
    try {
      const response = await invokeAI("subtitle_batch", {
        video_id: videoId,
        subtitle_hash: hashValue,
        block_id: block.id,
        subtitle_text: `${hashValue}|${block.id}|${[...targetIds].join(",")}`,
        episode_context: cache.contextSummary,
        known_expressions: knownExpressions,
        cues: payloadCues,
      }, { signal });
      const result = response?.batch || {};
      if (result.episodeContext) cache.contextSummary = String(result.episodeContext).slice(0, 500);
      const results = new Map((result.cues || []).map((cue) => [cue.cueId, cue]));
      const updated = preparedSubtitles.map((original) => {
        if (!targetIds.has(original.id)) return original;
        const translated = results.get(original.id);
        if (!translated) return original;
        const words = sanitizeLearning(translated.difficultWords, "word", original.id);
        const phrases = sanitizeLearning(translated.phrases, "phrase", original.id);
        const alreadyKnown = knownExpressions.filter((item) => expressionMatchesText(item.expression, original.text_en)).map((item) => ({ ...item, cueId: original.id }));
        for (const known of alreadyKnown) {
          const destination = known.type === "word" ? words : phrases;
          if (!destination.some((item) => normalizeExpression(item.expression) === normalizeExpression(known.expression))) destination.push(known);
        }
        const translation = String(translated.translation || "").trim();
        if (!translation) return original;
        const unique = (items) => items.map((item) => {
          const termKey = `${normalizeExpression(item.expression)}|${normalizeExpression(item.contextMeaning)}`;
          if (!cache.terms[termKey]) cache.terms[termKey] = item;
          return { ...cache.terms[termKey], cueId: item.cueId };
        });
        const cueCache = {
          subtitleHash: hashValue,
          translation,
          difficultWords: unique(words),
          phrases: unique(phrases),
        };
        cache.cues[original.id] = cueCache;
        pending.delete(original.id);
        return { ...original, text_zh: original.text_zh || cueCache.translation, ai_processing: cueCache };
      });
      preparedSubtitles = updated.map((cue, index) => index === 0 ? { ...cue, ai_episode_context: { subtitleHash: hashValue, summary: cache.contextSummary } } : cue);
      cache.diagnostics.uniqueDifficultWords = new Set(Object.values(cache.terms).filter((term) => term.type === "word").map((term) => normalizeExpression(term.expression))).size;
      cache.diagnostics.uniquePhrases = new Set(Object.values(cache.terms).filter((term) => term.type !== "word").map((term) => normalizeExpression(term.expression))).size;
      writeCache(key, cache);
      onProgress?.({ phase: "processing", completed: cues.length - pending.size, total: cues.length, diagnostics: { ...cache.diagnostics }, subtitles: preparedSubtitles, contextSummary: cache.contextSummary, hash: hashValue });
    } catch (error) {
      if (signal?.aborted) return { subtitles: preparedSubtitles, cache, hash: hashValue, cancelled: true };
      onProgress?.({ phase: "error", error: error?.message || "字幕处理失败", completed: cues.length - pending.size, total: cues.length, diagnostics: { ...cache.diagnostics } });
      return { subtitles: preparedSubtitles, cache, hash: hashValue, error };
    }
  }
  onProgress?.({ phase: pending.size ? "partial" : "ready", completed: cues.length - pending.size, total: cues.length, diagnostics: { ...cache.diagnostics }, subtitles: preparedSubtitles, contextSummary: cache.contextSummary, hash: hashValue });
  return { subtitles: preparedSubtitles, cache, hash: hashValue };
}
