import { useState, useEffect, useRef, useCallback } from "react";
import { invokeAI } from "@/lib/localApi";
import { getCueContext, getSubtitleProcessingCache, processSubtitleEpisode, processSubtitleLearningWindow, recordSubtitleAICall, subtitleHash, CLOSE_READING_VERSION } from "@/lib/subtitleAiProcessing";
import { useToast } from "@/components/ui/use-toast";
import { toSec, fromSecPrecise } from "@/lib/timecode";
import { mergeCompleteAnalysis, partialAnalysisForCue } from "@/lib/studyLearningCache";

// 本地学习素材专用 study hook —— 与 useEpisodeStudy 同形，但台词来自浏览器
// 解析（不读数据库），AI 精读结果只缓存在内存里（不写 Subtitle 实体）。
// 这样视频与字幕全程留在用户本机，平台不存储任何视频/字幕文件。

// 确保每条字幕都有 id（书签/API 提取的字幕可能没有 id 字段）
function ensureIds(list) {
  return list.map((s, i) => (s.id ? s : { ...s, id: `auto-${i}` }));
}

function mergeSubtitleProgress(current, incoming) {
  const currentById = new Map((current || []).map((cue) => [cue.id, cue]));
  return (incoming || []).map((cue) => {
    const previous = currentById.get(cue.id);
    if (!previous) return cue;
    return {
      ...previous,
      ...cue,
      // Imported/user-provided Chinese always wins; async progress can only fill an empty value.
      text_zh: String(previous.text_zh || "").trim() ? previous.text_zh : (cue.text_zh || ""),
      ai_processing: { ...(previous.ai_processing || {}), ...(cue.ai_processing || {}) },
    };
  });
}

function hasPreprocessedCueContent(cue) {
  const processing = cue?.ai_processing || {};
  return Boolean(
    cue?.ai_analysis?.translation
    || processing.translation
    || processing.difficultWords?.length
    || processing.phrases?.length
  );
}

// 时间戳归一化：确保每一行都有 time_start，且严格递增。
// 修复旧数据（导入时未经过 mergeFragments 的字幕可能有空 time_start
// 或重复时间戳，导致播放高亮跳行）。
function normalizeTimestamps(list) {
  if (!Array.isArray(list) || list.length === 0) return list;
  const subs = list.map((s) => ({ ...s }));

  // 1) 补全缺失的 time_end：用下一行的 time_start 填充
  for (let i = 0; i < subs.length; i++) {
    if (!Number.isNaN(toSec(subs[i].time_end))) continue;
    for (let j = i + 1; j < subs.length; j++) {
      const nextStart = toSec(subs[j].time_start);
      if (!Number.isNaN(nextStart)) {
        subs[i].time_end = fromSecPrecise(nextStart);
        break;
      }
    }
  }

  // 2) 补全缺失的 time_start：用前后邻居插值
  for (let i = 0; i < subs.length; i++) {
    if (!Number.isNaN(toSec(subs[i].time_start))) continue;
    let prevTs = null;
    for (let j = i - 1; j >= 0; j--) {
      const ts = toSec(subs[j].time_start);
      if (!Number.isNaN(ts)) { prevTs = ts; break; }
    }
    let nextTs = null;
    for (let j = i + 1; j < subs.length; j++) {
      const ts = toSec(subs[j].time_start);
      if (!Number.isNaN(ts)) { nextTs = ts; break; }
    }
    if (prevTs != null && nextTs != null) {
      subs[i].time_start = fromSecPrecise(prevTs + (nextTs - prevTs) / 2);
    } else if (prevTs != null) {
      subs[i].time_start = fromSecPrecise(prevTs + 0.5);
    } else if (nextTs != null) {
      subs[i].time_start = fromSecPrecise(Math.max(0, nextTs - 1));
    }
  }

  // 3) 确保 time_start 严格递增（重复值会导致高亮跳行）
  for (let i = 1; i < subs.length; i++) {
    const cur = toSec(subs[i].time_start);
    const prev = toSec(subs[i - 1].time_start);
    if (Number.isFinite(cur) && Number.isFinite(prev) && cur <= prev) {
      const newStart = prev + 0.1;
      subs[i].time_start = fromSecPrecise(newStart);
      // 同步修正 time_end，避免 time_start > time_end 的无效区间
      const end = toSec(subs[i].time_end);
      if (!Number.isFinite(end) || end < newStart) {
        subs[i].time_end = fromSecPrecise(newStart + 0.5);
      }
    }
  }

  return subs;
}

