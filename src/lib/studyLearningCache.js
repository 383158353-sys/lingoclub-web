export function partialAnalysisForCue(cue, previous = null) {
  const processing = cue?.ai_processing || {};
  const words = (processing.difficultWords || []).map((item) => ({
    word: item.expression || item.word || "",
    meaning: item.contextMeaning || item.basicMeaning || item.meaning || "",
    contextMeaning: item.contextMeaning || "",
    partOfSpeech: item.partOfSpeech || item.pos || "",
  })).filter((item) => item.word);
  const phrases = (processing.phrases || []).map((item) => ({
    phrase: item.expression || item.phrase || "",
    meaning: item.contextMeaning || item.basicMeaning || item.meaning || "",
    usage: item.type || "",
  })).filter((item) => item.phrase);
  const translation = cue?.ai_analysis?.translation || processing.translation || cue?.text_zh || previous?.translation || "";
  if (!translation && !words.length && !phrases.length && !previous) return null;
  return {
    ...(previous || {}),
    translation,
    words: words.length ? words : (previous?.words || []),
    phrases: phrases.length ? phrases : (previous?.phrases || []),
    grammar: previous?.grammar || "",
    cultural: previous?.cultural || "",
    _complete: false,
    _preprocessed: true,
  };
}

export function mergeCompleteAnalysis(current, cueId, analysis) {
  const previous = current[cueId] || {};
  return {
    ...current,
    [cueId]: {
      ...previous,
      ...analysis,
      translation: analysis?.translation || previous.translation || "",
      words: analysis?.words?.length ? analysis.words : (previous.words || []),
      phrases: analysis?.phrases?.length ? analysis.phrases : (previous.phrases || []),
      _complete: true,
      _preprocessed: false,
    },
  };
}

export function getStudyWordCacheResult({ getSubtitleTerm, getWordProfile }) {
  const subtitleTerm = getSubtitleTerm?.();
  if (subtitleTerm) return { source: "subtitle", value: subtitleTerm };
  const cachedProfile = getWordProfile?.();
  if (cachedProfile) return { source: "profile", value: cachedProfile };
  return null;
}

export async function resolveStudyWordLookup({ cacheResult, requestWordProfile }) {
  if (cacheResult) return cacheResult;
  return { source: "ai", value: await requestWordProfile() };
}

export function quickWordLookupPayload(expression, { subtitleText, videoId, movieTitle, contextText } = {}) {
  const sentence = subtitleText || "";
  return {
    expression_en: expression,
    subtitle_text: contextText || sentence,
    video_id: videoId,
    context: `${movieTitle || "film & TV"}; current subtitle: ${sentence}`,
    quick: true,
  };
}
