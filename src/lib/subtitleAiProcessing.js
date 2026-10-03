import { invokeAI } from "./localApi.js";
import { toSec } from "./timecode.js";

export const SUBTITLE_BATCH_SIZE = 36;
export const SUBTITLE_BATCH_OVERLAP = 4;
export const SUBTITLE_TRANSLATION_BATCH_SIZE = 16;
export const SUBTITLE_TRANSLATION_BATCH_OVERLAP = 4;
export const SUBTITLE_TRANSLATION_CONCURRENCY = 1;
export const SUBTITLE_LEARNING_PRELOAD_BEFORE = 20;
export const SUBTITLE_LEARNING_PRELOAD_AFTER = 40;
export const SUBTITLE_LEARNING_BATCH_SIZE = 20;
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

export function resolveSubtitleTranslationState(cue, phase = "processing", failedCueIds = []) {
  if (String(cue?.text_zh || "").trim()) return "success";
  const failed = failedCueIds instanceof Set ? failedCueIds : new Set(failedCueIds || []);
  return failed.has(cue?.id) && phase === "error" ? "error" : "loading";
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
function emptyCache() { return { contextSummary: "", cues: {}, translations: {}, terms: {}, diagnostics: { totalCues: 0, batches: 0, uniqueDifficultWords: 0, uniquePhrases: 0, cacheHits: 0, cacheMisses: 0, batchTranslationCalls: 0, fallbackWordCalls: 0, closeReadingCalls: 0 } }; }
function readCache(key) {
  try { return { ...emptyCache(), ...(typeof localStorage === "undefined" ? {} : JSON.parse(localStorage.getItem(key) || "null") || {}) }; } catch { return emptyCache(); }
}
function writeCache(key, cache) { try { if (typeof localStorage !== "undefined") localStorage.setItem(key, JSON.stringify(cache)); return true; } catch { /* local cache is opportunistic; cue data is also saved with the movie */ return false; } }

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

export function buildSubtitleTranslationBatches(cues) {
  const batches = [];
  for (let start = 0; start < cues.length; start += SUBTITLE_TRANSLATION_BATCH_SIZE) {
    const end = Math.min(start + SUBTITLE_TRANSLATION_BATCH_SIZE, cues.length);
    const contextStart = Math.max(0, start - SUBTITLE_TRANSLATION_BATCH_OVERLAP);
    const contextEnd = Math.min(cues.length, end + SUBTITLE_TRANSLATION_BATCH_OVERLAP);
    const targetIds = new Set(cues.slice(start, end).map((cue) => cue.id));
    batches.push({
      id: `t${start}-${end}`,
      start: toSec(cues[start]?.time_start) || 0,
      end: toSec(cues[end - 1]?.time_end || cues[end - 1]?.time_start) || 0,
      coreCues: cues.slice(start, end),
      cues: cues.slice(contextStart, contextEnd).map((cue) => ({ ...cue, target: targetIds.has(cue.id) })),
    });
  }
  return batches;
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

export async function processSubtitleEpisode({ videoId, subtitles, getCurrentTime, signal, onProgress, onPriorityTranslationReady, translateBatch = invokeAI }) {
  const startedAt = Date.now();
  const hashValue = subtitleHash(subtitles);
  const key = cacheKey(videoId, hashValue);
  const cache = readCache(key);
  for (const cue of subtitles) {
    if (cue.ai_episode_context?.subtitleHash === hashValue) cache.contextSummary = cue.ai_episode_context.summary || cache.contextSummary;
    if (cue.ai_processing?.subtitleHash === hashValue) {
      cache.cues[cue.id] = cue.ai_processing;
      if (cue.ai_processing.translation) cache.translations[cue.id] ||= { subtitleHash: hashValue, translation: cue.ai_processing.translation };
    }
  }
  let preparedSubtitles = subtitles.map((cue) => {
    const cached = cache.cues[cue.id];
    const cachedTranslation = cache.translations[cue.id];
    if (cached?.subtitleHash === hashValue) {
      for (const item of [...(cached.difficultWords || []), ...(cached.phrases || [])]) {
        const termKey = `${normalizeExpression(item.expression)}|${normalizeExpression(item.contextMeaning)}`;
        cache.terms[termKey] ||= item;
      }
    }
    const translation = cue.text_zh || (cachedTranslation?.subtitleHash === hashValue ? cachedTranslation.translation : "") || (cached?.subtitleHash === hashValue ? cached.translation : "");
    if (!translation && (!cached || cached.subtitleHash !== hashValue)) return cue;
    return { ...cue, text_zh: translation, ...(cached?.subtitleHash === hashValue ? { ai_processing: cached } : {}) };
  });
  const cues = preparedSubtitles.filter((cue) => String(cue.text_en || "").trim());
  cache.diagnostics.totalCues = cues.length;
  const pending = new Map(cues.filter((cue) => !String(cue.text_zh || "").trim()).map((cue) => [cue.id, cue]));
  const allBatches = buildSubtitleTranslationBatches(cues);
  const batches = allBatches.filter((batch) => batch.coreCues.some((cue) => pending.has(cue.id)));
  const completedIds = new Set(cues.filter((cue) => cue.text_zh?.trim()).map((cue) => cue.id));
  for (const cue of cues) if (!cue.text_zh?.trim() && cache.translations[cue.id]?.subtitleHash === hashValue && cache.translations[cue.id]?.translation) completedIds.add(cue.id);
  const run = { totalCues: cues.length, missingTranslationCues: pending.size, batchSize: SUBTITLE_TRANSLATION_BATCH_SIZE, totalBatches: batches.length, concurrency: SUBTITLE_TRANSLATION_CONCURRENCY, completedCues: completedIds.size, apiCalls: 0, durationMs: 0, stage: "items_created", requestStatus: "not_sent", responseStatus: null, providerErrorType: null, parseError: null, timeout: false, cacheWrite: "not_attempted", failedCueIds: [] };
  const failedCues = new Set();
  cache.diagnostics.batches = batches.length;
  cache.diagnostics.cacheHits += completedIds.size - cues.filter((cue) => cue.text_zh?.trim()).length;
  cache.diagnostics.cacheMisses = pending.size;
  const report = async (phase, error = "") => {
    run.completedCues = completedIds.size;
    run.durationMs = Date.now() - startedAt;
    run.failedCueIds = [...failedCues];
    await onProgress?.({ phase, ...(error ? { error } : {}), completed: run.completedCues, total: run.totalCues, failedCueIds: run.failedCueIds, diagnostics: { ...cache.diagnostics, ...run }, subtitles: preparedSubtitles, hash: hashValue });
  };
  await report(pending.size ? "processing" : "ready");
  if (!pending.size) return { subtitles: preparedSubtitles, cache, hash: hashValue, diagnostics: run };

  // Keep list translations chronological. A single worker ensures the earliest
  // visible rows are filled before later batches are sent.
  const orderedBatches = batches;
  const priorityBatchId = orderedBatches[0]?.id;
  let priorityLearningScheduled = false;
  let cursor = 0;

  const translateChunk = async (targetCues, contextCues, blockId) => {
    if (signal?.aborted) throw Object.assign(new Error("cancelled"), { name: "AbortError" });
    const targetIds = new Set(targetCues.map((cue) => cue.id));
    cache.diagnostics.batchTranslationCalls += 1;
    run.stage = "translation_request_queued";
    const response = await translateBatch("subtitle_translate_batch", {
      video_id: videoId,
      subtitle_hash: hashValue,
      block_id: blockId,
      cache_key: `${hashValue}|${blockId}|${[...targetIds].join(",")}`,
      subtitle_text: `${hashValue}|${blockId}|${[...targetIds].join(",")}`,
      cues: contextCues.map((cue) => ({ cueId: cue.id, text: cue.text_en, target: targetIds.has(cue.id) })),
    }, {
      signal,
      cacheVersion: "subtitle-translation-v1",
      onDiagnostics: (diagnostics) => {
        if (!diagnostics.cacheHit && !diagnostics.deduped) run.apiCalls += Number(diagnostics.networkRequests) || 0;
        run.requestStatus = diagnostics.cacheHit ? "cache_hit" : diagnostics.deduped ? "deduped" : "sent";
        run.responseStatus = diagnostics.cacheHit || diagnostics.deduped ? null : (Number(diagnostics.httpStatus) || (diagnostics.status === "success" ? 200 : null));
        run.providerErrorType = diagnostics.providerErrorType || null;
        run.timeout = Boolean(diagnostics.timeout);
      },
    });
    run.stage = "translation_response_returned";
    const translated = response?.translation_batch?.cues || [];
    run.stage = "translation_response_parsed";
    const translations = new Map(translated.map((cue) => [cue.cueId, String(cue.translation || "").trim()]));
    const missingIds = targetCues.filter((cue) => !translations.get(cue.id));
    if (missingIds.length) {
      run.parseError = "missing_or_empty_cue_translation";
      throw Object.assign(new Error(`Batch translation omitted ${missingIds.length} cue(s)`), { code: "TRANSLATION_PARSE_ERROR" });
    }
    for (const cue of targetCues) {
      const translation = translations.get(cue.id);
      cache.translations[cue.id] = { subtitleHash: hashValue, translation };
      completedIds.add(cue.id);
      pending.delete(cue.id);
    }
    preparedSubtitles = preparedSubtitles.map((cue) => {
      const translation = translations.get(cue.id);
      return translation && !cue.text_zh?.trim() ? { ...cue, text_zh: translation } : cue;
    });
    run.cacheWrite = writeCache(key, cache) ? "success" : "failed";
    run.stage = "translation_written_to_state_cache";
    await report("processing");
    if (!priorityLearningScheduled && priorityBatchId && (blockId === priorityBatchId || blockId.startsWith(`${priorityBatchId}-`))) {
      priorityLearningScheduled = true;
      onPriorityTranslationReady?.();
    }
  };

  const translateWithFallback = async (targetCues, contextCues, blockId) => {
    try {
      await translateChunk(targetCues, contextCues, blockId);
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw error;
      run.stage = error?.code === "TRANSLATION_PARSE_ERROR" ? "response_parse_error" : "translation_api_error";
      run.responseStatus = Number(error?.status || error?.upstreamStatus) || run.responseStatus;
      run.providerErrorType = String(error?.upstreamCode || error?.code || error?.name || "translation_failed").slice(0, 80);
      run.timeout = error?.name === "TimeoutError" || /timeout|timed out/i.test(String(error?.message || ""));
      const isRetryable = error?.name === "TimeoutError" || error instanceof TypeError || error?.status === 429 || error?.status >= 500;
      let finalError = error;
      if (isRetryable) {
        try {
          await translateChunk(targetCues, contextCues, blockId);
          return;
        } catch (retryError) {
          if (signal?.aborted || retryError?.name === "AbortError") throw retryError;
          finalError = retryError;
          run.responseStatus = Number(retryError?.status || retryError?.upstreamStatus) || run.responseStatus;
          run.providerErrorType = String(retryError?.upstreamCode || retryError?.code || retryError?.name || "translation_failed").slice(0, 80);
          run.timeout ||= retryError?.name === "TimeoutError" || /timeout|timed out/i.test(String(retryError?.message || ""));
        }
      }
      const shouldSplit = targetCues.length > SUBTITLE_TRANSLATION_BATCH_SIZE / 2 && (
        finalError?.status === 413
        || /timeout|token|context|payload|too long|truncat|omitted|parse|json/i.test(String(finalError?.message || ""))
        || isRetryable
      );
      if (shouldSplit) {
        const middle = Math.ceil(targetCues.length / 2);
        const first = targetCues.slice(0, middle);
        const second = targetCues.slice(middle);
        const targetSet = new Set(targetCues.map((cue) => cue.id));
        const contextFor = (items) => {
          const from = Math.max(0, cues.findIndex((cue) => cue.id === items[0].id) - SUBTITLE_TRANSLATION_BATCH_OVERLAP);
          const to = Math.min(cues.length, cues.findIndex((cue) => cue.id === items.at(-1).id) + SUBTITLE_TRANSLATION_BATCH_OVERLAP + 1);
          return cues.slice(from, to).filter((cue) => targetSet.has(cue.id) || !pending.has(cue.id));
        };
        await translateWithFallback(first, contextFor(first), `${blockId}-a`);
        await translateWithFallback(second, contextFor(second), `${blockId}-b`);
        return;
      }
      for (const cue of targetCues) failedCues.add(cue.id);
    }
  };

  const worker = async () => {
    while (!signal?.aborted) {
      const batch = orderedBatches[cursor++];
      if (!batch) return;
      const targets = batch.coreCues.filter((cue) => pending.has(cue.id));
      if (!targets.length) continue;
      await translateWithFallback(targets, batch.cues, batch.id);
    }
  };
  await Promise.all(Array.from({ length: Math.min(SUBTITLE_TRANSLATION_CONCURRENCY, orderedBatches.length) }, () => worker()));
  if (signal?.aborted) return { subtitles: preparedSubtitles, cache, hash: hashValue, cancelled: true, diagnostics: run };
  const hadFailures = failedCues.size > 0;
  run.stage = hadFailures ? "translation_retry_exhausted" : "translation_complete";
  await report(hadFailures ? "error" : "ready", hadFailures ? "部分字幕翻译失败，可以重试未完成部分" : "");
  return { subtitles: preparedSubtitles, cache, hash: hashValue, ...(hadFailures ? { error: new Error("部分字幕翻译失败"), failedCueIds: [...failedCues] } : {}), diagnostics: run };
}

export async function processSubtitleLearningWindow({ videoId, subtitles, getCurrentTime, signal, onProgress, analyzeBatch = invokeAI }) {
  const hashValue = subtitleHash(subtitles);
  const key = cacheKey(videoId, hashValue);
  const cache = readCache(key);
  let preparedSubtitles = subtitles.map((cue) => {
    if (cue.ai_processing?.subtitleHash === hashValue) cache.cues[cue.id] = cue.ai_processing;
    const cached = cache.cues[cue.id];
    if (!cached || cached.subtitleHash !== hashValue) return cue;
    return { ...cue, ai_processing: { ...cached, ...(cue.ai_processing || {}) } };
  });
  const cues = preparedSubtitles.filter((cue) => String(cue.text_en || "").trim());
  if (!cues.length) return { subtitles: preparedSubtitles, total: 0, completed: 0 };

  const currentTime = Number(getCurrentTime?.()) || 0;
  let currentIndex = 0;
  let closestDistance = Infinity;
  cues.forEach((cue, index) => {
    const start = toSec(cue.time_start);
    if (!Number.isFinite(start)) return;
    const d = Math.abs(start - currentTime);
    if (d < closestDistance) { closestDistance = d; currentIndex = index; }
  });
  const windowCues = cues.slice(
    Math.max(0, currentIndex - SUBTITLE_LEARNING_PRELOAD_BEFORE),
    Math.min(cues.length, currentIndex + SUBTITLE_LEARNING_PRELOAD_AFTER + 1),
  );
  const needsLearning = (cue) => {
    const item = cue.ai_processing || cache.cues[cue.id];
    return !(item?.subtitleHash === hashValue && Array.isArray(item.difficultWords) && Array.isArray(item.phrases));
  };
  const pending = new Set(windowCues.filter(needsLearning).map((cue) => cue.id));
  const batches = [];
  for (let start = 0; start < windowCues.length; start += SUBTITLE_LEARNING_BATCH_SIZE) {
    const coreCues = windowCues.slice(start, start + SUBTITLE_LEARNING_BATCH_SIZE);
    const contextStart = Math.max(0, start - 3);
    const contextEnd = Math.min(windowCues.length, start + SUBTITLE_LEARNING_BATCH_SIZE + 3);
    batches.push({
      id: `l${start}`,
      coreCues,
      cues: windowCues.slice(contextStart, contextEnd).map((cue) => ({ ...cue, target: coreCues.some((target) => target.id === cue.id) })),
      start: toSec(coreCues[0]?.time_start) || 0,
      end: toSec(coreCues.at(-1)?.time_end || coreCues.at(-1)?.time_start) || 0,
    });
  }
  const work = batches.filter((batch) => batch.coreCues.some((cue) => pending.has(cue.id)));
  const distance = (batch) => currentTime < batch.start ? batch.start - currentTime : currentTime > batch.end ? currentTime - batch.end : 0;
  const currentCueId = cues[currentIndex]?.id;
  work.sort((a, b) => {
    const aContainsCurrent = a.coreCues.some((cue) => cue.id === currentCueId);
    const bContainsCurrent = b.coreCues.some((cue) => cue.id === currentCueId);
    if (aContainsCurrent !== bContainsCurrent) return aContainsCurrent ? -1 : 1;
    return distance(a) - distance(b);
  });
  let completed = windowCues.length - pending.size;
  const total = windowCues.length;
  const report = async (phase) => onProgress?.({ phase, completed, total, subtitles: preparedSubtitles, hash: hashValue });
  await report(pending.size ? "processing" : "ready");

  for (const batch of work) {
    if (signal?.aborted) return { subtitles: preparedSubtitles, total, completed, cancelled: true };
    const targets = batch.coreCues.filter((cue) => pending.has(cue.id));
    if (!targets.length) continue;
    const blockId = batch.id;
    let response;
    try {
      response = await analyzeBatch("subtitle_learning_batch", {
        video_id: videoId,
        subtitle_hash: hashValue,
        block_id: blockId,
        subtitle_text: `${hashValue}|learning|${blockId}|${targets.map((cue) => cue.id).join(",")}`,
        cues: batch.cues.map((cue) => ({ cueId: cue.id, text: cue.text_en, target: targets.some((target) => target.id === cue.id) })),
      }, { signal, cacheVersion: "subtitle-learning-v1" });
    } catch (error) {
      if (signal?.aborted) return { subtitles: preparedSubtitles, total, completed, cancelled: true };
      continue;
    }
    const results = new Map((response?.learning_batch?.cues || []).map((cue) => [cue.cueId, cue]));
    preparedSubtitles = preparedSubtitles.map((cue) => {
      if (!targets.some((target) => target.id === cue.id)) return cue;
      const result = results.get(cue.id);
      const existing = cue.ai_processing || cache.cues[cue.id] || {};
      const learning = {
        ...existing,
        subtitleHash: hashValue,
        difficultWords: Array.isArray(result?.difficultWords) ? result.difficultWords.slice(0, 2) : [],
        phrases: Array.isArray(result?.phrases) ? result.phrases.slice(0, 2) : [],
      };
      cache.cues[cue.id] = learning;
      pending.delete(cue.id);
      completed += 1;
      return { ...cue, ai_processing: learning };
    });
    writeCache(key, cache);
    await report(pending.size ? "processing" : "ready");
  }
  return { subtitles: preparedSubtitles, total, completed, partial: pending.size > 0 };
}
