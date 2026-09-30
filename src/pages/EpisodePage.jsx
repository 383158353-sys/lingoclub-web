import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import VideoPlayer from "@/components/study/VideoPlayer";
import EpisodeSubtitleManager from "@/components/study/EpisodeSubtitleManager";
import SubtitleScrubber from "@/components/study/SubtitleScrubber";
import EpisodeVideoUrlEditor from "@/components/study/EpisodeVideoUrlEditor";
import BiliCalibrationStrip from "@/components/study/BiliCalibrationStrip";

import StudyAnalysisColumn from "@/components/study/StudyAnalysisColumn";
import SubtitleMask from "@/components/study/SubtitleMask";
import MinimalSubtitleBar from "@/components/study/MinimalSubtitleBar";
import TheaterOverlay from "@/components/study/TheaterOverlay";
import { useEpisodeStudy } from "@/hooks/useEpisodeStudy";
import StudyWorkspace from "@/components/study/StudyWorkspace";
import SubListResizer from "@/components/study/SubListResizer";
import BilibiliScrubber from "@/components/study/BilibiliScrubber";

import { toSec, fromSec } from "@/lib/timecode";
import { useToast } from "@/components/ui/use-toast";
import { ArrowLeft, ArrowRight, Clock, Play, Pause, Loader2, Pencil, Check, X as XIcon, Send, EyeOff, ExternalLink, Info, Maximize2 } from "lucide-react";
import { useGlobalVideoSpace } from "@/hooks/useGlobalVideoSpace";
import { useTranscriptCueFocus } from "@/hooks/useTranscriptCueFocus";

