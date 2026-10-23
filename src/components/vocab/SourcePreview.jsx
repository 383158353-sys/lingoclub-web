import React, { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Loader2, Play, X } from "lucide-react";
import VideoPlayer from "@/components/study/VideoPlayer";
import { localMovies } from "@/lib/localStudyMeta";
import { clearLocalVideoSource, clearTemporaryLocalVideoFile, getLocalVideoSource, saveLocalVideoHandle, setTemporaryLocalVideoFile } from "@/lib/localStudyLibrary";
import { displayLinesFromTimedCues } from "@/lib/captionDisplayCues";
import { narrowLoopToSentence, selectSentenceCue } from "@/lib/sourceSentenceFocus";
import { getStudyCueLoopRange } from "@/lib/studyCueNavigation";
import { matchYouTubeSourceMovie, normalizeSourceCue, resolveVocabularySourceCue, youtubePlaybackUrl } from "@/lib/vocabularySourceCue";
import { shouldRestartCueLoop } from "@/lib/youtubePlayerConfig";

export default function SourcePreview({ source, expression = "", onClose, onOpenOriginal }) {
  const [resolved, setResolved] = useState({ loading: true, movie: null, subtitles: [], url: "", file: null, missing: false, source: null, cue: null });
  const fileInputRef = useRef(null);
  const playerRef = useRef(null);
  const recordId = source?.source_record_id || source?.source_movie_id || source?.source_episode_id || "";

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    (async () => {
      let movie = null;
      let subtitles = [];
      let url = "";
      let file = null;
      let missing = false;
      let resolvedSource = { ...source };
      if (recordId) {
        try {
          movie = await localMovies.get(recordId);
          subtitles = displayLinesFromTimedCues(Array.isArray(movie?.subtitles) ? movie.subtitles : []);
          const cue = resolveVocabularySourceCue(source, subtitles);
          const savedSentence = String(source?.source_sentence_en || "").trim();
          const cueSentence = String(cue.textEn || "").trim();
          const sentence = cueSentence && savedSentence && cueSentence !== savedSentence && cueSentence.includes(savedSentence) ? cueSentence : (savedSentence || cueSentence);
          resolvedSource = {
            ...source,
            source_subtitle_id: source?.source_subtitle_id || cue.id,
            source_time_start: cue.start,
            source_time_end: cue.end,
            source_timestamp_seconds: cue.start,
            source_timestamp_end_seconds: cue.end,
            source_sentence_en: sentence,
            source_sentence_zh: source?.source_sentence_zh || cue.textZh,
          };
        } catch { missing = true; }
      }
      if (!Number.isFinite(Number(resolvedSource.source_time_start))) {
        const cue = resolveVocabularySourceCue(source, subtitles);
        resolvedSource = { ...resolvedSource, source_subtitle_id: resolvedSource.source_subtitle_id || cue.id, source_time_start: cue.start, source_time_end: cue.end, source_timestamp_seconds: cue.start, source_timestamp_end_seconds: cue.end, source_sentence_en: resolvedSource.source_sentence_en || cue.textEn, source_sentence_zh: resolvedSource.source_sentence_zh || cue.textZh };
      }
      url = youtubePlaybackUrl(movie?.video_url, movie?.youtube_video_id, source?.source_url, source?.source_video_id);
      const linkedLocal = Boolean(movie) && !youtubePlaybackUrl(movie?.video_url, movie?.youtube_video_id);
      if (!url && !linkedLocal) {
        try {
          const match = matchYouTubeSourceMovie(await localMovies.list(), resolvedSource);
          if (match?.url) {
            url = match.url;
            movie = movie || match.movie;
            if (!subtitles.length) subtitles = displayLinesFromTimedCues(Array.isArray(match.movie?.subtitles) ? match.movie.subtitles : []);
            resolvedSource = {
              ...resolvedSource,
              source_url: resolvedSource.source_url || match.url,
              source_video_id: resolvedSource.source_video_id || new URL(match.url).searchParams.get("v") || "",
              source_movie_title: resolvedSource.source_movie_title || match.movie?.name || "",
              source_record_id: resolvedSource.source_record_id || match.movie?.id || "",
              source_type: resolvedSource.source_type === "episode" ? resolvedSource.source_type : "youtube",
            };
          }
        } catch { /* a library miss still leaves the local-file picker for real local movies */ }
      }
      if (!url && recordId) {
        try {
          const local = await getLocalVideoSource(recordId);
          file = local.file || null;
          missing = !file;
          if (file) { objectUrl = URL.createObjectURL(file); url = objectUrl; }
        } catch { missing = true; }
      }
      const sentenceCue = selectSentenceCue(source, subtitles, expression);
      const resolvedCue = sentenceCue ? normalizeSourceCue(sentenceCue) : resolveVocabularySourceCue(resolvedSource, subtitles);
      if (sentenceCue) {
        resolvedSource = {
          ...resolvedSource,
          source_subtitle_id: resolvedCue.id || resolvedSource.source_subtitle_id,
          source_time_start: resolvedCue.start,
          source_time_end: resolvedCue.end,
          source_timestamp_seconds: resolvedCue.start,
          source_timestamp_end_seconds: resolvedCue.end,
        };
      }
      const cue = {
        id: resolvedCue.id,
        time_start: resolvedCue.start,
        time_end: resolvedCue.end,
        text_en: resolvedCue.textEn || resolvedSource.source_sentence_en,
        text_zh: resolvedCue.textZh,
      };
      if (!cancelled) setResolved({ loading: false, movie, subtitles, url, file, missing: missing || !url, source: resolvedSource, cue });
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [expression, recordId, source?.source_type, source?.source_url, source?.source_video_id, source?.source_time_start, source?.source_timestamp_seconds, source?.source_subtitle_id, source?.source_sentence_en]);

  useEffect(() => {
    const currentUrl = resolved.url;
    return () => { if (currentUrl?.startsWith("blob:")) URL.revokeObjectURL(currentUrl); };
  }, [resolved.url]);

  const cue = resolved.cue || (() => {
    const fallback = normalizeSourceCue(source);
    return { id: fallback.id, time_start: fallback.start, time_end: fallback.end, text_en: fallback.textEn, text_zh: fallback.textZh };
  })();
  const loop = useMemo(() => {
    if (!cue) return null;
    return narrowLoopToSentence(getStudyCueLoopRange(cue, resolved.subtitles), cue.text_en || source?.source_sentence_en, expression);
  }, [cue, expression, resolved.subtitles, source?.source_sentence_en]);
  const start = loop?.start ?? (Number.isFinite(Number(cue?.time_start)) ? Number(cue.time_start) : 0);

  const onTimeUpdate = (time) => {
    if (shouldRestartCueLoop(time, loop)) playerRef.current?.play?.(loop.start);
  };

  const chooseVideo = async (file) => {
    let url = "";
    let nextFile = file || null;
    const id = recordId || resolved.movie?.id;
    if (id && window.showOpenFilePicker && !file) {
      try {
        const [handle] = await window.showOpenFilePicker({ multiple: false, types: [{ description: "视频文件", accept: { "video/*": [".mp4", ".webm", ".mov", ".m4v", ".mkv", ".avi"] } }] });
        nextFile = await handle.getFile();
        await saveLocalVideoHandle(id, handle);
        clearTemporaryLocalVideoFile(id);
      } catch (error) { if (error?.name !== "AbortError") fileInputRef.current?.click(); return; }
    } else if (id) {
      await clearLocalVideoSource(id).catch(() => {});
      setTemporaryLocalVideoFile(id, nextFile);
    }
    if (!nextFile) { fileInputRef.current?.click(); return; }
    url = URL.createObjectURL(nextFile);
    setResolved((current) => ({ ...current, url, file: nextFile, missing: false }));
  };

  return (
    <section className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-background/75" aria-label="原句视频预览">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <p className="truncate text-xs text-muted-foreground">{source?.source_movie_title || resolved.movie?.name || "原句"}{source?.source_episode_title ? ` · ${source.source_episode_title}` : ""}{source?.source_timestamp_text ? ` · ${source.source_timestamp_text}` : ""}</p>
        <button type="button" onClick={onClose} aria-label="关闭原句预览" className="rounded-full p-1.5 text-muted-foreground hover:bg-white/5 hover:text-foreground"><X size={15} /></button>
      </div>
      {resolved.loading ? <div className="grid aspect-video place-items-center text-muted-foreground"><Loader2 size={18} className="animate-spin" /></div> : resolved.url ? (
        <div className="px-3">
          <VideoPlayer ref={playerRef} url={resolved.url} autoPlayFrom={start} cueAutoplay onTimeUpdate={onTimeUpdate} className="[&_video]:rounded-lg" />
        </div>
      ) : (
        <div className="mx-3 flex aspect-video flex-col items-center justify-center rounded-lg border border-dashed border-border text-center">
          <p className="text-sm text-muted-foreground">当前设备未找到视频</p>
          <button type="button" onClick={() => window.showOpenFilePicker ? void chooseVideo(null) : fileInputRef.current?.click()} className="mt-2 rounded-full border border-border px-3 py-1.5 text-xs text-foreground">选择本地视频</button>
          <input ref={fileInputRef} type="file" accept="video/*,.mp4,.webm,.mov,.m4v,.mkv,.avi" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void chooseVideo(file); event.target.value = ""; }} />
        </div>
      )}
      <div className="px-3 pb-3 pt-2">
        <p className="text-sm leading-relaxed text-foreground">{cue?.text_en || source?.source_sentence_en || "原句字幕暂不可用"}</p>
        {(cue?.text_zh || source?.source_sentence_zh) && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{cue?.text_zh || source.source_sentence_zh}</p>}
        <div className="mt-2 flex items-center justify-between gap-2">
          {resolved.url ? <p className="text-[10px] text-mint/80">正在循环当前原句</p> : <span />}
          {!/youtu\.?be|youtube\.com/i.test(resolved.url || "") && <button type="button" onClick={() => onOpenOriginal?.(resolved.source || source)} className="inline-flex items-center gap-1.5 rounded-full bg-copper px-3 py-1.5 text-xs font-medium text-copper-foreground"><Play size={12} />打开原片 <ExternalLink size={12} /></button>}
        </div>
      </div>
    </section>
  );
}
