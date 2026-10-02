import React, { useState, useRef, useCallback, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import LocalStudyImporter from "@/components/study/LocalStudyImporter";
import LocalSeasonImporter from "@/components/study/LocalSeasonImporter";
import YoutubeLinkImporter from "@/components/study/YoutubeLinkImporter";
import VideoPlayer from "@/components/study/VideoPlayer";
import SubtitleScrubber from "@/components/study/SubtitleScrubber";
import StudyAnalysisColumn from "@/components/study/StudyAnalysisColumn";
import StudyWorkspace from "@/components/study/StudyWorkspace";
import SubListResizer from "@/components/study/SubListResizer";
import SubtitleMask from "@/components/study/SubtitleMask";
import SubtitleWorkbench from "@/components/study/SubtitleWorkbench";
import { useLocalStudy } from "@/hooks/useLocalStudy";
import { saveLocalVideoHandle, clearLocalVideoSource, setTemporaryLocalVideoFile, getLocalVideoSource, getLocalMediaStorageStats, saveLocalMediaAssets, removeLocalMediaAssetFields, deleteLocalVideo, deleteLocalVideoMany } from "@/lib/localStudyLibrary";
import { localFolders, localMovies } from "@/lib/localStudyMeta";
import { formatEpisodeCode, parseEpisodeNumber } from "@/lib/localSeason";
import { useToast } from "@/components/ui/use-toast";
import MinimalSubtitleBar from "@/components/study/MinimalSubtitleBar";
import TheaterOverlay from "@/components/study/TheaterOverlay";
import LocalStudyLibrary from "@/components/study/LocalStudyLibrary";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { RotateCcw, Maximize2, Film, Loader2, EyeOff, Play, Pause, Info, Pencil, Check, X, RotateCw } from "lucide-react";
import BilibiliScrubber from "@/components/study/BilibiliScrubber";
import YoutubeSubtitleHelper from "@/components/study/YoutubeSubtitleHelper";
import { toSec } from "@/lib/timecode";
import { getStudyCueLoopRange } from "@/lib/studyCueNavigation";
import { extractYouTubeId } from "@/lib/youtubeTranscriptClient";
import { cleanSubtitleText } from "@/lib/subtitleCleaner";
import { useAuth } from "@/lib/AuthContext";
import { syncUserState } from "@/lib/cloudState";
import { useGlobalVideoSpace } from "@/hooks/useGlobalVideoSpace";
import { useTranscriptCueFocus } from "@/hooks/useTranscriptCueFocus";
import PageBackButton from "@/components/common/PageBackButton";
import { saveLocalLibraryView } from "@/lib/localLibraryNavigation";
import { cloneSubtitleCues, createLatestRequestGate, replaceEpisodeSubtitlesInList } from "@/lib/localSubtitleWorkflow";

function secondsToTimecode(value) {
  const total = Number(value);
  if (!Number.isFinite(total) || total < 0) return "";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total - hours * 3600 - minutes * 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds.toFixed(3).padStart(6, "0")}`
    : `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
}

const TEMP_VIDEO_NOTICE = "页面关闭后可能需要重新选择本地视频；字幕、收藏和学习进度会保留。";

function mergeSubtitleSnapshots(current = [], incoming = []) {
  const previousById = new Map(current.map((cue) => [cue.id, cue]));
  return incoming.map((cue) => {
    const previous = previousById.get(cue.id);
    if (!previous) return { ...cue };
    return {
      ...previous,
      ...cue,
      text_zh: String(previous.text_zh || "").trim() ? previous.text_zh : (cue.text_zh || ""),
      ai_processing: { ...(previous.ai_processing || {}), ...(cue.ai_processing || {}) },
    };
  });
}

