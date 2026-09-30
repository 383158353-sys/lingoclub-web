import React, { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useLocalStudy } from "@/hooks/useLocalStudy";
import VideoPlayer from "@/components/study/VideoPlayer";
import SubtitleScrubber from "@/components/study/SubtitleScrubber";
import StudyAnalysisColumn from "@/components/study/StudyAnalysisColumn";
import StudyWorkspace from "@/components/study/StudyWorkspace";
import SubListResizer from "@/components/study/SubListResizer";
import SubtitleMask from "@/components/study/SubtitleMask";
import SubtitleWorkbench from "@/components/study/SubtitleWorkbench";
import MinimalSubtitleBar from "@/components/study/MinimalSubtitleBar";
import TheaterOverlay from "@/components/study/TheaterOverlay";
import BilibiliScrubber from "@/components/study/BilibiliScrubber";
import YoutubeSubtitleHelper from "@/components/study/YoutubeSubtitleHelper";
import { transcribeYouTubeClient, extractYouTubeId } from "@/lib/youtubeTranscriptClient";
import { cleanSubtitleText } from "@/lib/subtitleCleaner";
import { isBilibiliUrl } from "@/lib/bilibiliTranscriptClient";
import { useToast } from "@/components/ui/use-toast";
import { ArrowLeft, Maximize2, Loader2, EyeOff, Play, Pause, AlertCircle, BookOpen, ExternalLink } from "lucide-react";
import { useGlobalVideoSpace } from "@/hooks/useGlobalVideoSpace";
import { toSec } from "@/lib/timecode";
import { useTranscriptCueFocus } from "@/hooks/useTranscriptCueFocus";