export function useLocalStudy({ subtitles, currentTime, videoId = "local", onSeek, onStudyEnter, onStudyExit, onPlayOnly, onAnalysisCached, onSubtitlesProcessed, onSubtitleLearningProcessed }) {
  const [subs, setSubs] = useState(() => ensureIds(normalizeTimestamps(subtitles || [])));
  const [activeId, setActiveId] = useState(null);
  const [selectedCueId, setSelectedCueId] = useState(null);
  const [closeReadingState, setCloseReadingState] = useState({ activeCloseReadingCueId: null, isCloseReadingLoop: false });
  const { activeCloseReadingCueId, isCloseReadingLoop } = closeReadingState;
  // Compatibility aliases for existing panels/buttons; both derive from one shared state.
  const pinnedId = activeCloseReadingCueId;
  const loopingId = isCloseReadingLoop ? activeCloseReadingCueId : null;
  const [analyses, setAnalyses] = useState({});
  const [analyzingId, setAnalyzingId] = useState(null);
  const failedRef = useRef(new Set());
  const [failedIds, setFailedIds] = useState(new Set());
  const [processingStatus, setProcessingStatus] = useState({ phase: "idle", completed: 0, total: 0, diagnostics: null });
  const { toast } = useToast();
  const currentTimeRef = useRef(currentTime || 0);
  const processingAbortRef = useRef(null);
  const processingJobRef = useRef("");
  const translationRetryAttemptsRef = useRef(new Map());
  const learningJobRef = useRef("");
  const learningAbortRef = useRef(null);
  const [processingRetry, setProcessingRetry] = useState(0);
  currentTimeRef.current = currentTime || 0;
  // 字幕变化时处理：用 ID 签名判断是「同一批字幕的内容更新」还是「换了新影片」。
    // 同一批字幕（ID 相同）仅更新 subs 内容并合并新的 ai_analysis，不重置精读状态/analyses，
  // 避免 onAnalysisCached 写回 materials.subtitles 后触发重置导致精读面板闪现后消失。
  const prevSigRef = useRef("");
  useEffect(() => {
    const normalized = ensureIds(normalizeTimestamps(subtitles || []));
    const sig = normalized.map((s) => s.id).join(",");
    if (sig === prevSigRef.current && sig !== "") {
      // 同一批字幕的内容更新（如 ai_analysis 被父组件写回）——仅合并，不重置
      setSubs(normalized);
      setAnalyses((prev) => {
        let changed = false;
        const merged = { ...prev };
        for (const s of normalized) {
          if (s.ai_analysis && typeof s.ai_analysis === "object" && Number(s.ai_analysis_version || 0) === CLOSE_READING_VERSION && !merged[s.id]?._complete) {
            merged[s.id] = { ...s.ai_analysis, _complete: true };
            changed = true;
          } else if (!merged[s.id]?._complete && hasPreprocessedCueContent(s)) {
            const partial = partialAnalysisForCue(s, merged[s.id]);
            if (partial && JSON.stringify(partial) !== JSON.stringify(merged[s.id])) {
              merged[s.id] = partial;
              changed = true;
            }
          }
        }
        return changed ? merged : prev;
      });
      return;
    }
    // 不同字幕（新影片）——完整重置
    prevSigRef.current = sig;
    setSubs(normalized);
    setActiveId(null);
    setSelectedCueId(null);
    onStudyExit?.();
    setCloseReadingState({ activeCloseReadingCueId: null, isCloseReadingLoop: false });
    const preloaded = {};
    for (const s of normalized) {
      if (s.ai_analysis && typeof s.ai_analysis === "object" && Number(s.ai_analysis_version || 0) === CLOSE_READING_VERSION) {
        preloaded[s.id] = { ...s.ai_analysis, _complete: true };
      } else if (hasPreprocessedCueContent(s)) {
        const partial = partialAnalysisForCue(s);
        if (partial) preloaded[s.id] = partial;
      }
    }
    setAnalyses(preloaded);
    setAnalyzingId(null);
    failedRef.current = new Set();
    setFailedIds(new Set());
  }, [subtitles, onStudyExit]);

  const sourceHash = subtitleHash(subs);
  const inputSubtitles = ensureIds(normalizeTimestamps(subtitles || []));
  const inputHash = subtitleHash(inputSubtitles);
  const startLearningPreload = useCallback((jobKey, sourceSubtitles) => {
    const learningJobKey = `${jobKey}:learning`;
    if (learningJobRef.current === learningJobKey && learningAbortRef.current && !learningAbortRef.current.signal.aborted) return;
    learningAbortRef.current?.abort();
    const controller = new AbortController();
    learningAbortRef.current = controller;
    learningJobRef.current = learningJobKey;
    // Keep translation ahead of vocabulary analysis; this delay only yields time to
    // the translation worker and does not expose a separate UI state.
    setTimeout(() => {
      if (controller.signal.aborted) return;
      processSubtitleLearningWindow({
        videoId,
        subtitles: sourceSubtitles,
        getCurrentTime: () => currentTimeRef.current,
        signal: controller.signal,
        onProgress: async (learningProgress) => {
          if (controller.signal.aborted || !Array.isArray(learningProgress.subtitles)) return;
          setSubs((current) => mergeSubtitleProgress(current, learningProgress.subtitles));
          await onSubtitleLearningProcessed?.(learningProgress.subtitles);
        },
      }).catch(() => {});
    }, 1000);
  }, [videoId, onSubtitleLearningProcessed]);

  useEffect(() => {
    const englishCues = inputSubtitles.filter((cue) => cue.text_en?.trim());
    const missingTranslation = englishCues.some((cue) => !cue.text_zh?.trim());
    if (!englishCues.length || !missingTranslation) {
      setProcessingStatus({ phase: "idle", completed: 0, total: 0, diagnostics: null });
      return undefined;
    }
    const jobKey = `${videoId}:${inputHash}`;
    if (processingJobRef.current === jobKey && processingAbortRef.current && !processingAbortRef.current.signal.aborted) return undefined;
    processingJobRef.current = jobKey;
    const controller = new AbortController();
    processingAbortRef.current?.abort();
    processingAbortRef.current = controller;
    setProcessingStatus({ phase: "processing", completed: englishCues.filter((cue) => cue.text_zh?.trim()).length, total: englishCues.length, diagnostics: null });
    let retryTimer = null;
    const retryOrFinish = (failedCueIds, diagnostics = {}) => {
      if (controller.signal.aborted) return;
      const attempt = translationRetryAttemptsRef.current.get(jobKey) || 0;
      if (attempt < 2) {
        const retryCount = attempt + 1;
        translationRetryAttemptsRef.current.set(jobKey, retryCount);
        setProcessingStatus({ phase: "processing", retrying: true, retryCount, failedCueIds, completed: englishCues.length - failedCueIds.length, total: englishCues.length, diagnostics });
        if (import.meta.env.DEV && typeof window !== "undefined") {
          window.__LINGOCLUB_SUBTITLE_AI_DIAGNOSTICS__ = { ...window.__LINGOCLUB_SUBTITLE_AI_DIAGNOSTICS__, ...diagnostics, phase: "processing", retryCount, failedTranslations: 0, loadingTranslations: failedCueIds.length };
        }
        retryTimer = setTimeout(() => {
          if (controller.signal.aborted) return;
          processingJobRef.current = "";
          setProcessingRetry((value) => value + 1);
        }, retryCount * 650);
        return;
      }
      setProcessingStatus({ phase: "error", retrying: false, retryCount: attempt, failedCueIds, completed: englishCues.length - failedCueIds.length, total: englishCues.length, diagnostics });
      if (import.meta.env.DEV && typeof window !== "undefined") {
        window.__LINGOCLUB_SUBTITLE_AI_DIAGNOSTICS__ = { ...window.__LINGOCLUB_SUBTITLE_AI_DIAGNOSTICS__, ...diagnostics, phase: "error", retryCount: attempt, failedTranslations: failedCueIds.length, loadingTranslations: 0 };
      }
    };
    processSubtitleEpisode({
      videoId,
      subtitles: inputSubtitles,
      getCurrentTime: () => currentTimeRef.current,
      signal: controller.signal,
      onProgress: async (progress) => {
        if (controller.signal.aborted) return;
        const visibleProgress = progress.phase === "error"
          ? { ...progress, phase: "processing", retrying: true, retryCount: translationRetryAttemptsRef.current.get(jobKey) || 0 }
          : progress;
        setProcessingStatus(visibleProgress);
        if (import.meta.env.DEV && typeof window !== "undefined" && progress.diagnostics) {
          const failedCount = visibleProgress.phase === "error" ? (progress.failedCueIds || []).length : 0;
          window.__LINGOCLUB_SUBTITLE_AI_DIAGNOSTICS__ = {
            videoId,
            subtitleHash: sourceHash,
            ...progress.diagnostics,
            phase: visibleProgress.phase,
            completed: progress.completed,
            total: progress.total,
            subtitleItemsCreated: progress.diagnostics.totalCues,
            queuedTranslations: progress.diagnostics.missingTranslationCues,
            successfulTranslations: progress.completed,
            loadingTranslations: Math.max(0, progress.total - progress.completed - failedCount),
            failedTranslations: failedCount,
            retryCount: visibleProgress.retryCount || 0,
            stateWrite: "pending",
          };
        }
        if (Array.isArray(progress.subtitles)) {
          setSubs((current) => mergeSubtitleProgress(current, progress.subtitles));
          const persisted = await onSubtitlesProcessed?.(progress.subtitles);
          if (import.meta.env.DEV && typeof window !== "undefined" && progress.diagnostics) {
            window.__LINGOCLUB_SUBTITLE_AI_DIAGNOSTICS__ = { ...window.__LINGOCLUB_SUBTITLE_AI_DIAGNOSTICS__, stateWrite: persisted === false ? "failed" : "success" };
          }
          setAnalyses((current) => {
            const next = { ...current };
            for (const cue of progress.subtitles) {
              if (!next[cue.id]?._complete && hasPreprocessedCueContent(cue)) {
                const partial = partialAnalysisForCue(cue, next[cue.id]);
                if (partial) next[cue.id] = partial;
              }
            }
            return next;
          });
        }
      },
      onPriorityTranslationReady: () => {
        // Translation keeps its head start. Start learning only after the nearest
        // translation block has been displayed and saved.
        if (!controller.signal.aborted) startLearningPreload(jobKey, inputSubtitles);
      },
    }).then((result) => {
      if (controller.signal.aborted) return;
      if (result?.failedCueIds?.length) {
        retryOrFinish(result.failedCueIds, result.diagnostics || {});
        return;
      }
      translationRetryAttemptsRef.current.delete(jobKey);
    }).catch((error) => {
      const failedCueIds = englishCues.filter((cue) => !cue.text_zh?.trim()).map((cue) => cue.id);
      const diagnostics = {
        stage: error?.code === "TRANSLATION_PARSE_ERROR" ? "response_parse_error" : "translation_api_error",
        requestStatus: error?.code === "AI_ROUTE_NOT_CONFIGURED" || error?.code === "AUTH_REQUIRED" ? "not_sent" : "sent",
        responseStatus: Number(error?.status) || null,
        providerErrorType: error?.upstreamCode || error?.code || error?.name || "translation_failed",
        parseError: error?.code === "TRANSLATION_PARSE_ERROR" ? "invalid_or_incomplete_response" : null,
        timeout: error?.name === "TimeoutError",
      };
      retryOrFinish(failedCueIds, diagnostics);
    });
    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      controller.abort();
      if (processingAbortRef.current === controller) processingAbortRef.current = null;
      if (learningJobRef.current === `${jobKey}:learning`) {
        learningAbortRef.current?.abort();
        learningAbortRef.current = null;
        learningJobRef.current = "";
      }
    };
  }, [videoId, inputHash, processingRetry, onSubtitlesProcessed, startLearningPreload]);

  // Episodes that already have all translations still get lightweight nearby
  // vocabulary preloading. The cache key keeps this from duplicating the task
  // started after the first priority translation block.
  const hasMissingTranslation = inputSubtitles.some((cue) => cue.text_en?.trim() && !cue.text_zh?.trim());
  useEffect(() => {
    if (!inputSubtitles.some((cue) => cue.text_en?.trim()) || hasMissingTranslation) return undefined;
    const jobKey = `${videoId}:${inputHash}`;
    startLearningPreload(jobKey, inputSubtitles);
    return () => {
      if (learningJobRef.current === `${jobKey}:learning`) {
        learningAbortRef.current?.abort();
        learningAbortRef.current = null;
        learningJobRef.current = "";
      }
    };
  }, [videoId, inputHash, hasMissingTranslation, startLearningPreload]);

  useEffect(() => {
    if (processingStatus.phase !== "ready") return undefined;
    const timer = setTimeout(() => setProcessingStatus({ phase: "idle", completed: 0, total: 0, diagnostics: null }), 2800);
    return () => clearTimeout(timer);
  }, [processingStatus.phase]);

  const retrySubtitleProcessing = () => {
    processingJobRef.current = "";
    translationRetryAttemptsRef.current.set(`${videoId}:${inputHash}`, 0);
    setProcessingRetry((value) => value + 1);
  };

  // 播放高亮：取 time_start ≤ t 最近的一行作为当前台词。
  // 不使用区间匹配——宽 time_end 的行会"吸收"缺 time_end 的相邻行，导致跳行。
  // 归一化后每行都有唯一且递增的 time_start，逐行高亮不会遗漏。
  useEffect(() => {
    if (currentTime == null || subs.length === 0) return;
    const t = currentTime;
    let best = null;
    for (const s of subs) {
      const a = toSec(s.time_start);
      if (Number.isNaN(a)) continue;
      if (a <= t && (!best || a > toSec(best.time_start))) best = s;
    }
    if (best) {
      if (best.id !== activeId) setActiveId(best.id);
    } else if (activeId !== null) {
      setActiveId(null);
    }
  }, [currentTime, subs, activeId]);

  const generate = async (sub, { silent = false } = {}) => {
    if (!sub?.text_en || !String(sub.text_en).trim()) return;
    setAnalyzingId(sub.id);
    try {
      // 加 30 秒超时保护：精读 LLM 调用可能较慢，但超过 30 秒视为失败，
      // 避免 UI 永久卡在"正在精读这句台词…"的 loading 状态。
      const surrounding = getCueContext(subs, sub.id, 5);
      const hashValue = subtitleHash(subs);
      const processingCache = getSubtitleProcessingCache(videoId, hashValue);
      const cueProcessing = sub.ai_processing || processingCache.cues[sub.id] || {};
      const knownExpressions = [...(cueProcessing.difficultWords || []), ...(cueProcessing.phrases || [])];
      recordSubtitleAICall(videoId, hashValue, "closeReadingCalls");
      const invokePromise = invokeAI("translate_sentence", {
        cache_key: `${videoId}:${hashValue}:${sub.id}:v${CLOSE_READING_VERSION}`,
        text_en: sub.text_en,
        subtitle_text: sub.text_en,
        video_id: videoId,
        movie_title: "本地学习素材",
        speaker: sub.speaker,
        episode_context: processingCache.contextSummary || "",
        previous_cues: surrounding.previous,
        next_cues: surrounding.next,
        known_expressions: knownExpressions,
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("精读超时，请重试")), 26000)
      );
      const res = await Promise.race([invokePromise, timeoutPromise]);
      const a = res?.analysis;
      if (!a || typeof a !== "object") throw new Error("解析未返回内容");
      failedRef.current.delete(sub.id);
      setFailedIds((s) => { const n = new Set(s); n.delete(sub.id); return n; });
      setAnalyses((prev) => mergeCompleteAnalysis(prev, sub.id, a));
      // 持久化：将精读结果写回字幕对象的 ai_analysis 字段，通知父组件保存到 LocalMovieMeta。
      // 二次打开同一影片时，上面的预加载逻辑会直接读取，实现"秒开"。
      setSubs((list) => list.map((s) => (s.id === sub.id ? { ...s, ai_analysis: a } : s)));
      onAnalysisCached?.(sub.id, a, CLOSE_READING_VERSION);
    } catch (e) {
      failedRef.current.add(sub.id);
      setFailedIds((s) => new Set(s).add(sub.id));
      if (!silent) {
        const msg = e?.response?.data?.error || e?.message || "解析失败";
        toast({ title: "AI 解析失败", description: msg, variant: "destructive" });
      }
    } finally {
      setAnalyzingId((cur) => (cur === sub.id ? null : cur));
    }
  };

  useEffect(() => {
    if (!pinnedId) return;
    const sub = subs.find((s) => s.id === pinnedId);
    if (!sub) return;
    if (analyses[pinnedId]?._complete) return;
    if (analyzingId === pinnedId) return;
    if (failedRef.current.has(pinnedId)) return;
    generate(sub, { silent: false });
  }, [pinnedId, subs, analyses, analyzingId]);

  const retry = (sub) => {
    if (!sub) return;
    failedRef.current.delete(sub.id);
    setFailedIds((s) => { const n = new Set(s); n.delete(sub.id); return n; });
    generate(sub, { silent: false });
  };

  const hasAnyTs = subs.some((s) => s.time_start && String(s.time_start).trim());

  const onLineClick = (s) => {
    const sec = toSec(s.time_start);
    if (isCloseReadingLoop) onStudyExit?.();
    setSelectedCueId(s.id);
    setCloseReadingState({ activeCloseReadingCueId: null, isCloseReadingLoop: false });
    if (Number.isNaN(sec)) {
      toast({ title: "该台词无时间戳", description: "SRT/WebVTT 文件通常自带时间戳；若台词无时间码则无法跳转。", variant: "destructive" });
      setActiveId(s.id);
      return;
    }
    onSeek?.(sec);
    setActiveId(s.id);
  };

  // 精读与单句循环共用唯一状态：首次点击立即 seek/play 并循环，再点同句只解除循环。
  const onStudyClick = (s) => {
    if (activeCloseReadingCueId === s.id && isCloseReadingLoop) {
      exitCloseReading({ continuePlayback: true });
      return;
    }
    // 点击另一句会直接覆盖旧目标，父级 loopRange 也会同步替换。
    setCloseReadingState({ activeCloseReadingCueId: s.id, isCloseReadingLoop: true });
    setSelectedCueId(s.id);
    setActiveId(s.id);
    setAnalyses((current) => {
      if (current[s.id]?._complete) return current;
      const partial = partialAnalysisForCue(s, current[s.id]);
      return partial ? { ...current, [s.id]: partial } : current;
    });
    onStudyEnter?.(s);
  };

  const exitCloseReading = ({ continuePlayback = false } = {}) => {
    onStudyExit?.();
    setCloseReadingState({ activeCloseReadingCueId: null, isCloseReadingLoop: false });
    if (continuePlayback) onPlayOnly?.();
  };
  const clearPin = () => exitCloseReading();

  const updateSub = (id, patch) => {
    setSubs((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  return { loading: false, subs, activeId, setActiveId, selectedCueId, analyses, analyzingId, failedIds, retry, hasAnyTs, onLineClick, onStudyClick, toggleCloseReading: onStudyClick, exitCloseReading, activeCloseReadingCueId, isCloseReadingLoop, pinnedId, loopingId, clearPin, updateSub, processingStatus, retrySubtitleProcessing };
}
