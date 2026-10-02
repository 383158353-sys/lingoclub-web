export const WORD_PROFILE_SCHEMA_VERSION = 4;

export function isCurrentWordProfile(profile) {
  return profile?.schema_version === WORD_PROFILE_SCHEMA_VERSION
    && ["word", "phrase", "sentence"].includes(profile.expression_type)
    && Array.isArray(profile.senses)
    && profile.senses.length > 0
    && profile.senses.every((sense) => typeof sense?.pos === "string" && Array.isArray(sense.meanings));
}

export function normalizeWordProfile(profile, expression = "") {
  const source = profile && typeof profile === "object" ? profile : {};
  let senses = Array.isArray(source.senses) ? source.senses.map((sense) => {
    if (typeof sense === "string") return { pos: source.pos || "", meanings: [sense] };
    const meanings = Array.isArray(sense?.meanings) ? sense.meanings.filter(Boolean) : [sense?.meaning].filter(Boolean);
    return { pos: sense?.pos || source.pos || source.part_of_speech || "", meanings };
  }).filter((sense) => sense.meanings.length) : [];
  if (!senses.length && (source.meaning || source.core_meanings?.length)) {
    const fallbackMeanings = Array.isArray(source.core_meanings)
      ? source.core_meanings.map((item) => typeof item === "string" ? item : item?.meaning).filter(Boolean)
      : [source.meaning].filter(Boolean);
    if (fallbackMeanings.length) senses = [{ pos: source.pos || source.part_of_speech || "", meanings: fallbackMeanings }];
  }
  let structureAnalysis = source.structure_analysis;
  if (!structureAnalysis && (source.expression_structure?.length || source.expression_structure_note)) {
    structureAnalysis = {
      reliable: source.expression_structure_reliable === true,
      parts: source.expression_structure || [],
      explanation: source.expression_structure_note || "",
    };
  }
  return {
    ...source,
    schema_version: WORD_PROFILE_SCHEMA_VERSION,
    expression: source.expression || expression,
    expression_type: ["word", "phrase", "sentence"].includes(source.expression_type)
      ? source.expression_type
      : inferExpressionType(expression),
    senses,
    roots: Array.isArray(source.roots) ? source.roots.filter((part) => part?.part && part?.meaning) : [],
    synthesis: typeof source.synthesis === "string" ? source.synthesis : "",
    structure_analysis: structureAnalysis,
  };
}

export function inferExpressionType(expression = "") {
  const text = String(expression).trim();
  const wordCount = text ? text.split(/\s+/).length : 0;
  if (/[.!?;:]$/.test(text) || wordCount > 5) return "sentence";
  return wordCount > 1 ? "phrase" : "word";
}

export function summarizeWordProfileShape(profile) {
  return {
    keys: Object.keys(profile || {}).sort(),
    hasSenses: Array.isArray(profile?.senses),
    senses: Array.isArray(profile?.senses) ? profile.senses.map((sense) => ({
      pos: sense?.pos || "",
      meaningsCount: Array.isArray(sense?.meanings) ? sense.meanings.length : sense?.meaning ? 1 : 0,
    })) : [],
    hasUsIpa: Boolean(profile?.phonetic_us),
    hasUkIpa: Boolean(profile?.phonetic_uk),
    rootsCount: Array.isArray(profile?.roots) ? profile.roots.length : 0,
    hasStructureAnalysis: Boolean(profile?.structure_analysis || profile?.expression_structure?.length),
  };
}
