import React, { useState, useRef } from "react";
import { Play, Loader2, ArrowLeft, CheckCircle2, AlertCircle, Link2, Smartphone, Monitor, RotateCw } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { fetchYouTubeMeta } from "@/lib/localApi";
import { extractYouTubeId, normalizeYouTubeUrl, transcribeYouTubeClient } from "@/lib/youtubeTranscriptClient";
import { Image as BaseImage } from "@/components/ui/image";
import { MobileTutorial, DesktopTutorial } from "./YoutubeImportGuide";

// 「我的视频」专用导入器：移动端粘贴 YouTube 链接自动获取标题、封面和
// 带时间戳的 CC 字幕；电脑端用书签一键提取字幕。与本地文件导入完全分离。
export default function YoutubeLinkImporter({ onReady, onCancel, saving }) {
  const [url, setUrl] = useState("");
  const [fetchingMeta, setFetchingMeta] = useState(false);
  const [fetchingSubs, setFetchingSubs] = useState(false);
  const [title, setTitle] = useState("");
  const [originalTitle, setOriginalTitle] = useState("");
  const [posterUrl, setPosterUrl] = useState("");
  const [subtitles, setSubtitles] = useState(null);
  const [subError, setSubError] = useState("");
  const lastFetchedRef = useRef("");
  const activeRequestRef = useRef(null);
  const { toast } = useToast();
  const [tab, setTab] = useState(() => {
    if (typeof window === "undefined") return "mobile";
    const ua = navigator.userAgent || "";
    if (/iPhone|iPad|iPod|Android|Mobile/i.test(ua)) return "mobile";
    return "desktop";
  });

  // 获取标题/封面 + CC 字幕。force=true 时绕过去重，用于"重试"按钮——
  // YouTube 风控与公共代理都偶发失败，首次没读到时用户应能一键重试，而不
  // 必反复改链接去绕开 lastFetchedRef 去重。
  const fetchMetaAndSubs = async (val, { force = false } = {}) => {
    const videoId = extractYouTubeId(val);
    if (!videoId) {
      activeRequestRef.current = null;
      lastFetchedRef.current = "";
      setSubtitles(null);
      setSubError("");
      setFetchingMeta(false);
      setFetchingSubs(false);
      return;
    }
    const canonicalUrl = normalizeYouTubeUrl(val);
    if (!force && lastFetchedRef.current === videoId) return;
    if (activeRequestRef.current === videoId) return;
    lastFetchedRef.current = videoId;
    activeRequestRef.current = videoId;

    setFetchingMeta(true);
    setFetchingSubs(true);
    setSubtitles(null);
    setSubError("");

    // metadata 与 transcript 独立请求，任一失败都不会取消另一项。
    const metaRequest = (async () => {
      try {
        const data = await fetchYouTubeMeta(canonicalUrl);
        if (activeRequestRef.current !== videoId) return;
        if (data?.title) { setTitle(data.title); setOriginalTitle(data.title); }
        if (data?.thumbnail_url) setPosterUrl(data.thumbnail_url);
      } catch { /* metadata 失败不影响字幕 */ }
      finally { if (activeRequestRef.current === videoId) setFetchingMeta(false); }
    })();

    const transcriptRequest = (async () => {
      try {
        const { lines, error, title: transcriptTitle } = await transcribeYouTubeClient(canonicalUrl);
        if (activeRequestRef.current !== videoId) return;
        if (transcriptTitle) { setTitle(transcriptTitle); setOriginalTitle(transcriptTitle); }
        if (lines?.length) setSubtitles(lines);
        else setSubError(error || "未找到可用字幕轨");
      } catch (e) {
        if (activeRequestRef.current === videoId) setSubError(e?.message || "字幕获取失败");
      } finally {
        if (activeRequestRef.current === videoId) setFetchingSubs(false);
      }
    })();

    await Promise.allSettled([metaRequest, transcriptRequest]);
    if (activeRequestRef.current === videoId) activeRequestRef.current = null;
  };

  const onUrlChange = (val) => {
    setUrl(val);
    fetchMetaAndSubs(val, { force: false });
  };

  const retrySubs = () => {
    const trimmed = url.trim();
    if (!extractYouTubeId(trimmed)) {
      toast({ title: "请粘贴有效的 YouTube 链接", variant: "destructive" });
      return;
    }
    fetchMetaAndSubs(trimmed, { force: true });
  };

  const isValid = !!extractYouTubeId(url);
  const hasSubs = subtitles && subtitles.length > 0;
  const busy = fetchingMeta || fetchingSubs;

  const start = () => {
    const finalUrl = normalizeYouTubeUrl(url);
    if (!isValid) {
      toast({ title: "请粘贴有效的 YouTube 链接", variant: "destructive" });
      return;
    }
    const subs = (subtitles || []).map((p, i) => ({
      id: `yt-${i + 1}`,
      text_en: p.text_en || "",
      text_zh: "",
      speaker: "",
      time_start: p.time_start || "",
      time_end: p.time_end || "",
      order: i + 1,
      timestamp: p.time_start || "",
    }));
    onReady({
      videoUrl: finalUrl,
      videoName: title || "YouTube 视频",
      originalTitle,
      subtitles: subs,
      posterUrl: posterUrl || "",
    });
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-5 pt-28 pb-20">
      <p className="text-[11px] uppercase tracking-luxe text-copper/80">工具箱 · 我的视频</p>
      <h1 className="mt-2 font-display text-3xl leading-tight text-foreground md:text-4xl">导入 YouTube 视频</h1>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
        选择你的设备类型，查看对应的导入方式。移动端粘贴链接即可自动获取字幕，电脑端用书签一键提取。
      </p>

      {/* Tab 切换 */}
      <div className="mt-8 flex gap-2 rounded-full border border-border bg-background-elev/40 p-1">
        <button
          type="button"
          onClick={() => setTab("mobile")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition-colors ${
            tab === "mobile" ? "bg-mint text-background" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Smartphone size={15} /> 移动端（手机 / 平板）
        </button>
        <button
          type="button"
          onClick={() => setTab("desktop")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition-colors ${
            tab === "desktop" ? "bg-mint text-background" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Monitor size={15} /> 电脑端
        </button>
      </div>

      {/* ===== 移动端：粘贴链接 + 导入按钮 + 教程 ===== */}
      {tab === "mobile" && (
        <div className="mt-8 space-y-8">
          {/* 粘贴链接 + 导入按钮 */}
          <section className="rounded-2xl border border-copper/25 bg-gradient-to-br from-card to-background-elev/50 p-5 md:p-6">
            <div className="flex items-center gap-2">
              <Link2 size={16} className="text-copper" />
              <h2 className="font-display text-sm text-foreground">粘贴 YouTube 链接</h2>
            </div>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                value={url}
                onChange={(e) => onUrlChange(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=…  或  https://youtu.be/…"
                className="flex-1 rounded-xl border border-border bg-background/60 px-3 py-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-copper/50 focus:outline-none"
                autoFocus
              />
              <button
                type="button"
                onClick={start}
                disabled={saving || busy || !isValid}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-copper px-5 py-3 text-sm font-semibold text-copper-foreground transition-transform hover:scale-[1.02] disabled:opacity-50"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                {saving ? "保存中…" : "导入视频"}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground/70">
              YouTube「分享」按钮的短链 (youtu.be/…) 与网址栏长链 (youtube.com/watch?v=…) 均可直接粘贴，两种都能识别。
            </p>
            {busy && (
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 size={13} className="animate-spin text-copper" />
                <span>{fetchingMeta ? "正在获取标题和封面…" : "正在提取 CC 字幕（含时间戳）…"}</span>
              </div>
            )}
            {!busy && !hasSubs && isValid && (
              <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2">
                <span className="flex items-start gap-1.5 text-xs text-amber-400">
                  <AlertCircle size={13} className="mt-0.5 shrink-0" /> {subError || "字幕暂未读到（YouTube 风控/代理偶发失败），点重试通常即可获取"}
                </span>
                <button
                  type="button"
                  onClick={retrySubs}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-copper/40 bg-copper/10 px-3 py-1.5 text-[11px] font-medium text-copper transition-colors hover:bg-copper/20"
                >
                  <RotateCw size={12} /> 重试获取字幕
                </button>
              </div>
            )}
            {/* 预览卡片 */}
            {isValid && !busy && (title || posterUrl || hasSubs) && (
              <div className="mt-4 flex items-center gap-4 rounded-xl border border-border bg-background-elev/40 p-4">
                {posterUrl && (
                  <BaseImage src={posterUrl} alt={title} fittingType="fill" className="h-16 w-28 shrink-0 rounded-lg" />
                )}
                <div className="min-w-0 flex-1">
                  {title && <p className="truncate font-display text-sm text-foreground">{title}</p>}
                  {hasSubs ? (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-mint">
                      <CheckCircle2 size={13} /> 已提取 {subtitles.length} 条字幕（含时间戳）
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={retrySubs}
                      className="mt-1 inline-flex items-center gap-1 text-xs text-copper hover:underline"
                    >
                      <RotateCw size={12} /> 点此重试获取字幕
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* 下方教程 */}
          <MobileTutorial />

          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              <ArrowLeft size={15} /> 返回我的视频
            </button>
          )}
        </div>
      )}

      {/* ===== 电脑端：书签导入教程 ===== */}
      {tab === "desktop" && (
        <div className="mt-8 space-y-8">
          <DesktopTutorial />
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              <ArrowLeft size={15} /> 返回我的视频
            </button>
          )}
        </div>
      )}
    </div>
  );
}
