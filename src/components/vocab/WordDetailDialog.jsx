import React, { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Volume2, BookmarkPlus, ChevronDown } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useNavigate } from "react-router-dom";
import { vocabRepository } from "@/lib/vocabRepository";
import { saveVocabularyEntry } from "@/lib/vocabularySources";
import { invokeAI } from "@/lib/localApi";
import { safeAIErrorMessage } from "@/lib/aiSettings";
import { AISettingsButton } from "@/components/AISettingsPanel";
import { openVocabularySource } from "@/lib/vocabularySourceNavigation";
import SourcePreview from "@/components/vocab/SourcePreview";
import { localMovies } from "@/lib/localStudyMeta";
import { resolveVocabularySourceCue } from "@/lib/vocabularySourceCue";
import { inferExpressionType, isCurrentWordProfile, normalizeWordProfile, summarizeWordProfileShape, WORD_PROFILE_SCHEMA_VERSION } from "@/lib/wordProfile";

function isDetailed(profile) {
  return isCurrentWordProfile(profile);
}

function sourcesFor(vocabulary) {
  if (Array.isArray(vocabulary?.sources) && vocabulary.sources.length) return vocabulary.sources;
  if (vocabulary?.source_sentence_en || vocabulary?.source_movie_id || vocabulary?.source_subtitle_id) {
    return [{
      source_sentence_en: vocabulary.source_sentence_en || "",
      source_sentence_zh: vocabulary.source_sentence_zh || "",
      source_movie_id: vocabulary.source_movie_id,
      source_record_id: vocabulary.source_record_id || vocabulary.source_movie_id,
      source_url: vocabulary.source_url,
      source_video_id: vocabulary.source_video_id,
      source_movie_title: vocabulary.source_movie_title,
      source_episode_id: vocabulary.source_episode_id,
      source_episode_title: vocabulary.source_episode_title,
      source_subtitle_id: vocabulary.source_subtitle_id,
      source_time_start: vocabulary.source_time_start,
      source_time_end: vocabulary.source_time_end,
      source_timestamp_seconds: vocabulary.source_timestamp_seconds,
      source_timestamp_end_seconds: vocabulary.source_timestamp_end_seconds,
      source_timestamp_text: vocabulary.source_timestamp_text || vocabulary.timestamp,
      source_type: vocabulary.source_type || "local",
      subtitle_snapshot: vocabulary.subtitle_snapshot,
    }];
  }
  return [];
}

function meaningRows(profile, vocabulary, legacyProfile = {}) {
  const senses = Array.isArray(profile?.senses) && profile.senses.length
    ? profile.senses
    : Array.isArray(legacyProfile?.senses) ? legacyProfile.senses : [];
  const senseProfile = senses === profile?.senses ? profile : legacyProfile;
  const rows = senses.flatMap((sense) => {
    if (typeof sense === "string") return [{ pos: senseProfile?.pos || senseProfile?.part_of_speech || "", meanings: [sense] }];
    if (!sense || typeof sense !== "object") return [];
    const meanings = Array.isArray(sense.meanings) ? sense.meanings : [sense.meaning].filter(Boolean);
    return meanings.length ? [{ pos: sense.pos || senseProfile?.pos || senseProfile?.part_of_speech || "", meanings }] : [];
  });
  if (rows.length) return rows;
  const fallbackProfile = Object.keys(profile || {}).length ? profile : legacyProfile;
  const legacyMeanings = Array.isArray(fallbackProfile?.senses)
    ? fallbackProfile.senses.flatMap((sense) => typeof sense === "string" ? [sense] : Array.isArray(sense?.meanings) ? sense.meanings : [sense?.meaning].filter(Boolean))
    : Array.isArray(fallbackProfile?.core_meanings) ? fallbackProfile.core_meanings : [];
  const meanings = legacyMeanings.map((item) => typeof item === "string" ? item : item?.meaning).filter(Boolean);
  if (!meanings.length) meanings.push(fallbackProfile?.meaning || vocabulary?.meaning_zh || vocabulary?.text_zh || vocabulary?.meaning || "");
  const expression = vocabulary?.expression_en || vocabulary?.text_en || "";
  const inferredType = inferExpressionType(expression);
  const fallbackPos = inferredType === "sentence" ? "sent." : inferredType === "phrase" ? "phr." : "";
  const legacyPos = fallbackProfile?.pos || fallbackProfile?.part_of_speech || vocabulary?.pos || vocabulary?.part_of_speech || fallbackPos;
  return meanings.filter(Boolean).length ? [{ pos: legacyPos, meanings: meanings.filter(Boolean) }] : [];
}