// 本地学习页：用户自带本地视频+字幕，全部在浏览器内播放；影片名、海报、字幕
// 影片元数据保存在 localStorage，视频二进制存本机 IndexedDB（以元数据 id 为 key）。
// 本机没有视频文件时卡片仍保留（只是不能播放）。
// 学习页还提供完整字幕管理（上传 / 粘贴 / 手动逐句）与字幕遮挡开关，并支持
// 横屏全屏沉浸学习。
export default function LocalStudy() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [materials, setMaterials] = useState(null); // { videoUrl, videoName, subtitles, posterUrl, recordId, hasLocalVideo }
  const [metas, setMetas] = useState([]); // 本地影片元数据
  const [folders, setFolders] = useState([]); // 本地文件夹元数据
  const [loadingLib, setLoadingLib] = useState(true);
  const [showImporter, setShowImporter] = useState(false);
  const [importMode, setImportMode] = useState(null); // "local" | "youtube"
  const [saving, setSaving] = useState(false);
  const [currentTime, setCurrentTime] = useState(null);
  const [subHeight, setSubHeight] = useState(() => {
    try { const v = parseInt(localStorage.getItem("study_sub_h"), 10); return Number.isFinite(v) && v ? v : 256; } catch { return 256; }
  });
  const [isPhone, setIsPhone] = useState(() => (typeof window !== "undefined" ? Math.min(window.innerWidth, window.innerHeight) < 768 : false));
  const [theater, setTheater] = useState(false);
  const [maskOn, setMaskOn] = useState(false);
  const [simTime, setSimTime] = useState(null);
  const [clockRunning, setClockRunning] = useState(false);
  const [loopRange, setLoopRange] = useState(null);
  const loopRangeRef = useRef(null);
  const studySubsRef = useRef([]);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);
  const videoRef = useRef(null);
  const relinkFileInputRef = useRef(null);
  const bookmarkletHandledRef = useRef(false);
  const sourceDeepLinkOpenedRef = useRef("");
  const sourceDeepLinkFocusedRef = useRef("");
  const openRequestRef = useRef(createLatestRequestGate());
  const lastCloudSyncNoticeRef = useRef(0);
  const { toast } = useToast();
  const { user, isLoadingAuth } = useAuth();
  const requireAuth = useRequireAuth();

  useEffect(() => {
    const handleCloudSyncStatus = (event) => {
      if (event.detail?.ok || event.detail?.status === "synced") return;
      const now = Date.now();
      if (now - lastCloudSyncNoticeRef.current < 8000) return;
      lastCloudSyncNoticeRef.current = now;
      toast({ title: "已保存到本机，云同步稍后重试", description: "本地影片整理和学习数据仍然保留。" });
    };
    window.addEventListener("lingoclub:cloud-sync-status", handleCloudSyncStatus);
    return () => window.removeEventListener("lingoclub:cloud-sync-status", handleCloudSyncStatus);
  }, [toast]);

  useEffect(() => {
    let active = true;
    Promise.all([getLocalMediaStorageStats(), navigator.storage?.estimate?.().catch(() => null) || Promise.resolve(null)]).then(([stats, browserStorage]) => {
      if (active && typeof window !== "undefined") window.__LINGOCLUB_LOCAL_MEDIA_DIAGNOSTIC__ = {
        ...stats,
        originStorageUsageBytes: browserStorage?.usage || null,
        originStorageQuotaBytes: browserStorage?.quota || null,
        recordedAt: new Date().toISOString(),
      };
    }).catch(() => {});
    return () => { active = false; };
  }, [folders.length, metas.length]);

  // App-shell deep links open the existing importer in place; import behavior
  // and the importer components remain unchanged.
  useEffect(() => {
    const requestedMode = searchParams.get("import");
    if (requestedMode !== "youtube" && requestedMode !== "local") return;
    setImportMode(requestedMode);
    setShowImporter(true);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("import");
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => { try { localStorage.setItem("study_sub_h", String(subHeight)); } catch { /* noop */ } }, [subHeight]);
  useEffect(() => {
    const on = () => setIsPhone(Math.min(window.innerWidth, window.innerHeight) < 768);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  const refreshLibrary = useCallback(async () => {
    setLoadingLib(true);
    try {
      const list = await localMovies.list();
      setMetas(list || []);
    } catch {
      setMetas([]);
    } finally {
      setLoadingLib(false);
    }
  }, []);
  const refreshFolders = useCallback(async () => {
    try {
      const list = await localFolders.list();
      setFolders(list || []);
    } catch {
      setFolders([]);
    }
  }, []);
  useEffect(() => {
    void refreshLibrary();
    void refreshFolders();
  }, [refreshLibrary, refreshFolders]);

  const isBilibili = /bilibili\.com\/video\/(BV|av)|player\.bilibili\.com\/player/i.test(materials?.videoUrl || "");

  // B站跨域 iframe 读不到真实进度，用页面级仿真时钟驱动字幕高亮。
  // 点台词行/播放键/进度条均以 autoplay&t 重载 iframe，本地时钟按真实速率跟随。
  const seekAndPause = useCallback((sec) => {
    if (!Number.isFinite(sec)) return;
    if (isBilibili) { setSimTime(sec); setClockRunning(false); }
    if (isPhone && isBilibili) return;
    const api = videoRef.current;
    if (api?.pause) api.pause(sec);
    else if (api) { try { api.currentTime = sec; } catch { /* noop */ } }
  }, [isBilibili, isPhone]);
  const playFromLine = useCallback((sec) => {
    if (!Number.isFinite(sec)) return;
    if (isBilibili) { setSimTime(sec); setClockRunning(true); }
    const api = videoRef.current;
    if (api?.play) api.play(sec);
    else if (api) { try { api.currentTime = sec; api.play?.(); } catch { /* noop */ } }
  }, [isBilibili]);

  // B站同步：站内播放/暂停键以当前时间点重载 iframe，本地时钟按真实速率跟随
  const toggleClock = useCallback(() => {
    if (isBilibili) {
      const t = simTime ?? currentTime ?? videoRef.current?.getCurrentTime?.() ?? 0;
      if (clockRunning || videoRef.current?.isPlaying?.()) { setClockRunning(false); videoRef.current?.pause?.(t); }
      else { setSimTime(t); setClockRunning(true); videoRef.current?.play?.(t); }
      return;
    }
    if (videoRef.current?.isPlaying?.()) videoRef.current.pauseOnly?.();
    else videoRef.current?.playOnly?.();
  }, [clockRunning, currentTime, isBilibili, simTime]);
  const playPlayback = useCallback(() => {
    if (isBilibili) setClockRunning(true);
    videoRef.current?.playOnly?.();
  }, [isBilibili]);

  // B站本地仿真时钟：setInterval + performance.now 按真实流逝时间推进（250ms 节流）
  useEffect(() => {
    if (!isBilibili || !clockRunning) return;
    let lastNow = performance.now();
    let lastEmit = -1;
    const tick = () => {
      const now = performance.now();
      const dt = (now - lastNow) / 1000;
      lastNow = now;
      setSimTime((t) => {
        if (t == null || dt <= 0) return t;
        const nt = +(t + dt).toFixed(3);
        const r = Math.round(nt * 10) / 10;
        if (r === lastEmit) return t;
        lastEmit = r;
        return nt;
      });
    };
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [isBilibili, clockRunning]);

  const studyTime = isBilibili ? simTime : currentTime;

  // 精读：进入单句循环——跳到台词开头播放，到达末尾自动跳回开头
  const onStudyEnter = useCallback((sub) => {
    const nextLoop = getStudyCueLoopRange(sub, studySubsRef.current);
    if (!nextLoop) return;
    loopRangeRef.current = nextLoop;
    setLoopRange(nextLoop);
    playFromLine(nextLoop.start);
  }, [playFromLine]);
  const onStudyExit = useCallback(() => {
    // 解除单句循环但不暂停或 seek，视频从当前播放位置自然继续。
    loopRangeRef.current = null;
    setLoopRange(null);
  }, []);

  // 单句循环：到达台词末尾自动跳回开头（YouTube/原生 seek+play，B站重载 iframe）
  useEffect(() => {
    const activeLoop = loopRangeRef.current;
    if (!activeLoop || !loopRange) return;
    if (studyTime != null && studyTime >= activeLoop.end) {
      playFromLine(activeLoop.start);
    }
  }, [loopRange, studyTime, playFromLine]);

  // 精读结果持久化：生成后写回 LocalMovieMeta 的 subtitles[].ai_analysis，二次打开秒读。
  const onAnalysisCached = useCallback((subId, analysis, analysisVersion = 2) => {
    const id = materials?.recordId;
    if (!id) return;
    setMaterials((m) => {
      if (!m) return m;
      const newSubs = (m.subtitles || []).map((s) => (s.id === subId ? { ...s, ai_analysis: analysis, ai_analysis_version: analysisVersion } : s));
      return { ...m, subtitles: newSubs };
    });
    // 防抖写入：避免连续精读多句时频繁写库
    if (onAnalysisCached._timer) clearTimeout(onAnalysisCached._timer);
    onAnalysisCached._timer = setTimeout(async () => {
      try {
        const latest = await localMovies.get(id);
        if (latest?.subtitles) {
          const updated = latest.subtitles.map((s) =>
            s.id === subId ? { ...s, ai_analysis: analysis, ai_analysis_version: analysisVersion } : s
          );
          await localMovies.update(id, { subtitles: updated });
        }
      } catch { /* 写入失败静默，不影响使用 */ }
    }, 1500);
  }, [materials?.recordId]);

  const subtitlePersistQueueRef = useRef(Promise.resolve());
  const onSubtitlesProcessed = useCallback((processedSubtitles) => {
    const id = materials?.recordId;
    if (!id || !Array.isArray(processedSubtitles)) return;
    const snapshot = processedSubtitles.map((cue) => ({ ...cue }));
    setMaterials((current) => current?.recordId === id ? { ...current, subtitles: mergeSubtitleSnapshots(current.subtitles, snapshot) } : current);
    setMetas((current) => current.map((meta) => meta.id === id
      ? { ...meta, subtitles: mergeSubtitleSnapshots(meta.subtitles || [], snapshot), subtitle_count: snapshot.length }
      : meta));
    // Persist each processor checkpoint in order so a refresh cannot discard
    // translations completed by earlier batches.
    subtitlePersistQueueRef.current = subtitlePersistQueueRef.current
      .catch(() => {})
      .then(async () => {
        const latest = await localMovies.get(id);
        const subtitles = mergeSubtitleSnapshots(latest?.subtitles || [], snapshot);
        await localMovies.update(id, { subtitles, subtitle_count: subtitles.length });
      })
      .catch(() => {});
    return subtitlePersistQueueRef.current;
  }, [materials?.recordId]);

  const onSubtitleLearningProcessed = useCallback((processedSubtitles) => {
    const id = materials?.recordId;
    if (!id || !Array.isArray(processedSubtitles)) return;
    const snapshot = processedSubtitles.map((cue) => ({ ...cue }));
    const mergeLearning = (current) => current?.recordId === id
      ? { ...current, subtitles: mergeSubtitleSnapshots(current.subtitles || [], snapshot) }
      : current;
    setMaterials(mergeLearning);
    setMetas((current) => current.map((meta) => meta.id === id
      ? { ...meta, subtitles: mergeSubtitleSnapshots(meta.subtitles || [], snapshot), subtitle_count: meta.subtitle_count || snapshot.length }
      : meta));
    subtitlePersistQueueRef.current = subtitlePersistQueueRef.current
      .catch(() => {})
      .then(async () => {
        const latest = await localMovies.get(id);
        const subtitles = mergeSubtitleSnapshots(latest?.subtitles || [], snapshot);
        await localMovies.update(id, { subtitles, subtitle_count: latest?.subtitle_count || subtitles.length });
      })
      .catch(() => {});
    return subtitlePersistQueueRef.current;
  }, [materials?.recordId]);

  const study = useLocalStudy({
    subtitles: materials?.subtitles,
    videoId: extractYouTubeId(materials?.videoUrl) || materials?.recordId || "local",
    currentTime: studyTime,
    onSeek: (sec) => { setLoopRange(null); playFromLine(sec); },
    onPlay: playFromLine,
    onPlayOnly: playPlayback,
    onStudyEnter,
    onStudyExit,
    onAnalysisCached,
    onSubtitlesProcessed,
    onSubtitleLearningProcessed,
  });
  studySubsRef.current = study.subs;
  const onExternalSeek = useCallback((time) => {
    const activeLoop = loopRangeRef.current;
    if (activeLoop && (time < activeLoop.start - 0.05 || time > activeLoop.end + 0.35)) study.exitCloseReading();
  }, [study.exitCloseReading]);
  const transcriptFocus = useTranscriptCueFocus({ subtitles: study.subs, videoRef, fallbackTime: studyTime, setActiveId: study.setActiveId, setSelectedCueId: study.setSelectedCueId });
  const startCloseReadingFromKeyboard = useCallback(() => {
    const cue = transcriptFocus.focusCurrentTranscriptCue();
    if (cue) study.toggleCloseReading(cue);
  }, [study.toggleCloseReading, transcriptFocus.focusCurrentTranscriptCue]);
  const navigateTranscriptCue = useCallback((direction) => {
    const cue = transcriptFocus.focusAdjacentTranscriptCue(direction);
    if (!cue) return;
    const start = toSec(cue.time_start);
    if (!Number.isFinite(start)) return;
    if (study.isCloseReadingLoop) study.toggleCloseReading(cue);
    else playFromLine(start);
  }, [playFromLine, study.isCloseReadingLoop, study.toggleCloseReading, transcriptFocus.focusAdjacentTranscriptCue]);
  useGlobalVideoSpace({
    togglePlayback: toggleClock,
    enabled: Boolean(materials?.videoUrl),
    isCloseReadingLoop: study.isCloseReadingLoop,
    exitCloseReading: study.exitCloseReading,
    startCloseReading: startCloseReadingFromKeyboard,
    focusCurrentCue: transcriptFocus.focusCurrentTranscriptCue,
    navigateTranscriptCue,
  });

  // 全屏切换后 VideoPlayer 会被重新挂载，需要恢复播放进度
  useEffect(() => {
    if (!materials?.videoUrl) return;
    const t = isBilibili ? simTime : currentTime;
    if (t == null || t < 0.5) return;
    let cancelled = false;
    const restore = () => {
      if (cancelled) return;
      const api = videoRef.current;
      if (!api) { setTimeout(restore, 200); return; }
      if (isBilibili) { if (clockRunning) api.play(t); else api.pause(t); }
      else api.seek(t);
    };
    const timer = setTimeout(restore, isBilibili ? 300 : 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [theater]);

  const openTheater = useCallback(async () => {
    setTheater(true);
    try {
      if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen?.();
      if (isPhone && window.screen?.orientation?.lock) await window.screen.orientation.lock("landscape");
    } catch { /* 部分浏览器/非 HTTPS 不支持，忽略 */ }
  }, [isPhone]);
  const closeTheater = useCallback(async () => {
    setTheater(false);
    try { if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen(); } catch { /* noop */ }
  }, []);

  const revokeCurrent = useCallback(() => {
    if (materials?.videoUrl?.startsWith("blob:")) {
      try { URL.revokeObjectURL(materials.videoUrl); } catch { /* noop */ }
    }
  }, [materials?.videoUrl]);
  useEffect(() => () => revokeCurrent(), [revokeCurrent]);

  // Reuse an available file handle, a session-selected File, or an old stored
  // video Blob. New selections are never persisted as video bytes.
  const openMeta = useCallback(async (sourceMeta, markLearned = false, transientFile = null, returnView = null) => {
    const requestId = openRequestRef.current.begin();
    let meta = await localMovies.get(sourceMeta.id).catch(() => null) || sourceMeta;
    if (!openRequestRef.current.isCurrent(requestId)) return;
    if (markLearned) {
      const last_studied_at = new Date().toISOString();
      try {
        meta = await localMovies.update(meta.id, { last_studied_at });
        if (!openRequestRef.current.isCurrent(requestId)) return;
        setMetas((list) => list.map((item) => item.id === meta.id ? meta : item));
      } catch { /* opening the local lesson must still work if progress metadata cannot be written */ }
    }
    if (returnView) saveLocalLibraryView(returnView);
    else if (!searchParams.get("returnContext")) {
      const isRemote = Boolean(meta.video_url);
      saveLocalLibraryView({ tab: isRemote ? "videos" : "films", activeFolder: "all", activeSeasonId: isRemote ? null : (meta.folder || null) });
    }
    if (!searchParams.get("returnContext") && !window.history.state?.lingoclubLocalPlayer) {
      window.history.pushState({ ...(window.history.state || {}), lingoclubLocalPlayer: true }, "", window.location.href);
    }
    let videoUrl = null;
    let hasLocalVideo = false;
    let mediaAccess = null;
    try {
      mediaAccess = await getLocalVideoSource(meta.id, { requestPermission: false });
      const file = mediaAccess.file || transientFile;
      if (file) { videoUrl = URL.createObjectURL(file); hasLocalVideo = true; }
    } catch { /* noop */ }
    if (!openRequestRef.current.isCurrent(requestId)) {
      if (videoUrl?.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
      return;
    }
    if (!videoUrl && meta.video_url) { videoUrl = meta.video_url; }
    revokeCurrent();
    setMaterials({
      videoUrl,
      videoName: meta.name,
      originalTitle: meta.original_title || "",
      subtitles: meta.subtitles || [],
      subtitleSourceName: meta.subtitle_source_name || "",
      subtitleImportedAt: meta.subtitle_imported_at || "",
      subtitleCount: Number(meta.subtitle_count) || (meta.subtitles || []).length,
      posterUrl: meta.poster_url,
      recordId: meta.id,
      hasLocalVideo,
      mediaAccess,
      legacyVideoCopy: mediaAccess?.source === "legacy-blob",
      temporaryLocalFile: Boolean(meta.local_video_temporary),
      pendingSourceStart: null,
    });
    setMaskOn(false);
  }, [revokeCurrent, searchParams]);

  useEffect(() => {
    if (!materials) return undefined;
    const onPopState = (event) => {
      if (event.state?.lingoclubLocalPlayer) return;
      revokeCurrent();
      setMaterials(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [materials, revokeCurrent]);

  useEffect(() => {
    const id = searchParams.get("open");
    if (!id || sourceDeepLinkOpenedRef.current === id || !metas.length) return;
    const meta = metas.find((item) => String(item.id) === String(id));
    if (!meta) return;
    sourceDeepLinkOpenedRef.current = id;
    void openMeta(meta);
  }, [metas, openMeta, searchParams]);

  useEffect(() => {
    const id = searchParams.get("open");
    const at = Number(searchParams.get("t") ?? searchParams.get("at"));
    if (!id || !materials || String(materials.recordId) !== String(id) || !Number.isFinite(at)) return;
    const marker = `${id}:${searchParams.get("cue") || ""}:${at}`;
    if (sourceDeepLinkFocusedRef.current === marker) return;
    const cue = transcriptFocus.focusTranscriptCueByIdOrTime(searchParams.get("cue"), at);
    if (!cue) return;
    sourceDeepLinkFocusedRef.current = marker;
    const cueStart = cue?.time_start == null ? at : toSec(cue.time_start);
    if (searchParams.get("closeReading") === "1") {
      study.toggleCloseReading(cue);
      if (!materials.videoUrl) setMaterials((current) => current ? { ...current, pendingSourceStart: cueStart } : current);
    }
    else playFromLine(Number.isFinite(cueStart) ? cueStart : at);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("open"); nextParams.delete("at"); nextParams.delete("t"); nextParams.delete("cue"); nextParams.delete("closeReading");
    setSearchParams(nextParams, { replace: true });
  }, [materials, playFromLine, searchParams, setSearchParams, study.subs.length, study.toggleCloseReading, transcriptFocus.focusTranscriptCueByIdOrTime]);

  const relinkOriginalVideo = useCallback(async () => {
    const id = materials?.recordId;
    if (!id) return;
    if (!window.showOpenFilePicker) {
      relinkFileInputRef.current?.click();
      return;
    }
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: "视频文件", accept: { "video/*": [".mp4", ".webm", ".mov", ".m4v", ".mkv", ".avi"] } }],
      });
      const file = await handle.getFile();
      await saveLocalVideoHandle(id, handle);
      try { await localMovies.update(id, { local_video_temporary: false, local_video_storage: "file-handle" }); } catch { /* handle is already saved */ }
      const nextUrl = URL.createObjectURL(file);
      revokeCurrent();
      setMaterials((current) => current ? { ...current, videoUrl: nextUrl, hasLocalVideo: true, legacyVideoCopy: false, mediaAccess: { source: "handle", permissionRequired: false } } : current);
      toast({ title: "已重新关联视频", description: "字幕、收藏和学习记录保持不变。" });
    } catch (error) {
      if (error?.name !== "AbortError") toast({ title: "重新定位失败", description: error?.message || "无法读取所选视频", variant: "destructive" });
    }
  }, [materials?.recordId, revokeCurrent, toast]);

  const relinkWithBrowserFile = useCallback(async (file) => {
    const id = materials?.recordId;
    if (!id || !file) return;
    await clearLocalVideoSource(id).catch(() => {});
    setTemporaryLocalVideoFile(id, file);
    try { await localMovies.update(id, { local_video_temporary: true, local_video_storage: "device-file" }); } catch { /* playback remains available */ }
    const nextUrl = URL.createObjectURL(file);
    revokeCurrent();
    setMaterials((current) => current ? {
      ...current,
      videoUrl: nextUrl,
      hasLocalVideo: true,
      legacyVideoCopy: false,
      temporaryLocalFile: true,
      mediaAccess: { source: "temporary-file", permissionRequired: false, missing: false },
    } : current);
    toast({ title: "已关联此设备的视频", description: "字幕、收藏和学习记录保持不变。" });
  }, [materials?.recordId, revokeCurrent, toast]);

  const requestVideoPermission = useCallback(async () => {
    try {
      const source = await getLocalVideoSource(materials?.recordId, { requestPermission: true });
      if (!source.file) {
        toast({ title: source.missing ? "找不到本地文件" : "需要重新授权本地媒体目录", description: "请重新定位原始视频文件。" });
        return;
      }
      const nextUrl = URL.createObjectURL(source.file);
      revokeCurrent();
      setMaterials((current) => current ? { ...current, videoUrl: nextUrl, hasLocalVideo: true, mediaAccess: source } : current);
    } catch (error) { toast({ title: "无法读取本地视频", description: error?.message || "请重新授权或定位文件", variant: "destructive" }); }
  }, [materials?.recordId, revokeCurrent, toast]);

  const createSeasonFromSelection = useCallback(async (ids, { showTitle, seasonNumber, coverFile }) => {
    try {
      const displayTitle = String(showTitle || "").trim();
      const existing = (await localFolders.list()).find((folder) => folder.tab_type === "films" && folder.project_type === "season" && folder.show_title?.toLowerCase() === showTitle.toLowerCase() && Number(folder.season_number) === Number(seasonNumber));
      const season = existing
        ? await localFolders.update(existing.id, { name: displayTitle, display_title: displayTitle, show_title: showTitle, season_number: Number(seasonNumber), cover_blob: coverFile })
        : await localFolders.create({ name: displayTitle, display_title: displayTitle, show_title: showTitle, season_number: Number(seasonNumber), project_type: "season", tab_type: "films", cover_blob: coverFile, sort_order: Date.now() });
      const selected = metas.filter((meta) => ids.includes(meta.id));
      const usedNumbers = new Set();
      const updates = selected.map((meta, index) => {
        const detected = parseEpisodeNumber(meta.name || meta.original_title);
        let episodeNumber = detected?.episodeNumber || index + 1;
        while (usedNumbers.has(episodeNumber)) episodeNumber += 1;
        usedNumbers.add(episodeNumber);
        return {
          id: meta.id,
          folder: season.id,
          media_type: "episode",
          show_title: showTitle,
          season_number: Number(seasonNumber),
          episode_number: episodeNumber,
          episode_title: detected ? (meta.episode_title || "") : (meta.episode_title || meta.name || ""),
        };
      });
      await localMovies.bulkUpdate(updates);
      await Promise.all([refreshFolders(), refreshLibrary()]);
      toast({ title: `已保存到本机：「${displayTitle}」`, description: `${updates.length} 集已加入本季，原视频、字幕和学习数据均保留。` });
      return season;
    } catch (error) {
      toast({ title: "整理剧集失败", description: error?.message || "请稍后重试", variant: "destructive" });
      return null;
    }
  }, [metas, refreshFolders, refreshLibrary, toast]);

  const assignEpisodeToSeason = useCallback(async (movieId, seasonId, episodeNumber) => {
    const season = folders.find((folder) => folder.id === seasonId && folder.project_type === "season");
    const movie = metas.find((item) => item.id === movieId);
    if (!season || !movie) return;
    try {
      await localMovies.update(movieId, {
        folder: season.id,
        media_type: "episode",
        show_title: season.show_title || season.name,
        season_number: Number(season.season_number) || 1,
        episode_number: Number(episodeNumber),
        episode_title: movie.episode_title || "",
      });
      await refreshLibrary();
    } catch (error) {
      toast({ title: "移动剧集失败", description: error?.message || "请稍后重试", variant: "destructive" });
    }
  }, [folders, metas, refreshLibrary, toast]);

  const updateEpisodeNumber = useCallback(async (movieId, episodeNumber) => {
    try {
      await localMovies.update(movieId, { episode_number: Number(episodeNumber) });
      await refreshLibrary();
    } catch (error) {
      toast({ title: "集数未保存", description: error?.message || "请稍后重试", variant: "destructive" });
    }
  }, [refreshLibrary, toast]);

  const setSeasonCover = useCallback(async (seasonId, file) => {
    try {
      await localFolders.update(seasonId, { cover_blob: file });
      await refreshFolders();
    } catch (error) {
      toast({ title: "封面未保存", description: error?.message || "请稍后重试", variant: "destructive" });
    }
  }, [refreshFolders, toast]);

  const onSeasonBatchReady = useCallback(async ({ showTitle, seasonNumber, seasonCoverFile, episodes }) => {
    setSaving(true);
    try {
      const parsedSeasonNumbers = episodes
        .map((episode) => parseEpisodeNumber(episode.videoFile?.name)?.seasonNumber)
        .filter((number) => Number.isInteger(number) && number > 0);
      const inferredSeason = parsedSeasonNumbers.length
        ? parsedSeasonNumbers.sort((a, b) => parsedSeasonNumbers.filter((number) => number === b).length - parsedSeasonNumbers.filter((number) => number === a).length || a - b)[0]
        : null;
      const internalSeasonNumber = Number.isInteger(Number(seasonNumber)) && Number(seasonNumber) > 0
        ? Number(seasonNumber)
        : inferredSeason;
      const diagnostics = episodes.map((episode) => ({
        episodeNumber: episode.episodeNumber,
        videoExists: Boolean(episode.videoFile),
        videoName: episode.videoFile?.name || null,
        subtitleExists: Boolean(episode.subtitleFile),
        subtitleName: episode.subtitleFile?.name || null,
        firstSubtitle: episode.subtitles?.[0]?.text_en || episode.subtitles?.[0]?.text_zh || null,
        subtitleCount: episode.subtitles?.length || 0,
        posterExists: Boolean(seasonCoverFile),
      }));
      console.info("[LocalStudy] season batch pre-write diagnostics", diagnostics);
      if (typeof window !== "undefined") window.__LINGOCLUB_LOCAL_SEASON_IMPORT__ = { showTitle, seasonNumber: internalSeasonNumber, episodes: diagnostics, recordedAt: new Date().toISOString() };
      const invalidVideo = episodes.find((episode) => !episode.videoFile || typeof episode.videoFile.name !== "string" || typeof episode.videoFile.slice !== "function");
      if (invalidVideo) throw new Error(`第 ${invalidVideo.episodeNumber} 集视频文件缺失或无效，尚未写入剧集`);
      const invalidSubtitle = episodes.find((episode) => episode.subtitleFile && (typeof episode.subtitleFile.name !== "string" || typeof episode.subtitleFile.text !== "function"));
      if (invalidSubtitle) throw new Error(`第 ${invalidSubtitle.episodeNumber} 集字幕文件引用无效，尚未写入剧集`);

      const displayTitle = String(showTitle || "").trim();
      const existing = (await localFolders.list()).find((folder) => folder.tab_type === "films" && folder.project_type === "season" && folder.display_title?.toLowerCase() === displayTitle.toLowerCase() && (internalSeasonNumber == null ? folder.season_number == null : Number(folder.season_number) === internalSeasonNumber));
      const season = existing
        ? await localFolders.update(existing.id, { name: displayTitle, display_title: displayTitle, show_title: showTitle, season_number: internalSeasonNumber, cover_blob: seasonCoverFile })
        : await localFolders.create({ name: displayTitle, display_title: displayTitle, show_title: showTitle, season_number: internalSeasonNumber, project_type: "season", tab_type: "films", cover_blob: seasonCoverFile, sort_order: Date.now() });
      const temporaryEpisodes = [];
      for (const episode of episodes) {
        const episodeNumber = Number(episode.episodeNumber);
        const episodeCode = formatEpisodeCode(internalSeasonNumber || 1, episodeNumber);
        const episodeTitle = episode.title || "";
      const episodeSubtitles = cloneSubtitleCues(episode.subtitles);
        const saved = await localMovies.create({
          name: episodeTitle || episodeCode,
          original_title: episode.videoFile.name,
          video_url: "",
          poster_url: "",
          subtitles: episodeSubtitles,
          subtitle_source_name: episode.subtitleFile?.name || "",
          subtitle_imported_at: episode.subtitleFile ? new Date().toISOString() : "",
          subtitle_count: episodeSubtitles.length,
          folder: season.id,
          media_type: "episode",
          show_title: showTitle,
          season_number: internalSeasonNumber,
          episode_number: episodeNumber,
          episode_title: episodeTitle,
        });
        if (episode.videoHandle) {
          await saveLocalVideoHandle(saved.id, episode.videoHandle);
        } else {
          temporaryEpisodes.push(episode.episodeNumber);
          setTemporaryLocalVideoFile(saved.id, episode.videoFile);
          try { await localMovies.update(saved.id, { local_video_temporary: true, local_video_storage: "device-file" }); } catch { /* keep imported episode metadata */ }
        }
        console.debug("[LocalStudy] episode subtitle binding", {
          episode: episodeCode,
          movieId: saved.id,
          videoName: episode.videoFile.name,
          subtitleName: episode.subtitleFile?.name || null,
          firstSubtitle: episodeSubtitles[0]?.text_en || episodeSubtitles[0]?.text_zh || null,
          subtitleCount: episodeSubtitles.length,
        });
        const localHandles = {};
        if (episode.subtitleHandle) localHandles.subtitleHandle = episode.subtitleHandle;
        if (episode.directoryHandle) localHandles.directoryHandle = episode.directoryHandle;
        if (episode.subtitleDirectoryHandle) localHandles.subtitleDirectoryHandle = episode.subtitleDirectoryHandle;
        if (Object.keys(localHandles).length) await saveLocalMediaAssets(saved.id, localHandles);
      }
      setShowImporter(false);
      setImportMode(null);
      await Promise.all([refreshLibrary(), refreshFolders()]);
      toast({ title: `已保存到本机：「${displayTitle}」`, description: temporaryEpisodes.length ? `${episodes.length} 集已导入；第 ${temporaryEpisodes.join("、")} 集关闭页面后可能需要重新选择视频。字幕、收藏和进度仍会保留。` : `${episodes.length} 集已加入本地影片库。云同步将在后台进行。` });
      return season;
    } catch (error) {
      toast({ title: "剧集导入失败", description: error?.message || "请稍后重试", variant: "destructive" });
      return null;
    } finally {
      setSaving(false);
    }
  }, [refreshFolders, refreshLibrary, toast]);

  // 导入完成：本地 LocalMovieMeta 实体 + 本机视频二进制（IndexedDB）。
  const onImported = useCallback(async (m) => {
    setSaving(true);
    try {
      const saved = await localMovies.importMovie({
        name: m.movieName || m.videoName || "未命名影片",
        original_title: m.originalTitle || "",
        poster_url: m.posterUrl || "",
        poster_blob: m.posterFile || null,
        video_url: (m.videoUrl && !m.videoUrl.startsWith("blob:")) ? m.videoUrl : "",
        subtitles: m.subtitles || [],
        ...(Object.prototype.hasOwnProperty.call(m, "folder") ? { folder: m.folder || "" } : {}),
      });
      const meta = saved.movie;
      // Persist the local handle before cloud sync so a network failure cannot
      // leave a saved local-library record without its playable source.
      let temporaryLocalFile = false;
      if (m.videoHandle) await saveLocalVideoHandle(meta.id, m.videoHandle);
      else if (m.videoFile && m.videoUrl?.startsWith("blob:")) {
        temporaryLocalFile = true;
        setTemporaryLocalVideoFile(meta.id, m.videoFile);
        meta.local_video_temporary = true;
        meta.local_video_storage = "device-file";
        try {
          const updated = await localMovies.update(meta.id, { local_video_temporary: temporaryLocalFile, local_video_storage: "device-file" });
          Object.assign(meta, updated);
        } catch { /* the selected File remains playable even if a status field cannot be written */ }
      }
      const localMediaHandles = {};
      if (m.directoryHandle) localMediaHandles.directoryHandle = m.directoryHandle;
      if (m.subtitleHandle) localMediaHandles.subtitleHandle = m.subtitleHandle;
      if (m.subtitleDirectoryHandle) localMediaHandles.subtitleDirectoryHandle = m.subtitleDirectoryHandle;
      if (Object.keys(localMediaHandles).length) await saveLocalMediaAssets(meta.id, localMediaHandles);
      let cloud = null;
      if (user?.id) cloud = await syncUserState(user.id);
      const after = await localMovies.list();
      const cloudMovie = user?.id
        ? (cloud?.data?.movies || []).find((movie) => movie?.id === meta.id)
        : null;
      if (typeof window !== "undefined") {
        window.__LINGOCLUB_MOVIE_IMPORT__ = {
          movieId: meta.id,
          videoId: saved.videoId,
          userId: user?.id || null,
          created: saved.created,
          beforeCount: saved.beforeCount,
          afterCount: after.length,
          cloudWritten: Boolean(cloud?.written),
          cloudMoviesCount: Array.isArray(cloud?.data?.movies) ? cloud.data.movies.length : null,
          cloudMovieConfirmed: user?.id ? Boolean(cloudMovie) : null,
          subtitleCount: Array.isArray(meta.subtitles) ? meta.subtitles.length : 0,
          recordedAt: new Date().toISOString(),
        };
      }
      if (user?.id && !cloudMovie) throw new Error("影片已保存到本机，但账号云端保存未确认，请勿关闭本页并重试");
      if (m.videoUrl && m.videoUrl.startsWith("blob:")) { try { URL.revokeObjectURL(m.videoUrl); } catch { /* noop */ } }
      if (m.posterUrl && m.posterUrl.startsWith("blob:")) { try { URL.revokeObjectURL(m.posterUrl); } catch { /* noop */ } }
      setShowImporter(false);
      setImportMode(null);
      await refreshLibrary();
      await openMeta(meta, false, m.videoHandle ? null : m.videoFile);
      if (temporaryLocalFile) toast({ title: "本地视频已关联", description: TEMP_VIDEO_NOTICE });
      return meta;
    } catch (e) {
      toast({ title: "保存影片失败", description: e?.message || "请稍后重试", variant: "destructive" });
      return null;
    } finally {
      setSaving(false);
    }
  }, [openMeta, refreshLibrary, revokeCurrent, toast, user?.id]);

  // The production bookmarklet opens this account-aware route. Supabase auth
  // is shared by the same origin, so localMovies writes to the active user's
  // namespace and the existing cloud-state listener syncs it to user_state.
  useEffect(() => {
    if (bookmarkletHandledRef.current || isLoadingAuth || searchParams.get("bookmarklet") !== "1") return;
    if (!user) {
      const returnTo = `${window.location.pathname}${window.location.search}`;
      window.location.href = `/login?returnTo=${encodeURIComponent(returnTo)}`;
      return;
    }
    bookmarkletHandledRef.current = true;
    let cancelled = false;
    const decode = (encoded) => {
      if (!encoded) return [];
      try {
        const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
        const parsed = JSON.parse(new TextDecoder("utf-8").decode(bytes));
        return (Array.isArray(parsed) ? parsed : []).map((line, index) => ({
          id: `bookmarklet-${Date.now()}-${index}`,
          text_en: cleanSubtitleText(line.text_en || line.text),
          text_zh: line.text_zh || "",
          speaker: "",
          time_start: line.time_start || secondsToTimecode(line.start),
          time_end: line.time_end || secondsToTimecode(Number(line.start) + Number(line.duration || 0)) || line.time_start || secondsToTimecode(line.start),
          timestamp: line.time_start || secondsToTimecode(line.start),
          order: index + 1,
        })).filter((line) => line.text_en);
      } catch { return []; }
    };
    (async () => {
      let encoded = searchParams.get("subs") || "";
      if (!encoded && window.opener && window.opener !== window) {
        const opener = window.opener;
        encoded = await new Promise((resolve) => {
          let settled = false;
          const handler = (event) => {
            if (event.source !== opener || event.data?.src !== "lt-bm") return;
            settled = true;
            window.removeEventListener("message", handler);
            resolve(event.data.subs || "");
          };
          window.addEventListener("message", handler);
          try { opener.postMessage("lt-ready", "*"); } catch { resolve(""); return; }
          setTimeout(() => {
            if (!settled) { window.removeEventListener("message", handler); resolve(""); }
          }, 5000);
        });
      }
      if (cancelled) return;
      const url = searchParams.get("url") || "";
      const title = searchParams.get("title") || "YouTube 视频";
      const saved = await onImported({ videoUrl: url, videoName: title, originalTitle: title, subtitles: decode(encoded), posterUrl: "" });
      if (saved) window.history.replaceState({}, "", "/local-study");
    })();
    return () => { cancelled = true; };
  }, [isLoadingAuth, onImported, searchParams, user]);

  const removeMeta = useCallback(async (id, { deleteCopiedMedia = true } = {}) => {
    if (materials?.recordId === id) {
      revokeCurrent();
      setMaterials(null);
    }
    await localMovies.delete(id);
    await deleteLocalVideo(id, { deleteCopiedMedia }).catch(() => {});
    await refreshLibrary();
  }, [materials?.recordId, revokeCurrent, refreshLibrary]);

  // 批量删除：一次 deleteMany + 一次刷新，避免逐条跳转
  const removeMetas = useCallback(async (ids, { deleteCopiedMedia = true } = {}) => {
    if (materials?.recordId && ids.includes(materials.recordId)) {
      revokeCurrent();
      setMaterials(null);
    }
    await localMovies.deleteMany(ids);
    await deleteLocalVideoMany(ids, { deleteCopiedMedia }).catch(() => {});
    await refreshLibrary();
  }, [materials?.recordId, revokeCurrent, refreshLibrary]);

  const removeSeason = useCallback(async (seasonId, episodeIds, { deleteCopiedMedia = true } = {}) => {
    if (materials?.recordId && episodeIds.includes(materials.recordId)) {
      revokeCurrent();
      setMaterials(null);
    }
    await localMovies.deleteMany(episodeIds);
    await localFolders.delete(seasonId);
    await deleteLocalVideoMany([...episodeIds, `folder:${seasonId}`], { deleteCopiedMedia }).catch(() => {});
    await Promise.all([refreshLibrary(), refreshFolders()]);
  }, [materials?.recordId, refreshFolders, refreshLibrary, revokeCurrent]);

  // 批量重新排序：接收重排后的 id 顺序，写入 sort_order
  const reorderMetas = useCallback(async (reorderedIds) => {
    try {
      await localMovies.bulkUpdate(
        reorderedIds.map((id, i) => ({ id, sort_order: i * 10 }))
      );
      await refreshLibrary();
    } catch (e) {
      toast({ title: "排序未保存", description: e?.message, variant: "destructive" });
    }
  }, [refreshLibrary, toast]);

  // 批量移动到文件夹（folder 为 StudyFolder 实体 ID）
  const moveToFolder = useCallback(async (ids, folderId) => {
    try {
      await localMovies.bulkUpdate(
        ids.map((id) => ({ id, folder: folderId }))
      );
      await refreshLibrary();
    } catch (e) {
      toast({ title: "移动失败", description: e?.message, variant: "destructive" });
    }
  }, [refreshLibrary, toast]);

  // ===== 文件夹 CRUD =====
  const createFolder = useCallback(async (name, tabType) => {
    try {
      const folder = await localFolders.create({ name, tab_type: tabType, sort_order: Date.now() });
      await refreshFolders();
      return folder;
    } catch (e) {
      toast({ title: "创建文件夹失败", description: e?.message, variant: "destructive" });
      return null;
    }
  }, [refreshFolders, toast]);

  const createAlbum = useCallback(async ({ name, coverFile, coverUrl }) => {
    try {
      const current = (await localFolders.list()).filter((folder) => folder.tab_type === "films");
      const nextOrder = Math.max(0, ...current.map((folder) => Number(folder.sort_order) || 0)) + 10;
      const album = await localFolders.create({
        name,
        display_title: name,
        show_title: name,
        project_type: "season",
        tab_type: "films",
        season_number: null,
        cover_blob: coverFile || null,
        cover_url: coverFile ? "" : (coverUrl || ""),
        sort_order: nextOrder,
      });
      await Promise.all([refreshFolders(), syncUserState().catch(() => {})]);
      return album;
    } catch (error) {
      toast({ title: "创建影集失败", description: error?.message || "请稍后重试", variant: "destructive" });
      return null;
    }
  }, [refreshFolders, toast]);

  const updateAlbum = useCallback(async (folderId, { name, coverFile, coverUrl, coverChanged }) => {
    try {
      const fields = { name, display_title: name, show_title: name };
      if (coverChanged) {
        if (coverFile) fields.cover_blob = coverFile;
        else {
          await removeLocalMediaAssetFields(`folder:${folderId}`, ["posterBlob", "coverBlob", "posterHandle", "coverHandle"]);
          fields.cover_blob = null;
          fields.cover_id = null;
          fields.cover_url = coverUrl || "";
        }
      }
      await localFolders.update(folderId, fields);
      await Promise.all([refreshFolders(), syncUserState().catch(() => {})]);
    } catch (error) {
      toast({ title: "影集未保存", description: error?.message || "请稍后重试", variant: "destructive" });
    }
  }, [refreshFolders, toast]);

  const reorderLocalLibrary = useCallback(async (type, orderedIds) => {
    const updates = orderedIds.map((id, index) => ({ id, sort_order: (index + 1) * 10 }));
    const updateState = (records) => {
      const byId = new Map(updates.map(({ id, sort_order }) => [id, sort_order]));
      return records.map((record) => byId.has(record.id) ? { ...record, sort_order: byId.get(record.id) } : record);
    };
    if (type === "season") setFolders(updateState);
    else setMetas(updateState);
    try {
      if (type === "season") await localFolders.bulkUpdate(updates);
      else await localMovies.bulkUpdate(updates);
      await syncUserState().catch(() => {});
    } catch (error) {
      toast({ title: "顺序已保留在当前页面，稍后再试保存", description: error?.message || "本地排序写入失败", variant: "destructive" });
    }
  }, [toast]);

  const renameFolder = useCallback(async (folderId, newName) => {
    try {
      await localFolders.update(folderId, { name: newName });
      await refreshFolders();
    } catch (e) {
      toast({ title: "重命名失败", description: e?.message, variant: "destructive" });
    }
  }, [refreshFolders, toast]);

  const setFolderCover = useCallback(async (folderId, file) => {
    try {
      await localFolders.update(folderId, { cover_blob: file });
      await refreshFolders();
    } catch (e) {
      toast({ title: "设置封面失败", description: e?.message, variant: "destructive" });
    }
  }, [refreshFolders, toast]);

  const deleteFolder = useCallback(async (folderId) => {
    try {
      const itemsInFolder = metas.filter((m) => m.folder === folderId);
      if (itemsInFolder.length > 0) {
        await localMovies.bulkUpdate(
          itemsInFolder.map((m) => ({ id: m.id, folder: "" }))
        );
      }
      await localFolders.delete(folderId);
      await Promise.all([refreshFolders(), refreshLibrary()]);
    } catch (e) {
      toast({ title: "删除文件夹失败", description: e?.message, variant: "destructive" });
    }
  }, [metas, refreshFolders, refreshLibrary, toast]);

  // 字幕改动：同步到 materials（即时刷新学习视图）+ 持久化到 LocalMovieMeta.subtitles。
  const onSubsChanged = useCallback(async (newSubs, sourceName) => {
    const id = materials?.recordId;
    if (!id) return;
    const importedAt = sourceName ? new Date().toISOString() : undefined;
    const fields = {
      subtitles: newSubs.map((cue) => ({ ...cue })),
      ...(sourceName ? { subtitle_source_name: sourceName, subtitle_imported_at: importedAt } : {}),
      subtitle_count: newSubs.length,
    };
    setMaterials((m) => (m?.recordId === id ? { ...m, subtitles: fields.subtitles, subtitleSourceName: sourceName || m.subtitleSourceName, subtitleImportedAt: importedAt || m.subtitleImportedAt } : m));
    setMetas((current) => replaceEpisodeSubtitlesInList(current, id, fields.subtitles, fields));
    try {
      await localMovies.update(id, fields);
    } catch (e) {
      toast({ title: "字幕未保存到本机", description: e?.message, variant: "destructive" });
    }
  }, [materials?.recordId, toast]);

  const resetImport = () => {
    revokeCurrent();
    setMaterials(null);
  };

  const saveTitle = async () => {
    const id = materials?.recordId;
    const newName = titleDraft.trim() || "未命名影片";
    if (!id || newName === materials.videoName) { setEditingTitle(false); return; }
    setSavingTitle(true);
    try {
      await localMovies.update(id, { name: newName });
      setMaterials((m) => (m ? { ...m, videoName: newName } : m));
      setMetas((list) => list.map((mt) => (mt.id === id ? { ...mt, name: newName } : mt)));
      setEditingTitle(false);
    } catch (e) {
      toast({ title: "标题保存失败", description: e?.message, variant: "destructive" });
    } finally {
      setSavingTitle(false);
    }
  };

  const resetTitle = async () => {
    const id = materials?.recordId;
    const orig = materials?.originalTitle;
    if (!id || !orig) return;
    setSavingTitle(true);
    try {
      await localMovies.update(id, { name: orig });
      setMaterials((m) => (m ? { ...m, videoName: orig } : m));
      setMetas((list) => list.map((mt) => (mt.id === id ? { ...mt, name: orig } : mt)));
      setTitleDraft(orig);
    } catch (e) {
      toast({ title: "重置失败", description: e?.message, variant: "destructive" });
    } finally {
      setSavingTitle(false);
    }
  };

  // ===== 库视图 =====
  if (!materials) {
    if (showImporter) {
      if (importMode === "youtube") {
        return <YoutubeLinkImporter onReady={onImported} onCancel={() => { setShowImporter(false); setImportMode(null); }} saving={saving} />;
      }
      if (importMode === "season") {
        return <LocalSeasonImporter onReady={onSeasonBatchReady} onCancel={() => { setShowImporter(false); setImportMode(null); }} saving={saving} />;
      }
      return <LocalStudyImporter onReady={onImported} onCancel={() => { setShowImporter(false); setImportMode(null); }} saving={saving} />;
    }
    return (
      <LocalStudyLibrary
        metas={metas}
        folders={folders}
        loading={loadingLib}
        onOpen={openMeta}
        onDelete={removeMeta}
        onDeleteMany={removeMetas}
        onDeleteSeason={removeSeason}
        onReorder={reorderMetas}
        onReorderLocal={reorderLocalLibrary}
        onMoveToFolder={moveToFolder}
        onCreateFolder={createFolder}
        onCreateAlbum={createAlbum}
        onUpdateAlbum={updateAlbum}
        onRenameFolder={renameFolder}
        onSetFolderCover={setFolderCover}
        onDeleteFolder={deleteFolder}
        requireAuth={requireAuth}
        onImportLocal={() => { setImportMode("local"); setShowImporter(true); }}
        onImportSeason={() => { setImportMode("season"); setShowImporter(true); }}
        onOrganizeAsSeason={createSeasonFromSelection}
        onAssignEpisode={assignEpisodeToSeason}
        onUpdateEpisodeNumber={updateEpisodeNumber}
        onSetSeasonCover={setSeasonCover}
        onImportYoutube={() => { setImportMode("youtube"); setShowImporter(true); }}
        onPublishFolder={null}
        onUnpublishFolder={null}
      />
    );
  }

  // ===== 学习视图 =====
  const hasSubs = (materials?.subtitles?.length || 0) > 0;
  const canPlay = !!materials?.videoUrl;
  const isYouTube = /youtube\.com|youtu\.be/i.test(materials?.videoUrl || "");
  const bilibiliDuration = Math.max((materials?.subtitles || []).reduce((m, s) => Math.max(m, toSec(s.time_end || s.time_start) || 0), 0) + 5, 1320);

  const videoSlot = (
    <div>
      {isBilibili && !theater && (
        <div className="mb-2 flex items-start gap-2 rounded-lg border border-mint/30 bg-mint/10 px-3 py-2 text-xs leading-relaxed text-foreground/90">
          <Info size={13} className="mt-0.5 shrink-0 text-mint" />
          <span>请使用下方的进度条 / 播放键控制 B 站。</span>
        </div>
      )}
      <div className="relative">
        {canPlay ? (
          <>
            <VideoPlayer ref={videoRef} url={materials.videoUrl} autoPlayFrom={materials.pendingSourceStart} onTimeUpdate={(time) => {
              setCurrentTime(time);
              if (Number.isFinite(materials.pendingSourceStart) && time >= materials.pendingSourceStart - 0.1) setMaterials((current) => current ? { ...current, pendingSourceStart: null } : current);
            }} onUserSeek={onExternalSeek} onPlaybackError={() => toast({ title: "视频无法播放", description: "该格式可能不被浏览器支持（推荐 MP4 / WebM / MOV）；或文件已损坏。", variant: "destructive" })} />
            {materials.legacyVideoCopy && !theater && <button type="button" onClick={relinkOriginalVideo} className="absolute right-2 top-2 z-40 rounded-full bg-black/70 px-3 py-1.5 text-[11px] text-white hover:bg-black/90">重新选择本地视频</button>}
            {isBilibili && !isPhone && !maskOn && (
              <button
                type="button"
                onClick={toggleClock}
                title={clockRunning ? "暂停" : "播放"}
                className={`group absolute inset-0 z-30 flex cursor-pointer items-center justify-center transition-colors ${clockRunning ? "bg-transparent hover:bg-black/5" : "bg-black/35 hover:bg-black/30"}`}
              >
                {clockRunning ? (
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
                    <Pause size={22} />
                  </span>
                ) : (
                  <span className="flex h-16 w-16 items-center justify-center rounded-full bg-mint text-background shadow-lg shadow-mint/30 transition-transform group-hover:scale-105">
                    <Play size={26} className="ml-1" />
                  </span>
                )}
              </button>
            )}
            {maskOn && <SubtitleMask />}
            <button
              type="button"
              onClick={() => setMaskOn((v) => !v)}
              title={maskOn ? "移除字幕遮挡" : "添加字幕遮挡"}
              className="group absolute left-2 top-2 z-40 inline-flex items-center gap-1 rounded-full p-1.5 text-white/40 transition-all hover:bg-black/45 hover:text-white/90"
            >
              <EyeOff size={15} className="drop-shadow" />
              <span className="pointer-events-none max-w-0 overflow-hidden whitespace-nowrap text-xs font-medium opacity-0 transition-all duration-200 group-hover:ml-1 group-hover:max-w-[140px] group-hover:opacity-100">
                {maskOn ? "字幕遮挡 关" : "字幕遮挡 开"}
              </span>
            </button>
          </>
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-xl border border-dashed border-border bg-background-elev/30 text-center">
            <div>
              <Film size={28} className="mx-auto text-muted-foreground/60" />
            <input ref={relinkFileInputRef} type="file" accept="video/*,.mp4,.webm,.mov,.m4v,.mkv,.avi" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void relinkWithBrowserFile(file); event.target.value = ""; }} />
            <p className="mt-3 text-sm text-muted-foreground">当前设备未找到视频</p>
            <p className="mt-1 text-xs text-muted-foreground">影片、字幕、收藏和学习进度仍保留。请选择此设备上的原视频以继续播放。</p>
            <div className="mt-3 flex justify-center gap-2">
      {materials.mediaAccess?.permissionRequired && <button type="button" onClick={requestVideoPermission} className="rounded-full border border-border px-3 py-1.5 text-xs text-foreground">允许访问本地视频</button>}
              <button type="button" onClick={relinkOriginalVideo} className="rounded-full bg-copper px-3 py-1.5 text-xs font-medium text-copper-foreground">重新选择本地视频</button>
            </div>
            </div>
          </div>
        )}
        {!theater && canPlay && (
          <button
            type="button"
            onClick={openTheater}
            title="全屏沉浸学习"
            className="group absolute right-2 top-2 z-40 inline-flex items-center gap-1 rounded-full bg-black/45 p-1.5 text-white/80 backdrop-blur-sm transition-all hover:bg-black/70 hover:text-white"
          >
            <Maximize2 size={15} className="drop-shadow" />
          </button>
        )}
      </div>
      {isBilibili && !isPhone && canPlay && (
        <BilibiliScrubber
          mobile={false}
          value={studyTime}
          duration={bilibiliDuration}
          running={clockRunning}
          onToggleRun={toggleClock}
          onDrag={(v) => { study.exitCloseReading(); setSimTime(v); }}
          onRelease={(v) => { study.exitCloseReading(); if (clockRunning) playFromLine(v); else seekAndPause(v); }}
        />
      )}
      {isYouTube && !hasSubs && (
        <YoutubeSubtitleHelper />
      )}
    </div>
  );

  const subtitleSlot = (
    <div>
      <SubListResizer height={subHeight} onChange={setSubHeight} />
      {canPlay && hasSubs ? (
        <SubtitleScrubber study={study} movieId={materials.recordId} sourceRecordId={materials.recordId} sourceUrl={materials.videoUrl} movieTitle={materials.videoName} videoId={extractYouTubeId(materials.videoUrl) || materials.recordId || "local"} sourceType={extractYouTubeId(materials.videoUrl) ? "youtube" : "local"} editable={false} listHeight={subHeight} focusRequest={transcriptFocus.focusRequest} />
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-background-elev/30 p-8 text-center text-sm text-muted-foreground">
          {canPlay ? "本集暂无台词——到下方「字幕管理」添加字幕即可进入逐句精读。" : "本机无视频时无法跳转台词；下方「字幕管理」仍可提前维护字幕内容。"}
        </div>
      )}
    </div>
  );

  const analysisSlot = (
    <div className={`h-full rounded-2xl border border-border/60 bg-background-elev/30 p-4 scrollbar-none ${theater ? "overflow-y-auto" : "lg:sticky lg:top-24 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto"}`}>
      <StudyAnalysisColumn study={study} movieTitle={materials.videoName || "未命名影片"} movieId={materials.recordId} sourceRecordId={materials.recordId} sourceUrl={materials.videoUrl} videoId={extractYouTubeId(materials.videoUrl) || materials.recordId || "local"} sourceType={extractYouTubeId(materials.videoUrl) ? "youtube" : "local"} />
    </div>
  );

  if (theater) {
    return (
      <TheaterOverlay
        canPlay={canPlay}
        hasSubs={hasSubs}
        onClose={closeTheater}
        storagePrefix="theater_local"
        videoSlot={videoSlot}
        analysisSlot={analysisSlot}
        subtitleSlot={subtitleSlot}
        minimalSubSlot={<MinimalSubtitleBar study={study} movieId={materials.recordId} sourceRecordId={materials.recordId} sourceUrl={materials.videoUrl} videoId={extractYouTubeId(materials.videoUrl) || materials.recordId || "local"} movieTitle={materials.videoName} sourceType={extractYouTubeId(materials.videoUrl) ? "youtube" : "local"} storageKey="theater_min_sub_y" storageSizeKey="theater_local_min_sub_size" />}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 lg:px-10 pt-20 pb-16 md:pt-28 md:pb-20">
      <PageBackButton onClick={() => {
        const context = searchParams.get("returnContext");
        if (context === "review") navigate("/collection?resumeReview=1");
        else if (context === "mistakes") navigate("/collection?tab=errors&restore=1");
        else if (context === "collection") navigate("/collection?restore=1");
        else if (window.history.state?.lingoclubLocalPlayer) window.history.back();
        else resetImport();
      }} className="mb-3" />

      <div className="mt-4 border-b border-border/50 pb-5 md:mt-6 md:pb-8">
        <p className="text-[11px] uppercase tracking-luxe text-copper/80">我的影片 · 本机</p>
        {editingTitle ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") setEditingTitle(false); }}
              autoFocus
              className="flex-1 min-w-[200px] rounded-lg border border-copper/50 bg-background/60 px-3 py-2 font-display text-xl text-foreground focus:outline-none md:text-2xl"
              placeholder="输入影片标题"
            />
            <button type="button" onClick={saveTitle} disabled={savingTitle} className="inline-flex items-center gap-1.5 rounded-full bg-copper px-4 py-2 text-sm font-medium text-copper-foreground disabled:opacity-50">
              {savingTitle ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} 保存
            </button>
            <button type="button" onClick={() => { setEditingTitle(false); setTitleDraft(materials.videoName || ""); }} className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
              <X size={14} /> 取消
            </button>
            {materials.originalTitle && materials.originalTitle !== titleDraft && (
              <button type="button" onClick={resetTitle} disabled={savingTitle} className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm text-muted-foreground hover:text-copper">
                <RotateCw size={13} /> 重置为原始标题
              </button>
            )}
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-2">
            <h1 className="font-display text-xl leading-tight text-foreground md:text-3xl line-clamp-2 flex-1">
              {materials.videoName || "未命名影片"}
            </h1>
            <button type="button" onClick={() => { setTitleDraft(materials.videoName || ""); setEditingTitle(true); }} title="编辑标题" className="shrink-0 text-muted-foreground/50 transition-colors hover:text-copper">
              <Pencil size={16} />
            </button>
          </div>
        )}
        {materials.originalTitle && materials.originalTitle !== materials.videoName && !editingTitle && (
          <p className="mt-1 text-xs text-muted-foreground/60">原始标题：{materials.originalTitle}</p>
        )}
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-foreground md:mt-3 md:text-sm">影片名称、字幕、收藏与学习进度会随账号同步。本地视频只从当前设备读取，不会上传。</p>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground md:mt-3"><RotateCcw size={12} /> {materials?.hasLocalVideo ? "本地视频文件 · 仅本机播放" : "在线视频链接 · 跨设备可播"}</p>
      </div>

      {isPhone ? (
        <div className="mt-4 space-y-3">
          {videoSlot}
          {subtitleSlot}
          <div className="mt-2">{analysisSlot}</div>
        </div>
      ) : (
        <div className="mt-8">
          <StudyWorkspace videoSlot={videoSlot} subtitleSlot={subtitleSlot} analysisSlot={analysisSlot} />
        </div>
      )}

      <div className="mt-10">
        <h2 className="font-display text-lg text-foreground">台词和字幕管理 <span className="text-sm font-body text-muted-foreground">· 当前影片</span></h2>
        <p className="mt-1 text-xs text-muted-foreground">视频链接抓取 / 粘贴·文件导入 / OCR 扫描 / 手动逐句，四种方式统一在这里管理。字幕和学习资料会随账号同步。</p>
        <div className="mt-4">
          <SubtitleWorkbench
            videoRef={videoRef}
            videoUrl={materials.videoUrl || ""}
            subs={materials.subtitles || []}
            onChanged={onSubsChanged}
            onSeek={canPlay ? (sec) => { study.exitCloseReading(); seekAndPause(sec); } : null}
            canPlay={canPlay}
            targetTitle={materials.videoName || "当前影片"}
            targetSeasonNumber={metas.find((meta) => meta.id === materials.recordId)?.season_number}
            targetEpisodeNumber={metas.find((meta) => meta.id === materials.recordId)?.episode_number}
            subtitleSourceName={materials.subtitleSourceName || ""}
          />
        </div>
      </div>
      </div>
      );
}
