import React, { useState } from "react";
import { saveVocabularyEntry } from "@/lib/vocabularySources";
import { normalizeSourceCue } from "@/lib/vocabularySourceCue";
import { Bookmark, BookmarkCheck, Loader2 } from "lucide-react";

// 收藏一个表达（单词 / 短语 / 整句）。
// 单用户本地模式：收藏写入浏览器 localStorage。
export default function VocabSaveButton({ expression, meaning, tag, type = "phrase", movieId, movieTitle, sceneId, subtitleId, timestamp, timestampSeconds, timestampEnd, sourceSentenceEn, sourceSentenceZh, sourceCue, episodeId, episodeTitle, sourceType, sourceUrl, sourceRecordId, className = "", onSaved }) {
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const cue = normalizeSourceCue(sourceCue || { id: subtitleId, start: timestampSeconds ?? timestamp, end: timestampEnd, textEn: sourceSentenceEn, textZh: sourceSentenceZh });
      const tagVal = tag || (type === "word" ? "生词" : type === "sentence" ? "整句" : "短语");
      const payload = {
        text_en: expression,
        text_zh: meaning || "",
        expression_en: expression,
        meaning_zh: meaning || "",
        type,
        tag: tagVal,
        tags: [tagVal],
        source_movie_id: movieId,
        source_record_id: sourceRecordId || movieId,
        source_url: sourceUrl || "",
        source_video_id: videoIdFromUrl(sourceUrl),
        source_movie_title: movieTitle,
        source_scene_id: sceneId,
        source_subtitle_id: cue.id || subtitleId,
        source_episode_id: episodeId,
        source_episode_title: episodeTitle,
        source_sentence_en: cue.textEn || sourceSentenceEn || (type === "sentence" ? expression : ""),
        source_sentence_zh: cue.textZh || sourceSentenceZh || (type === "sentence" ? meaning : ""),
        source_time_start: cue.start,
        source_time_end: cue.end,
        source_timestamp_seconds: cue.start,
        source_timestamp_end_seconds: cue.end,
        source_type: sourceType,
        source_timestamp_text: timestamp || "",
        timestamp: cue.start ?? timestamp ?? "",
        review_status: "new",
        mastery_level: "new",
        review_count: 0,
        correct_count: 0,
        ease_factor: 2.5,
        interval_days: 0,
      };
      await saveVocabularyEntry(payload);
      setSaved(true);
      onSaved?.();
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <button type="button" className={`inline-flex items-center gap-1 rounded-full border border-copper/40 bg-copper/10 px-2 py-0.5 text-[11px] text-copper ${className}`}>
        <BookmarkCheck size={12} /> 已收藏
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={save}
      disabled={saving}
      className={`inline-flex items-center gap-1 rounded-full border border-border bg-background-elev/60 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-copper/40 hover:text-copper disabled:opacity-50 ${className}`}
    >
      {saving ? <Loader2 size={12} className="animate-spin" /> : <Bookmark size={12} />} 收藏
    </button>
  );
}

function videoIdFromUrl(value) {
  try {
    const url = new URL(value);
    if (url.hostname.endsWith("youtu.be")) return url.pathname.slice(1).split("/")[0];
    return url.searchParams.get("v") || "";
  } catch { return ""; }
}