function speakExpression(expression, accent = "en-US") {
  try {
    if (!window.speechSynthesis || !expression) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(expression);
    utterance.lang = accent;
    const voices = window.speechSynthesis.getVoices?.() || [];
    const voice = voices.find((item) => item.lang?.toLowerCase().startsWith(accent.toLowerCase()));
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  } catch { /* browser speech is optional */ }
}

export function WordDetailBody({ vocabulary, onReturnToSource }) {
  const expression = vocabulary?.expression_en || vocabulary?.text_en || "";
  const initialProfile = vocabulary?.profile || {};
  const [profile, setProfile] = useState(initialProfile);
  const [profileStatus, setProfileStatus] = useState(isDetailed(initialProfile) ? "success" : "idle");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [activeSourceIndex, setActiveSourceIndex] = useState(-1);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [otherSourcesOpen, setOtherSourcesOpen] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const requestedExpression = useRef("");
  const profileRequestCount = useRef(0);
  const profileStateStartedAt = useRef(0);
  const baseSources = useMemo(() => sourcesFor(vocabulary), [vocabulary]);
  const [resolvedSources, setResolvedSources] = useState(baseSources);
  const sources = resolvedSources;
  const effectiveSourceIndex = activeSourceIndex >= 0 ? activeSourceIndex : Math.max(0, sources.length - 1);
  const primarySource = sources[effectiveSourceIndex];
  const recentLogs = [...(vocabulary?.recentReviewLogs || [])].sort((a, b) => Date.parse(b.reviewed_at || 0) - Date.parse(a.reviewed_at || 0)).slice(0, 10);

  useEffect(() => {
    setProfile(vocabulary?.profile || {});
    setSaved(false);
    setError("");
    setProfileStatus(isDetailed(vocabulary?.profile || {}) ? "success" : "idle");
    setActiveSourceIndex(-1);
    setPreviewOpen(false);
    setOtherSourcesOpen(false);
    requestedExpression.current = "";
    profileRequestCount.current = 0;
    profileStateStartedAt.current = 0;
  }, [vocabulary?.id, expression]);

  useEffect(() => {
    if (profileStatus !== "success" || !profileStateStartedAt.current || !import.meta.env.DEV) return;
    const stateCommitMs = Math.round(performance.now() - profileStateStartedAt.current);
    window.__LINGOCLUB_WORD_PROFILE_DIAGNOSTICS__ = { ...window.__LINGOCLUB_WORD_PROFILE_DIAGNOSTICS__, stateCommitMs };
    profileStateStartedAt.current = 0;
  }, [profileStatus, profile]);

  useEffect(() => {
    let cancelled = false;
    setResolvedSources(baseSources);
    if (!baseSources.length) return undefined;
    (async () => {
      let changed = false;
      const hydrated = await Promise.all(baseSources.map(async (source) => {
        const recordId = source.source_record_id || source.source_movie_id || source.source_episode_id;
        if (!recordId) return source;
        try {
          const movie = await localMovies.get(recordId);
          const cue = resolveVocabularySourceCue(source, Array.isArray(movie?.subtitles) ? movie.subtitles : []);
          if (!cue.id && !Number.isFinite(cue.start)) return source;
          const next = {
            ...source,
            source_subtitle_id: source.source_subtitle_id || cue.id,
            source_time_start: Number.isFinite(cue.start) ? cue.start : source.source_time_start,
            source_time_end: Number.isFinite(cue.end) ? cue.end : source.source_time_end,
            source_timestamp_seconds: Number.isFinite(cue.start) ? cue.start : source.source_timestamp_seconds,
            source_timestamp_end_seconds: Number.isFinite(cue.end) ? cue.end : source.source_timestamp_end_seconds,
            source_sentence_en: source.source_sentence_en || cue.textEn,
            source_sentence_zh: source.source_sentence_zh || cue.textZh,
            source_movie_title: source.source_movie_title || movie?.name || null,
          };
          if (JSON.stringify(next) !== JSON.stringify(source)) changed = true;
          return next;
        } catch { return source; }
      }));
      if (cancelled) return;
      setResolvedSources(hydrated);
      if (changed && vocabulary?.id) {
        try { await vocabRepository.updateWord(vocabulary.id, { sources: hydrated }); } catch { /* lazy source enrichment must not block explanation */ }
      }
    })();
    return () => { cancelled = true; };
  }, [baseSources, vocabulary?.id]);

  useEffect(() => {
    if (!expression || isDetailed(profile)) { if (isDetailed(profile)) setProfileStatus("success"); return undefined; }
    const requestKey = `${expression}|${primarySource?.source_subtitle_id || primarySource?.source_time_start || ""}|${primarySource?.source_sentence_en || ""}|${primarySource?.source_sentence_zh || ""}|${retryVersion}`;
    if (requestedExpression.current === requestKey) return undefined;
    requestedExpression.current = requestKey;
    let cancelled = false;
    const sourceCacheKey = [primarySource?.source_subtitle_id, primarySource?.source_time_start, primarySource?.source_sentence_en, primarySource?.source_sentence_zh].filter(Boolean).join("|");
    profileRequestCount.current += 1;
    setProfileStatus("loading");
    setError("");
    invokeAI("vocabulary_analysis", {
      expression_en: expression,
      meaning_zh: vocabulary?.meaning_zh || vocabulary?.text_zh || "",
      source_sentence_en: primarySource?.source_sentence_en || "",
      source_sentence_zh: primarySource?.source_sentence_zh || "",
      expression_type: inferExpressionType(expression),
      cache_key: `${vocabulary?.id || expression}|${sourceCacheKey || "no-source"}`,
      context: [primarySource?.source_movie_title, primarySource?.source_episode_title].filter(Boolean).join(" · ") || "film & TV",
    }, {
      timeoutMs: 11_000,
      bypassCache: retryVersion > 0,
      cacheVersion: WORD_PROFILE_SCHEMA_VERSION,
      onDiagnostics: (diagnostics) => {
        if (!import.meta.env.DEV) return;
        window.__LINGOCLUB_WORD_PROFILE_DIAGNOSTICS__ = { ...diagnostics, requestCount: profileRequestCount.current };
        console.info("[WordDetail] AI request", window.__LINGOCLUB_WORD_PROFILE_DIAGNOSTICS__);
      },
    }).then(async (result) => {
      const rawProfile = result?.profile || result?.data?.profile;
      if (!rawProfile || typeof rawProfile !== "object") throw new Error("词条资料为空");
      const normalizationStartedAt = performance.now();
      const next = normalizeWordProfile(rawProfile, expression);
      const normalizationDurationMs = Math.round(performance.now() - normalizationStartedAt);
      if (import.meta.env.DEV) {
        const shape = summarizeWordProfileShape(rawProfile);
        window.__LINGOCLUB_WORD_PROFILE_SHAPE__ = { expression, ...shape };
        window.__LINGOCLUB_WORD_PROFILE_DIAGNOSTICS__ = { ...window.__LINGOCLUB_WORD_PROFILE_DIAGNOSTICS__, normalizationDurationMs };
        console.info("[WordDetail] AI profile shape", { expression, ...shape, normalizationDurationMs });
      }
      if (cancelled) return;
      profileStateStartedAt.current = performance.now();
      setProfile(next);
      setProfileStatus("success");
      if (vocabulary?.id) { try { await vocabRepository.updateWord(vocabulary.id, { profile: next }); } catch { /* detached detail previews are not persisted */ } }
    }).catch((reason) => {
      if (!cancelled) {
        const message = reason?.name === "AbortError" || reason?.name === "TimeoutError" ? "请求超时" : safeAIErrorMessage(reason);
        if (import.meta.env.DEV) {
          window.__LINGOCLUB_WORD_PROFILE_DIAGNOSTICS__ = { ...window.__LINGOCLUB_WORD_PROFILE_DIAGNOSTICS__, status: "error", message };
        }
        setProfileStatus("error");
        setError(message);
      }
    }).finally(() => {
      if (!cancelled) setProfileStatus((status) => status === "loading" ? "error" : status);
    });
    return () => { cancelled = true; if (requestedExpression.current === requestKey) requestedExpression.current = ""; };
  }, [expression, primarySource?.source_sentence_en, primarySource?.source_sentence_zh, primarySource?.source_movie_title, primarySource?.source_episode_title, primarySource?.source_subtitle_id, primarySource?.source_time_start, profile, retryVersion, vocabulary?.id, vocabulary?.meaning_zh, vocabulary?.text_zh]);

  const save = async () => {
    await saveVocabularyEntry({
      ...vocabulary,
      expression_en: expression,
      meaning_zh: vocabulary?.meaning_zh || vocabulary?.text_zh || profile.meaning || "",
      profile,
      ...(primarySource || {}),
    });
    setSaved(true);
  };

  const displayProfile = isDetailed(profile) ? profile : {};
  const expressionType = displayProfile.expression_type || inferExpressionType(expression);
  const isPhrase = expressionType === "phrase";
  const isSentence = expressionType === "sentence";
  const legacyProfile = vocabulary?.profile || {};
  const pronunciationProfile = displayProfile.phonetic_us || displayProfile.phonetic_uk ? displayProfile : legacyProfile;
  const reliableRoots = expressionType === "word" && legacyProfile.root_analysis_reliable !== false
    ? (displayProfile.roots || (legacyProfile.root_analysis_reliable === true ? legacyProfile.roots || legacyProfile.root_analysis || [] : []))
    : [];
  const meanings = meaningRows(displayProfile, vocabulary, legacyProfile);

  return (
    <div className="mx-auto w-full max-w-[860px] space-y-4 sm:space-y-5">
      <div className="flex min-w-0 items-start justify-between gap-3 border-b border-border/60 pb-3 pr-7">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <h2 className="min-w-0 break-words font-display text-[30px] font-bold leading-tight text-foreground sm:text-[36px]">{expression}</h2>
          <button type="button" onClick={() => speakExpression(expression)} aria-label="发音" title="发音" className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/60 hover:text-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint"><Volume2 size={17} /></button>
        </div>
        <button type="button" onClick={save} disabled={saved} aria-label={saved ? "已收藏" : "收藏词条"} className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-copper/50 hover:text-copper disabled:opacity-60">
          <BookmarkPlus size={13} /> {saved ? "已收藏" : "收藏"}
        </button>
      </div>

      {expressionType === "word" && <div className="flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {pronunciationProfile.phonetic_us ? <button type="button" onClick={() => speakExpression(expression, "en-US")} aria-label="播放美音" className="hover:text-foreground">美 <span className="font-mono">{pronunciationProfile.phonetic_us}</span></button> : null}
        {pronunciationProfile.phonetic_uk ? <button type="button" onClick={() => speakExpression(expression, "en-GB")} aria-label="播放英音" className="hover:text-foreground">英 <span className="font-mono">{pronunciationProfile.phonetic_uk}</span></button> : null}
        {!pronunciationProfile.phonetic_us && !pronunciationProfile.phonetic_uk && profileStatus === "loading" && <span role="status" aria-label="正在加载音标">···</span>}
      </div>}

      {(meanings.length > 0 || profileStatus === "loading") && <section className="space-y-1.5">
        {meanings.map((row, index) => <p key={`${row.pos}-${index}`} className="text-[15px] leading-relaxed text-foreground sm:text-base"><span className="mr-2 inline-block min-w-8 align-baseline text-[11px] font-medium text-copper/80">{row.pos || (isSentence ? "sent." : isPhrase ? "phr." : "")}</span>{row.meanings.join("；")}</p>)}
        {!meanings.length && profileStatus === "loading" && <p role="status" className="text-sm text-muted-foreground"><span className="mr-2 text-[11px] text-copper/70">{isSentence ? "sent." : isPhrase ? "phr." : "词性释义"}</span>···</p>}
      </section>}

      {reliableRoots.length > 0 && <section className="border-t border-border/50 pt-3"><div className="flex flex-wrap gap-x-4 gap-y-2">{reliableRoots.map((part, index) => <div key={`${part.part || part.type}-${index}`} className="min-w-[72px]"><p className="font-medium text-foreground">{part.part}</p><p className="text-xs text-muted-foreground">{part.type} · {part.meaning}</p></div>)}</div>{displayProfile.synthesis && <p className="mt-1.5 text-sm text-muted-foreground">{displayProfile.synthesis}</p>}</section>}
      {primarySource && <section className="rounded-xl border border-border/70 bg-background/45 p-3 sm:p-4">
        <SectionTitle>原句</SectionTitle>
        <p className="text-xs text-muted-foreground">{primarySource.source_movie_title || "来源影片"}{primarySource.source_episode_title ? ` · ${primarySource.source_episode_title}` : ""}{primarySource.source_timestamp_text ? ` · ${primarySource.source_timestamp_text}` : ""}</p>
        <p className="mt-2 text-sm leading-relaxed text-foreground">{primarySource.source_sentence_en || expression}</p>
        {primarySource.source_sentence_zh && <p className="mt-0.5 text-sm text-muted-foreground">{primarySource.source_sentence_zh}</p>}
        <button type="button" onClick={() => setPreviewOpen((value) => !value)} className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-copper/30 px-3 py-1.5 text-xs text-copper hover:bg-copper/10"><Volume2 size={13} />{previewOpen ? "关闭预览" : "播放原句"}</button>
        {previewOpen && <SourcePreview source={primarySource} onClose={() => setPreviewOpen(false)} onOpenOriginal={onReturnToSource} />}
        {sources.length > 1 && <div className="mt-3">
          <button type="button" aria-expanded={otherSourcesOpen} onClick={() => setOtherSourcesOpen((value) => !value)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">其他语境 {sources.length - 1} <ChevronDown size={13} className={otherSourcesOpen ? "rotate-180" : ""} /></button>
          {otherSourcesOpen && <ul className="mt-2 space-y-1.5">{sources.map((source, index) => <li key={source.source_key || source.id || index}><button type="button" onClick={() => { setActiveSourceIndex(index); setPreviewOpen(false); }} className={`w-full rounded-lg border px-2.5 py-2 text-left ${effectiveSourceIndex === index ? "border-copper/40 bg-copper/5" : "border-border/60"}`}><span className="block truncate text-xs text-foreground">{source.source_movie_title || "来源影片"}{source.source_episode_title ? ` · ${source.source_episode_title}` : ""}</span><span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{source.source_sentence_en || expression} {source.source_timestamp_text ? ` · ${source.source_timestamp_text}` : ""}</span></button></li>)}</ul>}
        </div>}
      </section>}
      {profileStatus === "error" && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-200"><span>{error || "详细词条补全失败"}</span><button type="button" onClick={() => { requestedExpression.current = ""; setRetryVersion((value) => value + 1); }} className="underline">重新补全</button><AISettingsButton className="text-copper underline">API 设置</AISettingsButton></div>}
    </div>
  );
}

function RelatedList({ label, items }) {
  return <div><p className="mb-1 text-xs text-muted-foreground">{label}</p><ul className="space-y-1 text-sm">{items.map((item, index) => <li key={`${item.word || item.expression || item}-${index}`}><span className="font-medium">{typeof item === "string" ? item : item.word || item.expression}</span>{typeof item === "object" && (item.meaning || item.note) && <span className="ml-2 text-xs text-muted-foreground">{item.meaning || item.note}</span>}</li>)}</ul></div>;
}

function SectionTitle({ children }) {
  return <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] uppercase tracking-luxe text-copper/80"><BookOpen size={12} />{children}</h3>;
}

export default function WordDetailDialog({ vocabulary, open, onOpenChange, onReturnToSource, returnContext = "collection", footerLabel = "关闭" }) {
  const navigate = useNavigate();
  const returnToSource = (source) => {
    if (onReturnToSource) return onReturnToSource(source);
    return openVocabularySource(source, navigate, undefined, { returnContext });
  };
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-border bg-background p-0 pt-[env(safe-area-inset-top)] text-foreground sm:h-auto sm:max-h-[90dvh] sm:w-[calc(100%-2rem)] sm:max-w-3xl sm:rounded-xl sm:p-6">
      <DialogHeader className="sr-only"><DialogTitle>单词详情</DialogTitle><DialogDescription>词义、语境、例句和原片来源</DialogDescription></DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-5 pt-12 sm:px-1 sm:pt-2">{vocabulary && <WordDetailBody vocabulary={vocabulary} onReturnToSource={returnToSource} />}</div>
      <footer className="border-t border-border/70 bg-background/95 px-4 pt-3 backdrop-blur sm:rounded-b-xl" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}><button type="button" onClick={() => onOpenChange?.(false)} className="w-full rounded-full border border-border px-4 py-3 text-sm text-foreground sm:ml-auto sm:w-auto">{footerLabel}</button></footer>
    </DialogContent>
  </Dialog>;
}

export function WordDetailOverlay({ vocabulary, onContinue, onBeforeOpenOriginal, returnContext = "review" }) {
  const navigate = useNavigate();
  const onOpenOriginal = (source) => {
    onBeforeOpenOriginal?.(source);
    return openVocabularySource(source, navigate, undefined, { returnContext });
  };
  return <div className="fixed inset-0 z-[100] flex h-[100dvh] w-screen flex-col bg-background text-foreground" role="dialog" aria-modal="true" aria-label="单词详情">
    <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-[calc(env(safe-area-inset-top)+1rem)] sm:px-6">
      <div className="mx-auto max-w-2xl space-y-5 pb-8"><WordDetailBody vocabulary={vocabulary} onReturnToSource={onOpenOriginal} /></div>
    </main>
    <footer className="sticky bottom-0 border-t border-border/70 bg-background/95 px-4 pt-3 backdrop-blur sm:px-6" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}><div className="mx-auto max-w-2xl"><button type="button" onClick={onContinue} className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-mint px-5 py-3.5 text-sm font-semibold text-background">继续复习 <span aria-hidden="true">→</span></button></div></footer>
  </div>;
}