// 快速导入学习页：由浏览器扩展跳转进入。
// URL 参数：
//   url   — 视频 YouTube/B站 链接
//   title — 视频标题
//   subs  — base64 编码的 JSON 字幕数组（扩展端已提取好，可选）
//
// 有 subs 时直接使用（扩展端同源提取，100% 成功）；
// 无 subs 时回退到站内 transcribeYouTubeClient / transcribeBilibiliClient 抓取。
// 字幕就绪后自动创建 LocalMovieMeta 记录，可在「我的影片」中找到。
export default function QuickStudy() {
  const [searchParams] = useSearchParams();
  const videoUrl = searchParams.get("url");
  const title = searchParams.get("title") || "快速导入视频";
  const subsB64 = searchParams.get("subs");

  const [materials, setMaterials] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [needsOcr, setNeedsOcr] = useState(false);
  const [currentTime, setCurrentTime] = useState(null);
  const [simTime, setSimTime] = useState(null);
  const [clockRunning, setClockRunning] = useState(false);
  const [loopRange, setLoopRange] = useState(null);
  const loopRangeRef = useRef(null);
  const [subHeight, setSubHeight] = useState(() => {
    try { const v = parseInt(localStorage.getItem("study_sub_h"), 10); return Number.isFinite(v) && v ? v : 256; } catch { return 256; }
  });
  const [isPhone, setIsPhone] = useState(() => (typeof window !== "undefined" ? Math.min(window.innerWidth, window.innerHeight) < 768 : false));
  const [theater, setTheater] = useState(false);
  const [maskOn, setMaskOn] = useState(false);
  const videoRef = useRef(null);
  const { toast } = useToast();
  const { user } = useAuth();

  const isBili = isBilibiliUrl(videoUrl);

  useEffect(() => { try { localStorage.setItem("study_sub_h", String(subHeight)); } catch { /* noop */ } }, [subHeight]);
  useEffect(() => {
    const on = () => setIsPhone(Math.min(window.innerWidth, window.innerHeight) < 768);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  // 挂载时：解码扩展字幕或回退抓取
  useEffect(() => {
    if (!videoUrl) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      let subs = [];

      // 1. 优先使用扩展端提取的字幕（base64 JSON）
      if (subsB64) {
        try {
          const b64Raw = atob(subsB64);
          const bytes = Uint8Array.from(b64Raw, (c) => c.charCodeAt(0));
          const json = new TextDecoder("utf-8").decode(bytes);
          const parsed = JSON.parse(json);
          subs = parsed.map((l, i) => ({
            id: `ext-${Date.now()}-${i}`,
            text_en: cleanSubtitleText(l.text_en),
            text_zh: l.text_zh || "",
            speaker: "",
            time_start: l.time_start || "",
            time_end: l.time_end || "",
            order: i + 1,
            timestamp: l.time_start || "",
          })).filter((l) => l.text_en);
        } catch (e) {
          console.warn("Failed to decode extension subs", e);
        }
      }

      // 1b. 无URL字幕但有opener（书签大数据模式）：通过postMessage接收
      if (!subs.length && window.opener && window.opener !== window) {
        try {
          const opener = window.opener;
          const pmSubs = await new Promise((resolve) => {
            let settled = false;
            const handler = (event) => {
              if (event.source !== opener) return;
              if (event.data?.src === 'lt-bm' && event.data.subs) {
                settled = true;
                window.removeEventListener('message', handler);
                resolve(event.data.subs);
              }
            };
            window.addEventListener('message', handler);
            try { opener.postMessage('lt-ready', '*'); } catch { resolve(null); return; }
            setTimeout(() => {
              if (!settled) { window.removeEventListener('message', handler); resolve(null); }
            }, 5000);
          });
          if (pmSubs && !cancelled) {
            try {
              const b64Raw = atob(pmSubs);
              const bytes = Uint8Array.from(b64Raw, (c) => c.charCodeAt(0));
              const json = new TextDecoder("utf-8").decode(bytes);
              const parsed = JSON.parse(json);
              subs = parsed.map((l, i) => ({
                id: `ext-${Date.now()}-${i}`,
                text_en: cleanSubtitleText(l.text_en),
                text_zh: l.text_zh || "",
                speaker: "",
                time_start: l.time_start || "",
                time_end: l.time_end || "",
                order: i + 1,
                timestamp: l.time_start || "",
              })).filter((l) => l.text_en);
            } catch (e) {
              console.warn("Failed to decode postMessage subs", e);
            }
          }
        } catch { /* fall through to auto-fetch */ }
      }

      // 2. 无扩展字幕时回退到站内抓取（15s 超时，避免长时间卡在加载中）
      if (!subs.length) {
        if (extractYouTubeId(videoUrl)) {
          try {
            const res = await Promise.race([
              transcribeYouTubeClient(videoUrl),
              new Promise((_, reject) => setTimeout(() => reject(new Error("提取超时")), 15000)),
            ]);
            if (!cancelled && res.lines) {
              subs = res.lines.map((l, i) => ({
                id: `yt-${Date.now()}-${i}`,
                text_en: cleanSubtitleText(l.text_en),
                text_zh: "",
                speaker: "",
                time_start: l.time_start || "",
                time_end: l.time_end || "",
                order: i + 1,
                timestamp: l.time_start || "",
              })).filter((l) => l.text_en);
            } else if (!cancelled && res.error) {
              setFetchError(res.error);
            }
          } catch (e) {
            if (!cancelled) setFetchError(e?.message || "提取超时");
          }
        } else if (isBilibiliUrl(videoUrl)) {
          // B站：跨域 iframe 无法自动截帧，直接进入 OCR 手动截图模式
          setNeedsOcr(true);
        }
      }

      if (cancelled) return;

      // 3. 已登录则保存到 LocalMovieMeta（跨设备可见）
      let recordId = null;
      if (user) {
        try {
          const meta = await base44.entities.LocalMovieMeta.create({
            name: title,
            poster_url: "",
            video_url: videoUrl,
            subtitles: subs,
          });
          recordId = meta.id;
        } catch { /* non-critical */ }
      }

      if (cancelled) return;

      setMaterials({
        videoUrl,
        videoName: title,
        subtitles: subs,
        posterUrl: "",
        recordId,
        hasLocalVideo: false,
      });
      setLoading(false);

      if (subs.length > 0) {
        toast({ title: `已导入 ${subs.length} 条字幕`, description: "可以开始逐句精读了。" });
      } else if (needsOcr) {
        toast({ title: "B站视频需 OCR 识别字幕", description: "请在下方「字幕管理」中上传视频截图，AI 自动识别字幕文本。", duration: 8000 });
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl, subsB64, title]);

  // B站仿真时钟（跨域 iframe 无法读取真实进度）
  useEffect(() => {
    if (!isBili || !clockRunning) return;
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
  }, [isBili, clockRunning]);

  const studyTime = isBili ? simTime : currentTime;

  const seekAndPause = useCallback((sec) => {
    if (!Number.isFinite(sec)) return;
    if (isBili) { setSimTime(sec); setClockRunning(false); }
    const api = videoRef.current;
    if (api?.pause) api.pause(sec);
    else if (api) { try { api.currentTime = sec; } catch { /* noop */ } }
  }, [isBili]);

  const playFromLine = useCallback((sec) => {
    if (!Number.isFinite(sec)) return;
    if (isBili) { setSimTime(sec); setClockRunning(true); }
    const api = videoRef.current;
    if (api?.play) api.play(sec);
    else if (api) { try { api.currentTime = sec; api.play?.(); } catch { /* noop */ } }
  }, [isBili]);

  const playOnly = useCallback(() => {
    if (isBili) setClockRunning(true);
    videoRef.current?.playOnly?.();
  }, [isBili]);

  const toggleClock = useCallback(() => {
    if (isBili) {
      const t = simTime ?? currentTime ?? videoRef.current?.getCurrentTime?.() ?? 0;
      if (clockRunning || videoRef.current?.isPlaying?.()) {
        setClockRunning(false);
        videoRef.current?.pause?.(t);
      } else {
        setSimTime(t);
        setClockRunning(true);
        videoRef.current?.play?.(t);
      }
      return;
    }
    if (videoRef.current?.isPlaying?.()) videoRef.current.pauseOnly?.();
    else videoRef.current?.playOnly?.();
  }, [clockRunning, currentTime, isBili, simTime]);

  const onStudyEnter = useCallback((sub) => {
    const start = toSec(sub.time_start);
    const end = toSec(sub.time_end);
    if (Number.isNaN(start)) return;
    let safeEnd = !Number.isNaN(end) && end > start ? end : NaN;
    if (Number.isNaN(safeEnd)) {
      let nextStart = NaN;
      for (const item of materials?.subtitles || []) {
        const candidate = toSec(item.time_start);
        if (!Number.isNaN(candidate) && candidate > start && (Number.isNaN(nextStart) || candidate < nextStart)) nextStart = candidate;
      }
      if (!Number.isNaN(nextStart) && nextStart > start) safeEnd = nextStart;
    }
    if (Number.isNaN(safeEnd) || safeEnd <= start) {
      const wordCount = (sub.text_en || "").split(/\s+/).filter(Boolean).length;
      safeEnd = start + Math.max(3, wordCount * 0.45);
    }
    const nextLoop = { start, end: safeEnd + 0.3 };
    loopRangeRef.current = nextLoop;
    setLoopRange(nextLoop);
    playFromLine(start);
  }, [materials?.subtitles, playFromLine]);
  const onStudyExit = useCallback(() => {
    loopRangeRef.current = null;
    setLoopRange(null);
  }, []);

  const onSubsChanged = useCallback(async (newSubs) => {
    setMaterials((m) => (m ? { ...m, subtitles: newSubs } : m));
    const id = materials?.recordId;
    if (!id) return;
    try {
      await base44.entities.LocalMovieMeta.update(id, { subtitles: newSubs });
    } catch (e) {
      toast({ title: "字幕未保存到服务器", description: e?.message, variant: "destructive" });
    }
  }, [materials?.recordId, toast]);

  const study = useLocalStudy({
    subtitles: materials?.subtitles,
    currentTime: studyTime,
    onSeek: seekAndPause,
    onPlay: playFromLine,
    onPlayOnly: playOnly,
    onStudyEnter,
    onStudyExit,
  });
  const onExternalSeek = useCallback((time) => {
    const activeLoop = loopRangeRef.current;
    if (activeLoop && (time < activeLoop.start - 0.05 || time > activeLoop.end + 0.35)) study.exitCloseReading();
  }, [study.exitCloseReading]);

  useEffect(() => {
    const activeLoop = loopRangeRef.current;
    if (activeLoop && loopRange && studyTime != null && studyTime >= activeLoop.end) playFromLine(activeLoop.start);
  }, [loopRange, playFromLine, studyTime]);

  const transcriptFocus = useTranscriptCueFocus({ subtitles: study.subs, videoRef, fallbackTime: studyTime, setActiveId: study.setActiveId });
  const startCloseReadingFromKeyboard = useCallback(() => {
    const cue = transcriptFocus.focusCurrentTranscriptCue();
    if (cue) study.toggleCloseReading(cue);
  }, [study.toggleCloseReading, transcriptFocus.focusCurrentTranscriptCue]);
  useGlobalVideoSpace({
    togglePlayback: toggleClock,
    enabled: Boolean(materials?.videoUrl),
    isCloseReadingLoop: study.isCloseReadingLoop,
    exitCloseReading: study.exitCloseReading,
    startCloseReading: startCloseReadingFromKeyboard,
    focusCurrentCue: transcriptFocus.focusCurrentTranscriptCue,
  });

  const openTheater = useCallback(async () => {
    setTheater(true);
    try {
      if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen?.();
      if (isPhone && window.screen?.orientation?.lock) await window.screen.orientation.lock("landscape");
    } catch { /* noop */ }
  }, [isPhone]);
  const closeTheater = useCallback(async () => {
    setTheater(false);
    try { if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen(); } catch { /* noop */ }
  }, []);

  // 全屏切换后恢复播放进度
  useEffect(() => {
    if (!materials?.videoUrl) return;
    const t = isBili ? simTime : currentTime;
    if (t == null || t < 0.5) return;
    let cancelled = false;
    const restore = () => {
      if (cancelled) return;
      const api = videoRef.current;
      if (!api) { setTimeout(restore, 200); return; }
      if (isBili) {
        if (clockRunning) api.play(t);
        else api.pause(t);
      } else {
        api.seek(t);
      }
    };
    const timer = setTimeout(restore, isBili ? 300 : 500);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theater]);

  // ===== 加载中 =====
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <Loader2 size={32} className="mx-auto animate-spin text-copper" />
          <p className="mt-4 text-sm text-muted-foreground">正在提取字幕…</p>
          <p className="mt-1 text-xs text-muted-foreground/60">如果超过 15 秒未响应，将自动切换到手动提取模式</p>
        </div>
      </div>
    );
  }

  // ===== 无 URL =====
  if (!videoUrl) {
    return (
      <div className="mx-auto w-full max-w-2xl px-5 pt-28 pb-20 text-center">
        <AlertCircle size={32} className="mx-auto text-muted-foreground/60" />
        <h1 className="mt-4 font-display text-2xl text-foreground">未检测到视频链接</h1>
        <p className="mt-2 text-sm text-muted-foreground">请通过浏览器扩展在 YouTube / B站 视频页面点击「导入学习」按钮。</p>
        <Link to="/extension" className="mt-6 inline-flex items-center gap-2 rounded-full bg-copper px-5 py-2.5 text-sm font-medium text-copper-foreground">
          <BookOpen size={16} /> 查看扩展安装指南
        </Link>
      </div>
    );
  }

  const hasSubs = (materials?.subtitles?.length || 0) > 0;
  const canPlay = !!materials?.videoUrl;

  const biliDuration = Math.max(
    (materials?.subtitles || []).reduce((m, s) => {
      const e = parseFloat(s.time_end || s.time_start || "0");
      return Number.isFinite(e) ? Math.max(m, e) : m;
    }, 0) + 5,
    1320
  );

  const videoSlot = (
    <div>
      <div className="relative">
        <VideoPlayer ref={videoRef} url={materials.videoUrl} onTimeUpdate={setCurrentTime} onUserSeek={onExternalSeek} />
        {isBili && !isPhone && !maskOn && (
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
        {!theater && canPlay && (
          <button
            type="button"
            onClick={openTheater}
            title="全屏沉浸学习"
            className="group absolute right-2 top-2 z-40 inline-flex items-center gap-1 rounded-full bg-black/45 p-1.5 text-white/80 backdrop-blur-sm transition-all hover:bg-black/70 hover:text-white"
          >
            <Maximize2 size={15} className="drop-shadow" />
            <span className="pointer-events-none max-w-0 overflow-hidden whitespace-nowrap text-xs font-medium opacity-0 transition-all duration-200 group-hover:ml-1 group-hover:max-w-[120px] group-hover:opacity-100">
              全屏
            </span>
          </button>
        )}
      </div>
    </div>
  );

  const subtitleSlot = (
    <div className="mt-3">
      {isBili && !isPhone && (
        <BilibiliScrubber
          mobile={false}
          value={studyTime}
          duration={biliDuration}
          running={clockRunning}
          onToggleRun={toggleClock}
          onDrag={(v) => { study.exitCloseReading(); setSimTime(v); }}
          onRelease={(v) => { study.exitCloseReading(); if (clockRunning) playFromLine(v); else seekAndPause(v); }}
        />
      )}
      {hasSubs ? (
        <SubtitleScrubber study={study} editable={false} listHeight={subHeight} focusRequest={transcriptFocus.focusRequest} />
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-background-elev/30 p-6 text-sm leading-relaxed text-muted-foreground">
          {fetchError ? (
            <div className="space-y-3">
              <p className="text-center text-amber-300/90">字幕自动提取失败：{fetchError}</p>
              <p className="text-center text-xs text-muted-foreground">YouTube 风控会拦截服务器端请求。请用下方书签工具在 YouTube 原页面提取字幕（复制到剪贴板后回来粘贴）。</p>
              <YoutubeSubtitleHelper />
            </div>
          ) : needsOcr ? (
            <p className="text-center">B站视频需 OCR 识别字幕。请在下方「字幕管理 → OCR 扫描」中上传视频截图，AI 自动识别字幕文本。</p>
          ) : (
            <p className="text-center">未找到字幕。可在下方「字幕管理」中手动添加或粘贴 SRT。</p>
          )}
        </div>
      )}
      <SubListResizer height={subHeight} onChange={setSubHeight} />
    </div>
  );

  const analysisSlot = (
    <div className={`h-full rounded-2xl border border-border/60 bg-background-elev/30 p-4 scrollbar-none ${theater ? "overflow-y-auto" : "lg:sticky lg:top-24 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto"}`}>
      <StudyAnalysisColumn study={study} movieTitle={materials.videoName || "快速导入"} movieId={materials.recordId} />
    </div>
  );

  if (theater) {
    return (
      <TheaterOverlay
        canPlay={canPlay}
        hasSubs={hasSubs}
        onClose={closeTheater}
        storagePrefix="theater_quick"
        videoSlot={videoSlot}
        analysisSlot={analysisSlot}
        subtitleSlot={subtitleSlot}
        minimalSubSlot={<MinimalSubtitleBar study={study} movieId={materials.recordId} movieTitle={materials.videoName} storageKey="theater_quick_min_sub_y" storageSizeKey="theater_quick_min_sub_size" />}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] px-5 lg:px-10 pt-28 pb-20">
      <div className="flex items-center justify-between">
        <Link to="/local-study" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-copper">
          <ArrowLeft size={15} /> 返回我的影片
        </Link>
        <Link to="/extension" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-copper">
          <BookOpen size={14} /> 扩展指南
        </Link>
      </div>

      <div className="mt-6 border-b border-border/50 pb-8">
        <p className="text-[11px] uppercase tracking-luxe text-copper/80">快速导入 · 浏览器扩展</p>
        <h1 className="mt-2 font-display text-2xl leading-tight text-foreground md:text-3xl line-clamp-2">
          {materials.videoName}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          视频已嵌入播放，字幕已自动提取。点击任意台词可定位精读，点击「精读」按钮获取 AI 解析（含中文翻译）。
        </p>
        {materials.recordId && (
          <p className="mt-2 text-xs text-copper/70">已保存到「我的影片」</p>
        )}
        {!user && (
          <p className="mt-2 text-xs text-amber-300/70">登录后可保存到「我的影片」跨设备访问</p>
        )}
      </div>

      {isPhone ? (
        <div className="mt-8 space-y-3">
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
        <h2 className="font-display text-lg text-foreground">字幕管理</h2>
        <p className="mt-1 text-xs text-muted-foreground">字幕已自动导入，你也可以在此编辑、补充或重新抓取。</p>
        <div className="mt-4">
          <SubtitleWorkbench
            videoRef={videoRef}
            videoUrl={materials.videoUrl || ""}
            subs={materials.subtitles || []}
            onChanged={onSubsChanged}
            onSeek={canPlay ? (sec) => { study.exitCloseReading(); seekAndPause(sec); } : null}
            canPlay={canPlay}
            initialTab={needsOcr ? "ocr" : "link"}
          />
        </div>
      </div>
    </div>
  );
}
