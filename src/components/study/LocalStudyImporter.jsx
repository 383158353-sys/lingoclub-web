import React, { useState, useRef } from "react";
import { FileVideo, FileText, Play, Loader2, Info, ImagePlus, CheckCircle2, AlertCircle } from "lucide-react";
import PageBackButton from "@/components/common/PageBackButton";
import { parseTranscript } from "@/lib/transcriptParser";
import { mergeFragments } from "@/lib/subtitleCleaner";
import { useToast } from "@/components/ui/use-toast";
import { fetchYouTubeMeta } from "@/lib/localApi";
import { transcribeYouTubeClient } from "@/lib/youtubeTranscriptClient";
import LocalPosterPicker from "@/components/study/LocalPosterPicker";

const fileStem = (name) => String(name || "").replace(/\.[^.]+$/, "").toLowerCase();

// 我的海报 · 导入新影片：拖拽上传本地视频 + 字幕（或粘贴字幕） + 海报图，
// 影片名由用户输入。视频与字幕用 URL.createObjectURL 直接喂给播放器（不上服务器）；
// 海报与影片名随材料一同写入浏览器本地（IndexedDB），下次直接可见。
export default function LocalStudyImporter({ onReady, onCancel, saving }) {
  const [videoUrl, setVideoUrl] = useState("");
  const [videoFile, setVideoFile] = useState(null);
  const [videoHandle, setVideoHandle] = useState(null);
  const [videoName, setVideoName] = useState("");
  const [movieName, setMovieName] = useState("");
  const [posterUrl, setPosterUrl] = useState("");
  const [posterFile, setPosterFile] = useState(null);
  const [subtitleMode, setSubtitleMode] = useState("file"); // file | paste
  const [subText, setSubText] = useState("");
  const [subName, setSubName] = useState("");
  const [subtitleHandle, setSubtitleHandle] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [videoUrlInput, setVideoUrlInput] = useState("");
  const [fetchingMeta, setFetchingMeta] = useState(false);
  const [originalTitle, setOriginalTitle] = useState("");
  const [fetchingSubs, setFetchingSubs] = useState(false);
  const [fetchedSubs, setFetchedSubs] = useState(null);
  const [subError, setSubError] = useState("");
  const lastFetchedUrlRef = useRef("");
  const fallbackVideoInputRef = useRef(null);
  const fallbackSubtitleInputRef = useRef(null);
  const { toast } = useToast();

  const pickVideo = (f, handle = null) => {
    if (!f) return;
    const supportedExt = /\.(mp4|webm|mov|m4v)$/i.test(f.name);
    if (!f.type.startsWith("video/") && !/\.(mp4|webm|mov|m4v|mkv|avi)$/i.test(f.name)) {
      toast({ title: "所选文件不是可用视频", description: "支持 MP4 / WebM / MOV / M4V；MKV / AVI 建议先转码为 MP4 / WebM。", variant: "destructive" });
      return;
    }
    if (!supportedExt) {
      toast({ title: "浏览器可能无法直接播放该格式", description: "MKV / AVI 等浏览器原生 video 不一定支持，建议转码为 MP4 / WebM 后再导入。", variant: "destructive" });
    }
    if (videoUrl) { try { URL.revokeObjectURL(videoUrl); } catch { /* noop */ } }
    const url = URL.createObjectURL(f);
    setVideoUrl(url);
    setVideoFile(f);
    setVideoHandle(handle);
    setVideoName(f.name);
    // 影片名留空时用不带扩展名的文件名预填，便于编辑。
    if (!movieName) setMovieName(f.name.replace(/\.[^.]+$/, ""));
  };

  const chooseVideoFile = async () => {
    if (!window.showOpenFilePicker) {
      fallbackVideoInputRef.current?.click();
      return;
    }
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: "视频文件", accept: { "video/*": [".mp4", ".webm", ".mov", ".m4v", ".mkv", ".avi"] } }],
      });
      pickVideo(await handle.getFile(), handle);
    } catch (error) {
      if (error?.name !== "AbortError") toast({ title: "无法读取所选视频", description: error?.message || "请重试", variant: "destructive" });
    }
  };

  const onUrlChange = async (url) => {
    setVideoUrlInput(url);
    const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (ytMatch) {
      // 避免同一 URL 重复抓取
      if (lastFetchedUrlRef.current === url) return;
      lastFetchedUrlRef.current = url;

      setFetchingMeta(true);
      setFetchingSubs(true);
      setFetchedSubs(null);
      setSubError("");
      try {
        const data = await fetchYouTubeMeta(url);
        if (data?.title) { setMovieName(data.title); setOriginalTitle(data.title); }
        if (data?.thumbnail_url && !posterUrl) setPosterUrl(data.thumbnail_url);
      } catch { /* noop */ }
      finally { setFetchingMeta(false); }

      // 自动抓取字幕（含时间戳）——与桌面端书签导入效果一致
      try {
        const { lines, error } = await transcribeYouTubeClient(url);
        if (lines && lines.length) {
          setFetchedSubs(lines);
          setSubtitleMode("paste");
        } else if (error) {
          setSubError(error);
        }
      } catch (e) {
        setSubError(e?.message || "字幕获取失败");
      } finally {
        setFetchingSubs(false);
      }
    } else {
      // 非 YouTube 链接：清除已抓取的字幕
      lastFetchedUrlRef.current = "";
      setFetchedSubs(null);
      setSubError("");
      setFetchingSubs(false);
    }
  };

  const pickSubtitle = (f, handle = null) => {
    if (!f) return;
    setSubtitleHandle(handle);
    const reader = new FileReader();
    reader.onload = () => setSubText(String(reader.result || ""));
    reader.onerror = () => toast({ title: "读取字幕失败", variant: "destructive" });
    reader.readAsText(f);
    setSubName(f.name);
  };

  const chooseSubtitleFile = async () => {
    if (!window.showOpenFilePicker) {
      fallbackSubtitleInputRef.current?.click();
      return;
    }
    try {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [{ description: "字幕文件", accept: { "text/plain": [".srt", ".vtt", ".txt"] } }],
      });
      const entries = await Promise.all(handles.map(async (handle) => ({ handle, file: await handle.getFile() })));
      const preferred = entries.find((entry) => videoFile && fileStem(entry.file.name) === fileStem(videoFile.name)) || (entries.length === 1 ? entries[0] : null);
      if (!preferred) {
        toast({ title: "请选择与影片同名的字幕", description: "也可以选择字幕文件夹，让系统按文件名自动匹配。" });
        return;
      }
      pickSubtitle(preferred.file, preferred.handle);
      setSubtitleMode("file");
    } catch (error) {
      if (error?.name !== "AbortError") toast({ title: "无法读取所选字幕", description: error?.message || "请重试", variant: "destructive" });
    }
  };

  const start = async () => {
    const finalVideoUrl = videoUrlInput.trim() || videoUrl;
    if (!finalVideoUrl) { toast({ title: "请先添加视频", variant: "destructive" }); return; }
    const persistentVideoHandle = videoHandle;
    const persistentVideoFile = videoFile;
    const finalName = movieName.trim() || videoName.replace(/\.[^.]+$/, "").trim() || "未命名影片";
    setParsing(true);
    try {
      let subs = [];
      if (fetchedSubs && fetchedSubs.length) {
        // YouTube 链接自动抓取的字幕（已含时间戳，已合并为完整句）
        subs = fetchedSubs.map((p, i) => ({
          id: `local-${i + 1}`,
          text_en: p.text_en || "",
          text_zh: p.text_zh || "",
          speaker: p.speaker || "",
          time_start: p.time_start || "",
          time_end: p.time_end || "",
          order: i + 1,
          timestamp: p.time_start || "",
        }));
      } else if (subText.trim()) {
        const parsed = mergeFragments(parseTranscript(subText, 1800));
        if (!parsed?.length) {
          toast({ title: "未解析出台词", description: "请确认文件格式（SRT / WebVTT / 带时间码文本）。留空字幕可直接播放。", variant: "destructive" });
          return;
        }
        subs = parsed.map((p, i) => ({
          id: `local-${i + 1}`,
          text_en: p.text_en || "",
          text_zh: p.text_zh || "",
          speaker: p.speaker || "",
          time_start: p.time_start || "",
          time_end: p.time_end || "",
          order: p.order ?? i + 1,
          timestamp: p.time_start || "",
        }));
      }
      // Local poster Files are written as Blob assets to IndexedDB by the repository.
      const finalPoster = posterFile ? "" : (posterUrl && !posterUrl.startsWith("blob:") ? posterUrl : "");
      onReady({ videoUrl: finalVideoUrl, videoFile: persistentVideoFile, videoHandle: persistentVideoHandle, subtitleHandle, videoName: finalName, movieName: finalName, originalTitle, subtitles: subs, posterUrl: finalPoster, posterFile });
    } catch (e) {
      toast({ title: "处理失败", description: e?.message, variant: "destructive" });
    } finally {
      setParsing(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-5 pt-28 pb-20">
      {onCancel && <div className="mb-3"><PageBackButton onClick={onCancel} disabled={parsing || saving} /></div>}
      <p className="text-[11px] uppercase tracking-luxe text-copper/80">工具箱 · 我的影片</p>
      <h1 className="mt-2 font-display text-3xl leading-tight text-foreground md:text-4xl">导入新影片</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        选择本地视频后即可开始学习。支持的浏览器会记住本地文件引用；其他浏览器会在当前页面读取所选文件，不会复制视频。字幕与海报均为可选。
      </p>

      <div className="mt-6 flex items-start gap-2 rounded-lg border border-mint/30 bg-mint/10 px-3 py-2 text-xs leading-relaxed text-foreground/90">
        <Info size={13} className="mt-0.5 shrink-0 text-mint" />
        <span>视频始终保留在原磁盘，不会复制或上传。刷新后如果浏览器无法恢复本地文件，请重新选择视频；字幕、收藏和学习记录会正常保留。</span>
      </div>

      <div className="mt-6 grid gap-5">
        {/* 影片名 + 海报 */}
        <div className="rounded-2xl border border-border bg-background-elev/40 p-5">
          <div className="flex items-center gap-2">
            <ImagePlus size={16} className="text-copper" />
            <h2 className="font-display text-sm text-foreground">1 · 影片名与海报</h2>
          </div>
          <input
            value={movieName}
            onChange={(e) => setMovieName(e.target.value)}
            placeholder="影片名（选填，留空用文件名）"
            className="mt-3 w-full rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm text-foreground focus:border-copper/50 focus:outline-none"
          />
          <div className="mt-3">
            <LocalPosterPicker title={movieName} type="movie" selectedUrl={posterUrl} onSelect={({ file, url }) => { setPosterFile(file); setPosterUrl(url); }} />
          </div>
        </div>

        {/* 视频拖拽 */}
        <div className="rounded-2xl border border-border bg-background-elev/40 p-5">
          <div className="flex items-center gap-2">
            <FileVideo size={16} className="text-copper" />
            <h2 className="font-display text-sm text-foreground">2 · 添加视频</h2>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input
              value={videoUrlInput}
              onChange={(e) => onUrlChange(e.target.value)}
              placeholder="粘贴 YouTube 链接，自动获取标题、封面和字幕"
              className="flex-1 rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm text-foreground focus:border-copper/50 focus:outline-none"
            />
            {(fetchingMeta || fetchingSubs) && <Loader2 size={16} className="animate-spin text-copper" />}
          </div>
          <div className="relative mt-3">
            <input ref={fallbackVideoInputRef} type="file" accept="video/*,.mp4,.webm,.mov,.m4v,.mkv,.avi" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) pickVideo(file, null); event.target.value = ""; }} />
            <button type="button" onClick={chooseVideoFile} className="inline-flex items-center gap-2 rounded-lg border border-dashed border-copper/40 px-3.5 py-2.5 text-sm text-copper hover:bg-copper/5"><FileVideo size={15} />{videoName ? `已选择：${videoFile?.name || videoName}` : "选择本地视频"}</button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">视频只从当前设备读取，不会复制或上传。刷新后无法恢复时，请重新选择本地视频；字幕和学习资料会保留。</p>
        </div>

        {/* 字幕拖拽 / 粘贴 */}
        <div className="rounded-2xl border border-border bg-background-elev/40 p-5">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-copper" />
            <h2 className="font-display text-sm text-foreground">3 · 提供字幕</h2>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {subtitleMode === "file" ? (
              <div className="relative">
                <input ref={fallbackSubtitleInputRef} type="file" multiple accept=".srt,.vtt,.txt,text/plain" className="hidden" onChange={(event) => { const files = Array.from(event.target.files || []); const preferred = files.find((file) => videoFile && fileStem(file.name) === fileStem(videoFile.name)) || (files.length === 1 ? files[0] : null); if (preferred) { pickSubtitle(preferred, null); setSubtitleMode("file"); } else if (files.length) toast({ title: "请选择与影片同名的字幕", description: "当前影片会与同名字幕自动匹配。", variant: "destructive" }); event.target.value = ""; }} />
                <button type="button" onClick={chooseSubtitleFile} className="inline-flex items-center gap-2 rounded-lg border border-dashed border-border px-3.5 py-2.5 text-sm text-foreground hover:bg-muted/40"><FileText size={15} />{subName ? `已选择：${subName}` : "选择本地字幕（可选）"}</button>
              </div>
            ) : (
              <button type="button" onClick={() => setSubtitleMode("file")} className="rounded-lg border border-border px-3.5 py-2.5 text-xs text-muted-foreground">选择本地字幕（可选）</button>
            )}
            <button type="button" onClick={() => setSubtitleMode("paste")} className="rounded-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">粘贴字幕文本</button>
          </div>
          {/* YouTube 字幕自动抓取状态 */}
          {fetchingSubs && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-copper/30 bg-copper/5 px-3 py-2 text-xs text-foreground/90">
              <Loader2 size={13} className="animate-spin text-copper" />
              <span>正在自动获取 YouTube 字幕…</span>
            </div>
          )}
          {fetchedSubs && !fetchingSubs && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-mint/30 bg-mint/10 px-3 py-2 text-xs text-foreground/90">
              <CheckCircle2 size={13} className="shrink-0 text-mint" />
              <span>已自动获取 {fetchedSubs.length} 条字幕（含时间戳），可直接进入精读学习。</span>
            </div>
          )}
          {subError && !fetchingSubs && !fetchedSubs && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-foreground/90">
              <AlertCircle size={13} className="mt-0.5 shrink-0 text-amber-400" />
              <div>
                <p>字幕自动获取失败：{subError}</p>
                <p className="mt-0.5 text-muted-foreground">可选择本地字幕文件，或在 YouTube 页面复制转录文本后粘贴到下方。</p>
              </div>
            </div>
          )}
          {subtitleMode === "paste" && (
            <textarea
              value={subText}
              onChange={(e) => { setSubText(e.target.value); if (fetchedSubs) { setFetchedSubs(null); setSubError(""); } }}
              placeholder={fetchedSubs ? "字幕已自动获取，如需修改可在此编辑覆盖" : "粘贴 SRT / WebVTT 或带时间码的文本，例如：\n00:01 Hello, world\n00:04 This is a subtitle"}
              className="mt-3 h-40 w-full resize-y rounded-xl border border-border bg-background/60 px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground focus:border-copper/50 focus:outline-none"
            />
          )}
        </div>

        <button
          type="button"
          onClick={start}
          disabled={parsing || saving}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-copper px-6 py-3 text-sm font-semibold text-copper-foreground transition-transform hover:scale-[1.02] disabled:opacity-50"
        >
          {saving || parsing ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          {saving ? "保存到我的影片…" : parsing ? "解析中…" : (subText.trim() || (fetchedSubs && fetchedSubs.length)) ? "进入精读学习" : "开始播放（无字幕）"}
        </button>
      </div>
    </div>
  );
}
