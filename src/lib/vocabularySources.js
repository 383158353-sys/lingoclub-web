import { vocabRepository } from "@/lib/vocabRepository";
import { supabase } from "@/lib/supabaseClient";
import { fromSecPrecise, toSec } from "@/lib/timecode";
import { normalizeSourceCue } from "@/lib/vocabularySourceCue";

const normalizedExpression = (value) => String(value || "").trim().toLocaleLowerCase().replace(/\s+/g, " ");

function newId() {
  try { return crypto.randomUUID(); } catch { return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

export function buildVocabularySource(payload = {}) {
  const cue = normalizeSourceCue(payload.sourceCue || payload.source_cue || {
    id: payload.source_subtitle_id,
    start: payload.source_time_start ?? payload.source_timestamp_seconds,
    end: payload.source_time_end ?? payload.source_timestamp_end_seconds,
    textEn: payload.source_sentence_en,
    textZh: payload.source_sentence_zh,
  });
  const sentenceEn = String(cue.textEn || payload.source_sentence_en || (payload.type === "sentence" ? payload.expression_en || payload.text_en : "") || "").trim();
  const sentenceZh = String(cue.textZh || payload.source_sentence_zh || (payload.type === "sentence" ? payload.meaning_zh || payload.text_zh : "") || "").trim();
  const subtitleId = payload.source_subtitle_id || cue.id || null;
  const hasSource = sentenceEn || payload.source_movie_id || payload.source_episode_id || subtitleId;
  if (!hasSource) return null;
  const timestampText = Number.isFinite(cue.start)
    ? fromSecPrecise(cue.start)
    : String(payload.source_timestamp_text || payload.timestamp || "").trim();
  const parsedTime = Number(cue.start ?? payload.source_time_start ?? payload.source_timestamp_seconds);
  const parsedTimecode = toSec(cue.start ?? payload.source_time_start ?? payload.source_timestamp_seconds);
  const textTimecode = toSec(timestampText);
  const timestampSeconds = Number.isFinite(parsedTime) ? parsedTime : Number.isFinite(parsedTimecode) ? parsedTimecode : textTimecode;
  const parsedEnd = Number(cue.end ?? payload.source_time_end ?? payload.source_timestamp_end_seconds);
  const parsedEndTimecode = toSec(cue.end ?? payload.source_time_end ?? payload.source_timestamp_end_seconds);
  const timestampEndSeconds = Number.isFinite(parsedEnd) ? parsedEnd : Number.isFinite(parsedEndTimecode) ? parsedEndTimecode : null;
  const sourceType = payload.source_type || (payload.source_episode_id ? "episode" : "local");
  const sourceUrl = payload.source_url || null;
  let sourceVideoId = payload.source_video_id || null;
  if (!sourceVideoId && sourceUrl) {
    try {
      const url = new URL(sourceUrl);
      sourceVideoId = url.hostname.endsWith("youtu.be") ? url.pathname.slice(1).split("/")[0] : url.searchParams.get("v");
    } catch { /* a non-URL local source is valid */ }
  }
  const sourceRecordId = payload.source_record_id || payload.source_movie_id || null;
  const stableKey = [sourceType, sourceRecordId, payload.source_episode_id, subtitleId, Number.isFinite(timestampSeconds) ? timestampSeconds : timestampText, sentenceEn].join("|");
  return {
    id: newId(),
    source_key: stableKey,
    source_sentence_en: sentenceEn,
    source_sentence_zh: sentenceZh,
    context_meaning: payload.context_meaning || payload.contextMeaning || null,
    source_movie_id: payload.source_movie_id || null,
    source_record_id: sourceRecordId,
    source_url: sourceUrl,
    source_video_id: sourceVideoId,
    source_movie_title: payload.source_movie_title || null,
    source_episode_id: payload.source_episode_id || null,
    source_episode_title: payload.source_episode_title || null,
    source_subtitle_id: subtitleId,
    source_time_start: Number.isFinite(timestampSeconds) ? timestampSeconds : null,
    source_time_end: timestampEndSeconds,
    source_timestamp_seconds: Number.isFinite(timestampSeconds) ? timestampSeconds : null,
    source_timestamp_end_seconds: timestampEndSeconds,
    source_timestamp_text: timestampText,
    source_type: sourceType,
    subtitle_snapshot: {
      text_en: sentenceEn,
      text_zh: sentenceZh,
      subtitle_id: subtitleId,
      cue_id: subtitleId,
      time_start: Number.isFinite(timestampSeconds) ? timestampSeconds : null,
      time_end: timestampEndSeconds,
      timestamp_text: timestampText,
      timestamp_seconds: Number.isFinite(timestampSeconds) ? timestampSeconds : null,
      timestamp_end_seconds: timestampEndSeconds,
    },
    saved_at: new Date().toISOString(),
  };
}

function mergeSources(current = [], incoming) {
  const sources = Array.isArray(current) ? [...current] : [];
  if (!incoming) return sources;
  if (sources.some((source) => source.source_key === incoming.source_key)) return sources;
  sources.push(incoming);
  return sources;
}

async function mirrorSourceToCloud(vocabularyId, source) {
  if (!supabase || !source || source.id.startsWith("local-")) return;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return;
    const { error } = await supabase.from("vocabulary_sources").upsert({ ...source, vocabulary_id: vocabularyId, user_id: user.id }, {
      onConflict: "user_id,vocabulary_id,source_key",
    });
    if (error) console.warn("Vocabulary source cloud write is not available", error.code || error.message);
  } catch (error) {
    console.warn("Vocabulary source cloud write is not available", error?.code || error?.name || "network error");
  }
}

export async function saveVocabularyEntry(payload) {
  const expression = String(payload.expression_en || payload.text_en || "").trim();
  if (!expression) throw new Error("收藏内容不能为空");
  const source = buildVocabularySource({ ...payload, expression_en: expression });
  const key = normalizedExpression(expression);
  const existing = (await vocabRepository.list()).find((item) => normalizedExpression(item.expression_en || item.text_en) === key);
  let entry;
  if (existing) {
    const sources = mergeSources(existing.sources, source);
    const fields = { sources, last_saved_at: new Date().toISOString() };
    if (!existing.profile && payload.profile) fields.profile = payload.profile;
    if (!(existing.meaning_zh || existing.text_zh) && (payload.meaning_zh || payload.text_zh)) {
      fields.meaning_zh = payload.meaning_zh || payload.text_zh;
      fields.text_zh = payload.meaning_zh || payload.text_zh;
    }
    entry = await vocabRepository.updateWord(existing.id, fields);
  } else {
    const now = new Date().toISOString();
    entry = await vocabRepository.createWord({
      ...payload,
      expression_en: expression,
      text_en: payload.text_en || expression,
      sources: source ? [source] : [],
      review_status: "new",
      mastery_level: "new",
      status: "new",
      review_count: 0,
      reviewCount: 0,
      correct_count: 0,
      correctCount: 0,
      error_count: 0,
      wrongCount: 0,
      interval_days: 0,
      intervalDays: 0,
      next_review_date: now,
      nextReviewAt: now,
    });
  }
  if (source) void mirrorSourceToCloud(entry.id, source);
  return { entry, addedSource: Boolean(source && entry.sources?.some((item) => item.source_key === source.source_key)) };
}
