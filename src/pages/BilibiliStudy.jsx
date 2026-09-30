import React, { useState, useEffect, useCallback, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useLocalStudy } from "@/hooks/useLocalStudy";
import SubtitleScrubber from "@/components/study/SubtitleScrubber";
import StudyAnalysisColumn from "@/components/study/StudyAnalysisColumn";
import SubtitleWorkbench from "@/components/study/SubtitleWorkbench";
import BilibiliScrubber from "@/components/study/BilibiliScrubber";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, ExternalLink, BookOpen, Sparkles, Tv, Pencil, X, Check, Info } from "lucide-react";

/**
 * B站精读页面：
 *
 * B站视频以内嵌 iframe（player.bilibili.com）方式在本页面直接播放——
 * 稳定、可播。下方 BilibiliScrubber 维护站内仿真时钟，播放/暂停/进度跳转
 * 均通过重载 iframe（?t= 参数）与 B站对齐。字幕列表跟随站内时钟高亮，
 * 点击台词跳转即重载 B站至该时间点。右侧 AI 精读面板复用本站现有能力。
 */
function extractBv(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/video\/(BV[\w]+)/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export default function BilibiliStudy() {
  const urlParams = new URLSearchParams(window.location.search);
  const biliUrl = urlParams.get("url") || "";
  const bv = extractBv(biliUrl);
  const { toast } = useToast();

  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authFailed, setAuthFailed] = useState(false);
  const [tab, setTab] = useState("study"); // "study" | "workbench"

  // 仿真时钟
  const [simTime, setSimTime] = useState(0);
  const [simDuration, setSimDuration] = useState(0);
  const [simRunning, setSimRunning] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [seekT, setSeekT] = useState(0);

  // UI
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlInput, setUrlInput] = useState(biliUrl);
  const [isPhone, setIsPhone] = useState(() => window.innerWidth < 768);
  const subAreaRef = useRef(null);
  const [listH, setListH] = useState(240);

  // Load or create record by BV
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!bv) { setLoading(false); return; }
      try {
        const all = await base44.entities.LocalMovieMeta.list();
        if (cancelled) return;
        const found = all.find((m) => m.video_url && m.video_url.includes(bv));
        if (found) {
          setRecord(found);
        } else {
          const created = await base44.entities.LocalMovieMeta.create({
            name: `B站 ${bv}`,
            video_url: biliUrl,
            subtitles: [],
          });
          if (!cancelled) setRecord(created);
        }
      } catch {
        if (!cancelled) setAuthFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [bv, biliUrl]);

  // Fetch duration + title from B站 API
  useEffect(() => {
    if (!bv) return;
    let cancelled = false;
    fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bv}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.data?.duration) setSimDuration(data.data.duration);
        if (data?.data?.title && record) {
          const newTitle = data.data.title;
          setRecord((r) => (r ? { ...r, name: newTitle } : r));
          // 持久化标题
          if (record?.id) {
            base44.entities.LocalMovieMeta.update(record.id, { name: newTitle }).catch(() => {});
          }
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [bv]); // eslint-disable-line react-hooks/exhaustive-deps

  // 仿真时钟定时器
  useEffect(() => {
    if (!simRunning) return;
    const id = setInterval(() => {
      setSimTime((t) => (simDuration > 0 ? Math.min(t + 1, simDuration) : t + 1));
    }, 1000);
    return () => clearInterval(id);
  }, [simRunning, simDuration]);

  // 监听 B站播放器 postMessage（best-effort 真实同步）
  useEffect(() => {
    const handler = (event) => {
      const d = event.data;
      if (!d || typeof d !== "object") return;
      if (typeof d.currentTime === "number") setSimTime(d.currentTime);
      if (typeof d.duration === "number" && d.duration > 0) setSimDuration(d.duration);
      if (d.type === "playerStateChange" && d.data) {
        const st = typeof d.data.state === "string" ? d.data.state : typeof d.data === "string" ? d.data : "";
        if (/play/i.test(st)) setSimRunning(true);
        if (/pause/i.test(st)) setSimRunning(false);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Resize listener
  useEffect(() => {
    const onResize = () => {
      setIsPhone(window.innerWidth < 768);
      if (subAreaRef.current) setListH(Math.max(150, subAreaRef.current.clientHeight));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Measure subtitle area
  useEffect(() => {
    const el = subAreaRef.current;
    if (!el) return;
    const measure = () => setListH(Math.max(150, el.clientHeight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tab]);

  // BilibiliScrubber 回调
  const toggleRun = useCallback(() => {
    setSimRunning((r) => {
      if (!r) {
        // 开始播放：重载 iframe 到当前时间 + autoplay
        setSeekT(simTime);
        setIframeKey((k) => k + 1);
      }
      return !r;
    });
  }, [simTime]);

  const onSeekDrag = useCallback((sec) => setSimTime(sec), []);

  const onSeekRelease = useCallback((sec) => {
    setSimTime(sec);
    setSeekT(sec);
    setIframeKey((k) => k + 1);
    setSimRunning(false);
  }, []);

  const onNudge = useCallback((delta) => {
    setSimTime((t) => Math.max(0, t + delta));
  }, []);

  const seekToBili = useCallback((sec) => {
    if (!Number.isFinite(sec)) return;
    setSimTime(sec);
    setSeekT(sec);
    setIframeKey((k) => k + 1);
  }, []);

  const study = useLocalStudy({
    subtitles: record?.subtitles || [],
    currentTime: simTime,
    onSeek: (sec) => { seekToBili(sec); setSimRunning(false); },
    onPlay: (sec) => { seekToBili(sec); setSimRunning(true); },
    onPauseOnly: () => setSimRunning(false),
    onPlayOnly: () => { setSeekT(simTime); setIframeKey((k) => k + 1); setSimRunning(true); },
  });

  const onSubsChanged = useCallback(async (newSubs) => {
    setRecord((r) => (r ? { ...r, subtitles: newSubs } : r));
    const id = record?.id;
    if (!id) return;
    try {
      await base44.entities.LocalMovieMeta.update(id, { subtitles: newSubs });
    } catch (e) {
      toast({ title: "字幕未保存", description: e?.message, variant: "destructive" });
    }
  }, [record?.id, toast]);

  const changeUrl = useCallback(async () => {
    const newUrl = urlInput.trim();
    if (!newUrl || !record?.id) return;
    try {
      await base44.entities.LocalMovieMeta.update(record.id, { video_url: newUrl });
      window.location.search = `?url=${encodeURIComponent(newUrl)}`;
    } catch (e) {
      toast({ title: "更换链接失败", description: e?.message, variant: "destructive" });
    }
  }, [urlInput, record, toast]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="animate-spin text-copper" size={24} />
      </div>
    );
  }

  if (!bv) {
    return <div className="p-6 text-sm text-muted-foreground">缺少 B站视频链接参数。</div>;
  }

  if (authFailed) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <Tv size={28} className="text-copper" />
        <p className="text-sm text-foreground">请先登录本站</p>
        <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
          B站精读需要登录才能读取你的台词数据。点击下方在新标签页登录后，回来重新打开即可。
        </p>
        <a
          href={`${window.location.origin}/login?returnTo=${encodeURIComponent(window.location.href)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full bg-copper px-4 py-2 text-sm font-medium text-copper-foreground"
        >
          <ExternalLink size={14} /> 新标签页登录
        </a>
      </div>
    );
  }

  const hasSubs = (record?.subtitles?.length || 0) > 0;
  const iframeSrc = `https://player.bilibili.com/player.html?bvid=${bv}&page=1&danmaku=0&high_quality=1&autoplay=${simRunning ? 1 : 0}&as_wide=1${seekT > 0 ? `&t=${Math.floor(seekT)}` : ""}`;

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <div className="shrink-0 border-b border-border/50 px-4 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Tv size={15} className="shrink-0 text-copper" />
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-luxe text-copper/80">B站实时精读</p>
              <h1 className="truncate font-display text-sm text-foreground">{record?.name || bv}</h1>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setTab(tab === "study" ? "workbench" : "study")}
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${tab === "workbench" ? "bg-copper text-copper-foreground" : "border border-border text-muted-foreground hover:text-foreground hover:border-copper/50"}`}
          >
            {tab === "study" ? <Sparkles size={12} /> : <BookOpen size={12} />}
            {tab === "study" ? "字幕管理" : "返回学习"}
          </button>
        </div>
      </div>

      {tab === "workbench" ? (
        <div className="flex-1 overflow-y-auto p-3">
          <SubtitleWorkbench
            videoUrl={record?.video_url || biliUrl}
            subs={record?.subtitles || []}
            onChanged={onSubsChanged}
            onSeek={onSeekRelease}
            canPlay={true}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* Left: video + controls + subtitles */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden p-3">
            {/* Instruction bar */}
            <div className="mb-2 shrink-0 rounded-lg border border-copper/30 bg-copper/5 px-3 py-1.5 text-[11px] text-copper/90">
              <Info size={11} className="mr-1 inline" />
              请使用下方的进度条/播放键控制 B 站。
            </div>

            {/* B站 iframe */}
            <div className="shrink-0">
              <div className="relative overflow-hidden rounded-xl border border-border bg-black" style={{ aspectRatio: "16 / 9" }}>
                <iframe
                  key={iframeKey}
                  src={iframeSrc}
                  className="absolute inset-0 h-full w-full"
                  scrolling="no"
                  frameBorder="0"
                  allowFullScreen
                  allow="autoplay; fullscreen; picture-in-picture"
                />
              </div>
            </div>

            {/* Metadata bar */}
            <div className="mt-2 flex shrink-0 items-center gap-2 text-xs">
              <span className="truncate text-foreground/80">{record?.name || bv}</span>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-muted-foreground/60">Bilibili</span>
              <div className="ml-auto flex items-center gap-2">
                <a href={record?.video_url || biliUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-copper" title="原始打开">
                  <ExternalLink size={12} /> 原始打开
                </a>
                <button type="button" onClick={() => { setEditingUrl(true); setUrlInput(record?.video_url || biliUrl); }} className="inline-flex items-center gap-1 text-muted-foreground hover:text-copper" title="更换链接">
                  <Pencil size={12} /> 更换链接
                </button>
              </div>
            </div>

            {/* URL editor */}
            {editingUrl && (
              <div className="mt-1.5 flex shrink-0 items-center gap-1.5">
                <input
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") changeUrl(); }}
                  className="min-w-0 flex-1 rounded-lg border border-border bg-background-elev/50 px-2 py-1 text-xs text-foreground focus:border-copper/50 focus:outline-none"
                  autoFocus
                />
                <button type="button" onClick={changeUrl} className="rounded-full bg-copper px-2.5 py-1 text-[11px] font-medium text-copper-foreground">
                  <Check size={11} />
                </button>
                <button type="button" onClick={() => setEditingUrl(false)} className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
                  <X size={11} />
                </button>
              </div>
            )}

            {/* BilibiliScrubber */}
            <div className="shrink-0">
              <BilibiliScrubber
                value={simTime}
                duration={simDuration}
                running={simRunning}
                onToggleRun={toggleRun}
                onDrag={onSeekDrag}
                onRelease={onSeekRelease}
                onNudge={onNudge}
                mobile={isPhone}
              />
            </div>

            {/* Subtitle list */}
            <div ref={subAreaRef} className="min-h-0 flex-1">
              {hasSubs ? (
                <SubtitleScrubber study={study} editable={false} listHeight={listH} />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background-elev/30 p-6 text-center">
                  <BookOpen size={20} className="text-muted-foreground/60" />
                  <p className="text-xs text-muted-foreground">还没有台词</p>
                  <button type="button" onClick={() => setTab("workbench")} className="inline-flex items-center gap-1 rounded-full bg-copper px-3 py-1.5 text-[11px] font-medium text-copper-foreground">
                    <Sparkles size={11} /> 去抓取字幕
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right: AI analysis */}
          {!isPhone && (
            <div className="w-72 shrink-0 overflow-y-auto border-l border-border/50 p-3">
              <h2 className="font-display text-sm text-foreground">台词精读</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">点击下方某句台词，开始 AI 精读。</p>
              <div className="mt-3">
                <StudyAnalysisColumn study={study} movieTitle={record?.name || bv} movieId={record?.id} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Phone: AI analysis below */}
      {isPhone && tab === "study" && hasSubs && (
        <div className="max-h-[40%] shrink-0 overflow-y-auto border-t border-border/50 p-3">
          <h2 className="font-display text-sm text-foreground">台词精读</h2>
          <div className="mt-2">
            <StudyAnalysisColumn study={study} movieTitle={record?.name || bv} movieId={record?.id} />
          </div>
        </div>
      )}
    </div>
  );
}