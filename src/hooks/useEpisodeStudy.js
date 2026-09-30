import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import { toSec } from "@/lib/timecode";

// A subtitle is "active" up to GAP_TOLERANCE_S past its explicit end (or past
// its start when no end is given). Without this tolerance, frames between two
// cues would briefly have no active highlight, making follow-the-playback feel
// janky and out of sync.
const GAP_TOLERANCE_S = 1.2;

// Shared study state for the subtitle list + AI analysis panel so the two
// views (list under the video, analysis in the right rail) stay in sync.
// onSeek(sec) 把视频定位到某秒并暂停在那里（用于点击台词行 + 「精读」按钮的
// 第一次点击）；onPlay(sec) 从某秒开始播放视频（用于「精读」按钮的第二次点击 —
// 用户已确认要看精读后再 auto-play）。
export function useEpisodeStudy({ episodeId, movieTitle, currentTime, reloadKey, onSeek, onPlayOnly, onStudyEnter, onStudyExit }) {
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState(null);
  const [selectedCueId, setSelectedCueId] = useState(null);
  // pinnedId = 用户显式点选、需要 AI 精读的那句台词；与 activeId（播放自动
  // 跟随的高亮行）解耦——播放只移动高亮，不触发分析，避免一开播就刷屏。
  const [closeReadingState, setCloseReadingState] = useState({ activeCloseReadingCueId: null, isCloseReadingLoop: false });
  const { activeCloseReadingCueId, isCloseReadingLoop } = closeReadingState;
  const pinnedId = activeCloseReadingCueId;
  const [analyses, setAnalyses] = useState({});
  const [analyzingId, setAnalyzingId] = useState(null);
  // 解析失败过的台词：自动重试会陷入死循环（失败→清 analyzingId→同一句
  // 再触发→又失败→toast 刷屏），因此用 failedRef 一次性记下失败行，自动
  // 跟随只跳过它们；用户在精读栏点「重试」时再清除并显式重跑。
  const failedRef = useRef(new Set());
  const [failedIds, setFailedIds] = useState(new Set());
  const { toast } = useToast();
  const movieTitleRef = useRef(movieTitle);
  movieTitleRef.current = movieTitle;

  useEffect(() => {
    if (!episodeId) return;
    setLoading(true);
    setSelectedCueId(null);
    setCloseReadingState({ activeCloseReadingCueId: null, isCloseReadingLoop: false });
    onStudyExit?.();
    base44.entities.Subtitle.filter({ episode_id: episodeId }, "order", 500)
      .then((list) => {
        setSubs(list || []);
        const seed = {};
        (list || []).forEach((s) => { if (s.analysis_status === "done" && s.ai_analysis) seed[s.id] = s.ai_analysis; });
        setAnalyses(seed);
        setActiveId(null);
      })
      .finally(() => setLoading(false));
  }, [episodeId, reloadKey, onStudyExit]);

  // follow playhead → active line. Works for any source that feeds currentTime:
  //   • native <video> → real timeupdate
  //   • YouTube → IFrame API getCurrentTime() (real)
  //   • Bilibili → rAF-driven local simulation (see EpisodePage)
  // Strategy: pick the most recent subtitle whose start ≤ t. A subtitle with an
  // explicit end stays "active" until that end OR the next subtitle's start —
  // whichever comes first — so the highlight persists through mid-dialogue
  // gaps instead of vanishing (which made the line "lose sync" visually).
  // Anything more than GAP_TOLERANCE_S past the active subtitle's end is treated
  // as "between subtitles" and clears the highlight.
  useEffect(() => {
    if (currentTime == null || subs.length === 0) return;
    const t = currentTime;
    let best = null;       // most recent subtitle with start ≤ t
    let nextStart = NaN;   // earliest start strictly > current best's start
    for (const s of subs) {
      const a = toSec(s.time_start);
      if (Number.isNaN(a)) continue;
      if (a <= t + 0.05 && (best === null || a > toSec(best.time_start))) {
        best = s;
      }
    }
    if (best) {
      // find the earliest start strictly after best's start
      const bestStart = toSec(best.time_start);
      for (const s of subs) {
        const a = toSec(s.time_start);
        if (Number.isNaN(a)) continue;
        if (a > bestStart && (Number.isNaN(nextStart) || a < nextStart)) nextStart = a;
      }
      const end = toSec(best.time_end);
      let activeEnd;
      if (!Number.isNaN(end) && (Number.isNaN(nextStart) || end < nextStart)) activeEnd = end;
      else if (!Number.isNaN(nextStart)) activeEnd = nextStart - 0.05;
      else if (!Number.isNaN(end)) activeEnd = end + GAP_TOLERANCE_S;
      else activeEnd = bestStart + GAP_TOLERANCE_S;
      if (t <= activeEnd + GAP_TOLERANCE_S) {
        if (best.id !== activeId) setActiveId(best.id);
        return;
      }
    }
    // clear only if we had an active line before (so manual selection still works)
    if (activeId !== null && best === null) setActiveId(null);
  }, [currentTime, subs, activeId]);

  // silent=true（自动跟随触发的）静默失败，不弹 toast；显式 retry 时弹 toast。
  // 只在自己仍为当前 analyzing 行时清空 analyzingId，避免并发把别的行的
  // loading 态误清掉。
  const generate = async (sub, { silent = false } = {}) => {
    if (!sub?.text_en || !String(sub.text_en).trim()) return;
    setAnalyzingId(sub.id);
    try {
      const res = await base44.functions.invoke("analyzeSubtitle", {
        text_en: sub.text_en,
        movie_title: movieTitleRef.current,
        speaker: sub.speaker,
      });
      const a = res?.data?.analysis || res?.analysis || res?.data;
      if (!a || typeof a !== "object") throw new Error("解析未返回内容");
      failedRef.current.delete(sub.id);
      setFailedIds((s) => { const n = new Set(s); n.delete(sub.id); return n; });
      setAnalyses((prev) => ({ ...prev, [sub.id]: a }));
      base44.entities.Subtitle.update(sub.id, { analysis_status: "done", ai_analysis: a }).catch(() => {});
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

  // 仅在用户显式点选某句台词（pinnedId）时才发起 AI 精读；播放自动跟随
  // （activeId 只用于高亮）不再触发分析，避免一开播就连环请求。已分析过
  // 的行命中缓存；失败的行用 failedRef 跳过避免死循环；显式点击失败时弹
  // toast 告知用户。
  useEffect(() => {
    if (!pinnedId) return;
    const sub = subs.find((s) => s.id === pinnedId);
    if (!sub) return;
    if (analyses[pinnedId]) return;
    if (analyzingId === pinnedId) return;
    if (failedRef.current.has(pinnedId)) return;
    generate(sub, { silent: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedId, subs, analyses, analyzingId]);

  const retry = (sub) => {
    if (!sub) return;
    failedRef.current.delete(sub.id);
    setFailedIds((s) => { const n = new Set(s); n.delete(sub.id); return n; });
    generate(sub, { silent: false });
  };

  const hasAnyTs = subs.some((s) => s.time_start && String(s.time_start).trim());

  // 点击具体的台词行：只 seek + pause 在那（不自动播放、不显示精读），仅高亮。
  // 用户改用语「精读该台词」按钮来打开精读分析；行只负责定位+暂停。
  const onLineClick = (s) => {
    const sec = toSec(s.time_start);
    if (isCloseReadingLoop) onStudyExit?.();
    setSelectedCueId(s.id);
    setCloseReadingState({ activeCloseReadingCueId: null, isCloseReadingLoop: false });
    if (Number.isNaN(sec)) {
      toast({ title: "该台词无时间戳", description: "请用 SRT/WebVTT 批量导入，或在台词管理中补填开始时间，才能点击跳转。", variant: "destructive" });
      setActiveId(s.id);
      return;
    }
    onSeek?.(sec);
    setActiveId(s.id);
  };

  const onStudyClick = (s) => {
    if (activeCloseReadingCueId === s.id && isCloseReadingLoop) {
      exitCloseReading({ continuePlayback: true });
      return;
    }
    setCloseReadingState({ activeCloseReadingCueId: s.id, isCloseReadingLoop: true });
    setSelectedCueId(s.id);
    setActiveId(s.id);
    onStudyEnter?.(s);
  };

  const exitCloseReading = ({ continuePlayback = false } = {}) => {
    onStudyExit?.();
    setCloseReadingState({ activeCloseReadingCueId: null, isCloseReadingLoop: false });
    if (continuePlayback) onPlayOnly?.();
  };
  const clearPin = () => exitCloseReading();

  // 内联编辑后写库并就地更新本行(不打断播放高亮/滚动)。
  const updateSub = async (id, patch) => {
    const updated = await base44.entities.Subtitle.update(id, patch);
    setSubs((list) => list.map((s) => (s.id === id ? { ...s, ...updated } : s)).sort((a, b) => (a.order || 0) - (b.order || 0)));
    return updated;
  };

  return { loading, subs, activeId, setActiveId, selectedCueId, analyses, analyzingId, failedIds, retry, hasAnyTs, onLineClick, onStudyClick, toggleCloseReading: onStudyClick, exitCloseReading, activeCloseReadingCueId, isCloseReadingLoop, pinnedId, loopingId: isCloseReadingLoop ? activeCloseReadingCueId : null, clearPin, updateSub };
}