export default function EpisodePage() {
  // (布局重构：Box1 调视频宽度等比缩放 / Box2 调台词列表高度 / 手机横屏影院模式)
  const { episodeId } = useParams();
  const [episode, setEpisode] = useState(null);
  const [movie, setMovie] = useState(null);
  const [scenes, setScenes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [maskOn, setMaskOn] = useState(false);
  // Box 2：台词滚动列表高度（px），可拖动调节，持久化到本地。默认 256（= h-64）。
  const [subHeight, setSubHeight] = useState(() => {
    try { const v = parseInt(localStorage.getItem("study_sub_h"), 10); return Number.isFinite(v) && v ? v : 256; } catch { return 256; }
  });
  useEffect(() => { try { localStorage.setItem("study_sub_h", String(subHeight)); } catch { /* noop */ } }, [subHeight]);
  // 手机横屏影院模式：铺满视口的桌面式可调布局。
  const [theater, setTheater] = useState(false);
  // isPhone：屏幕较短边 < 768（与方向无关），决定 B 站同步策略与布局分支。
  // （原 isMobile 在手机横屏时因宽度变大而变 false，会误切到桌面重载策略；
  //   改用短边判定后，横屏仍是手机策略，避免重载 iframe。）
  const [isPhone, setIsPhone] = useState(() => (typeof window !== "undefined" ? Math.min(window.innerWidth, window.innerHeight) < 768 : false));
  useEffect(() => {
    const on = () => setIsPhone(Math.min(window.innerWidth, window.innerHeight) < 768);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const openTheater = useCallback(async () => {
    setTheater(true);
    try {
      if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen?.();
      if (window.screen?.orientation?.lock) await window.screen.orientation.lock("landscape");
    } catch { /* 部分浏览器/非 HTTPS 不支持，忽略；用户可手动旋转手机 */ }
  }, []);
  const closeTheater = useCallback(async () => {
    setTheater(false);
    try { if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen(); } catch { /* noop */ }
  }, []);
  const [currentTime, setCurrentTime] = useState(null);
  const [loopRange, setLoopRange] = useState(null);
  const loopRangeRef = useRef(null);
  const [subsReloadKey, setSubsReloadKey] = useState(0);
  const [simTime, setSimTime] = useState(null);
  // clockRunning 驱动本地仿真时钟（B 站 iframe 跨域、读不到真实进度，也无法
  // 获知暂停状态）。默认关闭，避免在用户尚未播放视频时时钟就空转导致台词
  // 提前滚动。用户在 B 站点播放（iframe 获得焦点）时自动启动；暂停请同步
  // 点 BilibiliScrubber 上的 ⏸。探索方式：始终把进度条 + 台词绑定到这个
  // 本地时钟（studyTime），useEpisodeStudy 据此高亮当前行并自动滚动。
  const [clockRunning, setClockRunning] = useState(false);
  // 移动端「物理对齐」校准：B 站进度条并不占满 iframe 全宽，端点随设备宽高比
  // 变化、跨域 iframe 读不出。校准时在视频底部窄带上用两根细透明标线对准 B
  // 站真实进度条端点，几何存 localStorage，本站进度条等宽对齐。
  const [trackCalib, setTrackCalib] = useState(() => {
    try {
      const raw = localStorage.getItem("bili_track_calib");
      if (raw) return JSON.parse(raw);
    } catch { /* noop */ }
    return { startPct: 0.08, endPct: 0.88 };
  });
  const [calibrating, setCalibrating] = useState(false);
  const saveCalib = useCallback((c) => {
    setTrackCalib(c);
    try { localStorage.setItem("bili_track_calib", JSON.stringify(c)); } catch { /* noop */ }
    setCalibrating(false);
  }, []);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();
  const videoRef = useRef(null);
  const isBilibili = /bilibili\.com\/video\/(BV|av)|player\.bilibili\.com\/player/i.test(episode?.video_url || "");
  // 点击台词行：定位到该时间点但暂停在那——不再像过去那样自动播放。
  // B 站跨域 iframe：以 autoplay=0&t=sec 重载（pause API）→ 在该秒停下并暂停。
  // YouTube / 原生视频：api.pause(sec) 现在 seek+pause 一并完成。
  // seekAndPause = 点台词行:把"影子时钟"移到该秒并暂停在其上。
  //   桌面 B 站: 重载 iframe 到该秒并暂停(强同步, 与之前一致的可靠跳转)。
  //   移动端 B 站: 只移影子时钟(不重载, 不打断 B 站原生播放); 高亮该行,
  //     影子停下, 等用户按「精读→播放」单次重载或 B 站原生键推进。
  //   YouTube / 原生: api.pause(sec) seek+pause 一并完成。
  const seekAndPause = useCallback((sec) => {
    if (!Number.isFinite(sec)) return;
    setSimTime(sec);
    if (isBilibili) setClockRunning(false);
    // 移动端「物理对齐」纯偏移模型：点台词行只把站内影子时钟移到该秒并冻结，
    // 不再重载 B 站（用户在 B 站原生界面自行播放/跳转，由本站进度条手动对齐）。
    // 桌面端仍走重载强同步。
    if (isPhone && isBilibili) return;
    const api = videoRef.current;
    if (api?.pause) api.pause(sec);
    else if (api) { try { api.currentTime = sec; } catch { /* not seekable yet */ } }
  }, [isBilibili, isPhone]);

  // 「精读该台词」按钮的第二次点击（或者播放按钮）：让视频从该时间点开始播放。
  // B 站：autoplay=1&t=sec 重载 + 启动本地跟随时钟；YouTube / 原生：api.play(sec)。
  // playFromLine = 「精读」二次点击 / ▶ 播放: 让视频跳到该秒并起播 + 启动影子时钟跟随。
  //   桌面/移动端都以单次重载(autoplay=1&t=sec)把 B 站跳到该台词起播;
  //   移动端 autoplay 被浏览器拦截, 故视频在该秒位等用户点 B 站原生 ▶ 推进。
  //   YouTube / 原生: api.play(sec) seek+play 一并完成。
  const playFromLine = useCallback((sec) => {
    if (!Number.isFinite(sec)) return;
    setSimTime(sec);
    setClockRunning(true);
    const api = videoRef.current;
    if (api?.play) api.play(sec);
    else if (api) { try { api.currentTime = sec; api.play?.(); } catch { /* noop */ } }
  }, []);

  // 精读专用：暂停但不跳转进度 / 从当前位置恢复播放
  const playOnly = useCallback(() => {
    if (isBilibili) setClockRunning(true);
    videoRef.current?.playOnly?.();
  }, [isBilibili]);
  // B站内嵌 iframe 不向页面回传播放进度，点台词后用本地时钟从该秒按真实速率递增，
  // 驱动下方列表与右侧精读栏自动滚动跟进；原生平播视频沿用真实 timeupdate。
  // B站内嵌 iframe 跨域、不回传 currentTime：用本地仿真时钟驱动下方
  // 台词列表与右侧精读栏自动跟随；YouTube 经 IFrame Player API 获取真实
  // currentTime，等价于原生 <video>，进度条与台词直接绑定，无需仿真。
  // B站内嵌 iframe 跨域、且不暴露 currentTime/pause 状态，因此用本地仿真
  // 时钟驱动激活行高亮，与 YouTube/原生 video 走同一套 useEpisodeStudy 匹配。
  // 用 requestAnimationFrame + performance.now() 按真实流逝时间推进（1× 速率
  // 精确到毫秒），但节流 React setState 到每秒约 10 次等价值更新——保证字幕
  // 在 100ms 内与"视频时间"对齐，且不会因为 60fps 重渲染拖垮页面。
  // 站内播放键 ▶ / ⏸ 与 B 站强绑定：B 站跨域 iframe 不开放任何控制 API（无
  // postMessage、读不到进度、发不了 play/pause），唯一可控方式就是用
  // autoplay=1/0 & t=秒 重载 iframe。因此站内按下 ▶/⏸ 会单次重载 B 站，让
  // B 站的播放/暂停/位置与本地时间轴保持一致；每次重载会短暂重新缓冲，这是
  // B 站内嵌播放器的硬限制（无 API 桥接），不可能做到既强绑定又零缓冲。
  // 进度条拖动释放 / ⟳ 重新对齐 / 点台词行 同样走单次重载 seek，一致地驱动 B 站。
  const toggleClock = useCallback(() => {
    if (isBilibili) {
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
  }, [clockRunning, currentTime, isBilibili, simTime]);
  // 手机端:B 站 iframe autoplay 被浏览器拦截,播放/暂停只切换本地跟随时钟,
  // 不重载 B 站(B 站由用户点视频内原生播放键控制);本地时钟负责驱动字幕跟随。
  const toggleLocalClock = useCallback(() => {
    // 移动端物理联动：站内播放/暂停键不只切换本地时钟，而是同步重载 B 站
    // iframe 到当前秒——播放时 autoplay=1&t 起播并启动跟随时钟，暂停时
    // autoplay=0&t 停在该秒并冻结时钟，两套时间轴在每次操作上物理对齐。
    const t = simTime == null ? 0 : simTime;
    setSimTime(t);
    setClockRunning((r) => {
      const next = !r;
      const api = videoRef.current;
      if (next) api?.play?.(t);
      else api?.pause?.(t);
      return next;
    });
  }, [simTime]);
  // 移动端专用「⟳ 重新对齐」:把 B 站 iframe 重载到站内时间轴当前点(暂停态)。
  // B 站跨域 iframe 读不到真实进度、也无法暂停它,精读暂停后 B 站仍在播放会脱节;
  // 由用户在此刻手动触发一次重载,把 B 站拉回当前台词处,两套时钟重新对齐。
  const realignToBilibili = useCallback(() => {
    // 移动端 ⟳:物理归零——把站内时钟与 B 站一起拉回 0 秒并暂停,
    // 两套时间轴在该次操作上重新物理对齐(与播放/暂停/跳转一致的重载策略)。
    setSimTime(0);
    setClockRunning(false);
    videoRef.current?.pause?.(0);
    toast({ title: "已归零并对齐", description: "B 站与站内时钟都回到了 0 秒。" });
  }, []);
  // 移动端微调站内时间轴(±1s),用于 B 站与站内出现小幅偏差时手动对齐。
  // 不触碰 B 站 iframe(重载即断流),仅调整站内 simTime。
  const nudgeLocalSec = useCallback((delta) => {
    setSimTime((t) => {
      const cur = t == null ? 0 : t;
      return Math.max(0, +(cur + delta).toFixed(3));
    });
  }, []);
  useEffect(() => {
    if (!isBilibili || !clockRunning) return;
    let lastNow = performance.now();
    let lastEmit = -1;
    const tick = () => {
      const now = performance.now();
      const dt = (now - lastNow) / 1000; // 真实流逝秒数
      lastNow = now;
      setSimTime((t) => {
        if (t == null || dt <= 0) return t;
        const nt = +(t + dt).toFixed(3);
        const r = Math.round(nt * 10) / 10; // 0.1s 一档，限制 React 重渲染
        if (r === lastEmit) return t;
        lastEmit = r;
        return nt;
      });
    };
    // 关键：用 setInterval 而非 requestAnimationFrame。标签被浏览器切到后台时
    // rAF 会被整体暂停（预览环境尤其明显），导致本地时钟卡死、进度条不动、
    // 台词不滚；setInterval 在后台仍以 ~1/s 节流触发，配合 performance.now 真实
    // 增量，时钟持续推进、与 B 站真实播放时间一一对齐。
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [isBilibili, clockRunning]);
  const studyTime = isBilibili ? simTime : currentTime;
  const onStudyEnter = useCallback((sub) => {
    const start = toSec(sub.time_start);
    const end = toSec(sub.time_end);
    if (Number.isNaN(start)) return;
    let safeEnd = !Number.isNaN(end) && end > start ? end : NaN;
    if (Number.isNaN(safeEnd)) {
      let nextStart = NaN;
      for (const item of studySubsRef.current) {
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
  }, [playFromLine]);
  const onStudyExit = useCallback(() => {
    loopRangeRef.current = null;
    setLoopRange(null);
  }, []);
  const study = useEpisodeStudy({ episodeId: episode?.id, movieTitle: movie?.title, currentTime: studyTime, reloadKey: subsReloadKey, onSeek: seekAndPause, onPlayOnly: playOnly, onStudyEnter, onStudyExit });
  const onExternalSeek = useCallback((time) => {
    const activeLoop = loopRangeRef.current;
    if (activeLoop && (time < activeLoop.start - 0.05 || time > activeLoop.end + 0.35)) study.exitCloseReading();
  }, [study.exitCloseReading]);
  const studySubsRef = useRef(study.subs);
  studySubsRef.current = study.subs;
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
    enabled: Boolean(episode?.video_url),
    isCloseReadingLoop: study.isCloseReadingLoop,
    exitCloseReading: study.exitCloseReading,
    startCloseReading: startCloseReadingFromKeyboard,
    focusCurrentCue: transcriptFocus.focusCurrentTranscriptCue,
  });

  // 全屏切换后 VideoPlayer 会被重新挂载，需要恢复播放进度（不影响视频播放和台词滚动）
  useEffect(() => {
    if (!episode?.video_url) return;
    const t = isBilibili ? simTime : currentTime;
    if (t == null || t < 0.5) return;
    let cancelled = false;
    const restore = () => {
      if (cancelled) return;
      const api = videoRef.current;
      if (!api) { setTimeout(restore, 200); return; }
      if (isBilibili) {
        if (clockRunning) api.play(t);
        else api.pause(t);
      } else {
        api.seek(t);
      }
    };
    const timer = setTimeout(restore, isBilibili ? 300 : 500);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theater]);
  // 进度条上限：优先 episode.duration（管理员设置的本集时长），其次用最后一句台词
  // 的 time_end + 5s 推导；都没有时默认 1320s（22 分钟），与本页"约 22 分钟"展示
  // 一致——避免用 3600s 兜底导致刻度全程挤在 0 附近、看不出进度在动。
  const bilibiliDuration = episode && episode.duration > 0
    ? episode.duration
    : Math.max((study.subs || []).reduce((m, s) => Math.max(m, toSec(s.time_end || s.time_start) || 0), 0) + 5, 1320);
  const playerWrapRef = useRef(null);
  // 移动端采用「物理操作同步」：站内播放键 / 进度条 / 点台词行 / ⟳ 均会
  // 重载 B 站 iframe 到对应秒数，每次操作都把两套时间轴物理对齐。因此不再
  // 监听 iframe focus 自动启动本地时钟（那属于「自动跟随」，会累积偏差）——
  // 用户改用站内播放键即可，站内时钟与 B 站在每次操作上重新对齐。

  const isAdmin = user?.role === "admin" || episode?.created_by_id === user?.id || episode?.proposed_by_id === user?.id;
  // 浏览模式（看戏/学习）下不出现任何编辑入口；只在「创作者工坊」跳转过来带
  // ?studio=1 时才放行编辑（标题铅笔 / 视频链接 / 台词编辑 / 提交审核 等），
  // 避免 RLS 给管理员开着的写权限在「学习页」被误触。
  const studioMode = new URLSearchParams(window.location.search).get("studio") === "1";
  const canEdit = studioMode && isAdmin;
  useEffect(() => {
    if (!episodeId) return;
    setLoading(true);
    (async () => {
      try {
        const ep = await base44.entities.Episode.get(episodeId);
        setEpisode(ep);
        const [m, scs] = await Promise.all([
          base44.entities.Movie.get(ep.movie_id),
          base44.entities.Scene.filter({ episode_id: episodeId }, "order", 50),
        ]);
        setMovie(m);
        setScenes(scs || []);
      } finally {
        setLoading(false);
      }
    })();
  }, [episodeId]);

  const saveTitle = async () => {
    const v = titleDraft.trim();
    if (!v || v === episode.title) { setEditingTitle(false); return; }
    setSavingTitle(true);
    try {
      const updated = await base44.entities.Episode.update(episode.id, { title: v });
      setEpisode((e) => ({ ...e, title: updated.title }));
      setEditingTitle(false);
      toast({ title: "已更新剧标题" });
    } catch (err) {
      toast({ title: "保存失败", description: err?.message, variant: "destructive" });
    } finally {
      setSavingTitle(false);
    }
  };

  const resubmit = async () => {
    try {
      const updated = await base44.entities.Episode.update(episode.id, {
        contribution_status: "pending",
        review_note: "",
        reviewed_date: new Date().toISOString(),
      });
      setEpisode((e) => ({ ...e, ...updated }));
      toast({ title: "已重新提交审核" });
    } catch (err) {
      toast({ title: "操作失败", description: err?.message, variant: "destructive" });
    }
  };

  const submitForReview = async () => {
    setSubmittingReview(true);
    try {
      const updated = await base44.entities.Episode.update(episode.id, {
        contribution_status: "pending",
        review_note: "",
        reviewed_date: new Date().toISOString(),
      });
      setEpisode((e) => ({ ...e, ...updated }));
      toast({ title: "已提交审核", description: "管理员审核通过后本集将在小组列表公开。" });
    } catch (err) {
      toast({ title: "提交失败", description: err?.message, variant: "destructive" });
    } finally {
      setSubmittingReview(false);
    }
  };

  if (loading) return <div className="pt-28 pb-20 text-center text-muted-foreground">加载剧集…</div>;
  if (!episode) return <div className="pt-28 pb-20 text-center text-muted-foreground">未找到该剧集。</div>;

  return (
    <div className="mx-auto w-full max-w-[1600px] px-5 lg:px-10 pt-28 pb-20">
      <Link to={movie ? `/movie/${movie.id}` : "/communities"} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-copper">
        <ArrowLeft size={15} /> 返回小组
      </Link>

      <div className="mt-6 border-b border-border/50 pb-8">
        <p className="text-[11px] uppercase tracking-luxe text-copper/80">
          {movie?.title} · E{String(episode.episode).padStart(2, "0")}
        </p>
        {editingTitle ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") setEditingTitle(false); }}
              className="flex-1 rounded-lg border border-copper/50 bg-background-elev/60 px-3 py-1.5 font-display text-2xl leading-tight text-foreground focus:outline-none md:text-3xl"
              placeholder="本集标题"
            />
            <button
              type="button"
              onClick={saveTitle}
              disabled={savingTitle}
              className="inline-flex items-center gap-1.5 rounded-full bg-copper px-3.5 py-1.5 text-xs font-medium text-copper-foreground disabled:opacity-50"
            >
              {savingTitle ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} 保存
            </button>
            <button
              type="button"
              onClick={() => setEditingTitle(false)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <XIcon size={13} /> 取消
            </button>
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-2">
            <h1 className="font-display text-3xl leading-tight text-foreground md:text-4xl">{episode.title}</h1>
            {canEdit && (
              <button
                type="button"
                onClick={() => { setTitleDraft(episode.title || ""); setEditingTitle(true); }}
                title="编辑标题"
                className="inline-flex items-center text-muted-foreground/60 transition-colors hover:text-copper"
              >
                <Pencil size={15} />
              </button>
            )}
          </div>
        )}
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">{episode.synopsis || episode.description}</p>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><Clock size={12} /> 约 {episode.duration || 22} 分钟</p>
        {canEdit && episode.contribution_status === "draft" && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-400/40 bg-sky-500/10 px-3 py-1 text-xs text-sky-200/90">
              <Pencil size={12} className="opacity-80" /> 草稿 · 仅自己可见，编辑完成后提交审核
            </span>
            <button
              type="button"
              onClick={submitForReview}
              disabled={submittingReview}
              className="inline-flex items-center gap-2 rounded-full bg-copper px-3.5 py-1.5 text-xs font-medium text-copper-foreground transition-transform hover:scale-[1.02] disabled:opacity-50"
            >
              {submittingReview ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} 提交审核
            </button>
          </div>
        )}
        {canEdit && episode.contribution_status === "pending" && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-200/90">
            <Clock size={12} /> 投稿待审 · 通过后才会在小组列表公开
          </div>
        )}
        {canEdit && episode.contribution_status === "rejected" && (
          <div className="mt-3 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs leading-relaxed text-rose-200/90">
            <span className="font-medium">审核备注：</span>{episode.review_note || "暂未通过审核"}
          </div>
        )}
        {canEdit && episode.contribution_status === "rejected" && (
          <button
            type="button"
            onClick={resubmit}
            className="mt-3 inline-flex items-center gap-2 rounded-full border border-copper/40 bg-copper/10 px-3 py-1.5 text-xs text-copper transition-transform hover:scale-[1.01]"
          >
            <Send size={12} /> 重新提交审核
          </button>
        )}
      </div>

      {/* ===== 学习工作台：视频 + 台词列表 + 台词精读（Box1 调视频宽度等比缩放，Box2 调列表高度）===== */}
      {(() => {
        const hasVideo = !!episode.video_url;
        // —— 视频区（B 站提示 / 校准 / 播放键 / 遮挡 / 横屏入口）——
        const videoSlot = hasVideo ? (
          <div>
            {isBilibili && !theater && (
              <div className="mb-2 flex items-start gap-2 rounded-lg border border-mint/30 bg-mint/10 px-3 py-2 text-xs leading-relaxed text-foreground/90">
                <Info size={13} className="mt-0.5 shrink-0 text-mint" />
                <span>{isPhone ? "在 B 站原生界面播放/跳转后，把下方进度条的竖线对到 B 站进度条的同一位置即可同步（不重载）。宽度用尺校准。" : "请使用下方的进度条 / 播放键控制 B 站。"}</span>
              </div>
            )}
            <div ref={playerWrapRef} className="relative">
              <VideoPlayer ref={videoRef} url={episode.video_url} onTimeUpdate={setCurrentTime} onUserSeek={onExternalSeek} />
              {isPhone && isBilibili && calibrating && (
                <BiliCalibrationStrip initial={trackCalib} onConfirm={saveCalib} onCancel={() => setCalibrating(false)} />
              )}
              {isBilibili && !isPhone && !maskOn && (
                <button
                  type="button"
                  onClick={toggleClock}
                  title={clockRunning ? "暂停（重载 B 站至该秒并停下，与本地时间轴对齐）" : "播放（从该秒重载 B 站并自动播放，与本地时间轴对齐）"}
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
              {!theater && (
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
            {isBilibili && isPhone && (
              <BilibiliScrubber
                mobile
                value={studyTime}
                duration={bilibiliDuration}
                onNudge={nudgeLocalSec}
                onCalibrate={() => setCalibrating(true)}
                trackStartPct={trackCalib.startPct}
                trackEndPct={trackCalib.endPct}
                onDrag={(v) => { study.exitCloseReading(); setSimTime(v); }}
                onRelease={(v) => { study.exitCloseReading(); setSimTime(v); setClockRunning(true); }}
              />
            )}
            {canEdit && <EpisodeVideoUrlEditor episode={episode} onSaved={(u) => setEpisode((e) => ({ ...e, ...u }))} />}
          </div>
        ) : canEdit ? (
          <EpisodeVideoUrlEditor episode={episode} onSaved={(u) => setEpisode((e) => ({ ...e, ...u }))} />
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-background-elev/30 p-10 text-center text-sm text-muted-foreground">
            视频片段尚未上线，敬请期待。
          </div>
        );

        // —— 台词列表区（桌面 B 站进度条 + 台词滚动 + Box2 高度调节）——
        const subtitleSlot = hasVideo ? (
          <div className="mt-3">
            {isBilibili && !isPhone && (
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
            <SubtitleScrubber study={study} movieId={movie?.id} movieTitle={movie?.title} editable={canEdit} listHeight={subHeight} focusRequest={transcriptFocus.focusRequest} />
            <SubListResizer height={subHeight} onChange={setSubHeight} />
          </div>
        ) : null;

        // —— 台词精读区 ——
        const analysisSlot = hasVideo ? (
          <div className={`h-full rounded-2xl border border-border/60 bg-background-elev/30 p-4 scrollbar-none ${theater ? "overflow-y-auto" : "lg:sticky lg:top-24 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto"}`}>
            <StudyAnalysisColumn study={study} movieTitle={movie?.title} movieId={movie?.id} />
          </div>
        ) : null;

        // 全屏沉浸：精读栏 + 台词滚动条可独立开关，精读栏可拖动/归位右侧，
        // 关掉台词列表时叠加单行悬浮字幕（点词查义+收藏）。与「我的影片」一致。
        if (theater) {
          return (
            <TheaterOverlay
              canPlay={hasVideo}
              hasSubs={(study.subs || []).length > 0}
              onClose={closeTheater}
              storagePrefix="theater_group"
              videoSlot={videoSlot}
              analysisSlot={analysisSlot}
              subtitleSlot={subtitleSlot}
              minimalSubSlot={<MinimalSubtitleBar study={study} movieId={movie?.id} movieTitle={movie?.title} storageKey="theater_group_min_sub_y" storageSizeKey="theater_group_min_sub_size" />}
            />
          );
        }

        // 桌面 / 平板：左右可调工作台
        if (!isPhone) {
          return (
            <div className="mt-8">
              <StudyWorkspace videoSlot={videoSlot} subtitleSlot={subtitleSlot} analysisSlot={analysisSlot} />
            </div>
          );
        }

        // 手机竖屏：保持原有上下堆叠布局 + Box2 高度调节
        return (
          <div className="mt-8 space-y-3">
            {videoSlot}
            {subtitleSlot}
            {analysisSlot && <div className="mt-2">{analysisSlot}</div>}
          </div>
        );
      })()}

      {canEdit && (
        <div className="mt-10">
          <h2 className="font-display text-lg text-foreground">台词管理 <span className="text-sm font-body text-muted-foreground">· 创作者</span></h2>
          <p className="mt-1 text-xs text-muted-foreground">视频链接抓取 / 粘贴·文件导入 / OCR 扫描 / 手动逐句，四种方式统一在这里管理。OCR 支持原生视频自动截帧和手动上传截图（YouTube / B站 嵌入视频也可用）。</p>
          <div className="mt-4">
            <EpisodeSubtitleManager
              episode={episode}
              movieId={movie?.id}
              movieTitle={movie?.title}
              videoRef={videoRef}
              canPlay={!!episode.video_url}
              onSeek={(sec) => { study.exitCloseReading(); seekAndPause(sec); }}
              reloadKey={subsReloadKey}
              onSubsChanged={() => setSubsReloadKey((k) => k + 1)}
            />
          </div>
        </div>
      )}

      <h2 className="mt-10 font-display text-lg text-foreground">本集场景 <span className="text-sm font-body text-muted-foreground">· {scenes.length}</span></h2>
      {scenes.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">.scenes coming soon.</div>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {scenes.map((s, i) => (
            <Link
              key={s.id}
              to={`/scene/${s.id}`}
              className="group relative overflow-hidden rounded-xl border border-border/60 bg-card p-5 transition-colors hover:border-copper/40"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-copper/80">{s.timestamp}</span>
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-copper/30 text-copper transition-colors group-hover:bg-copper group-hover:text-copper-foreground">
                  <Play size={14} />
                </span>
              </div>
              <h3 className="mt-4 font-display text-lg leading-snug text-foreground">{s.title}</h3>
              <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{s.description}</p>
              <div className="mt-4 inline-flex items-center gap-1.5 text-xs text-copper opacity-0 transition-opacity group-hover:opacity-100">
                进入场景 <ArrowRight size={13} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
