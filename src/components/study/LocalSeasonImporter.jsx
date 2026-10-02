import React, { Component, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FileVideo, FileText, Loader2 } from "lucide-react";
import PageBackButton from "@/components/common/PageBackButton";
import { parseTranscript } from "@/lib/transcriptParser";
import { mergeFragments } from "@/lib/subtitleCleaner";
import { buildSeasonEpisodeRows, formatEpisodeCode, normalizeSeasonFiles, parseEpisodeNumber, resolveSeasonSubtitle } from "@/lib/localSeason";
import { useToast } from "@/components/ui/use-toast";
import LocalPosterPicker from "@/components/study/LocalPosterPicker";

class PosterPickerBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.error("Local poster picker failed to render", error?.name || "Error"); }
  render() {
    if (this.state.failed) return <div className="rounded-xl border border-border/70 p-3 text-xs text-muted-foreground">封面暂不可用，仍可继续导入视频和字幕。</div>;
    return this.props.children;
  }
}

function fileEntries(fileList, prefix) {
  return Array.from(fileList || []).map((entry, index) => ({
    id: `${prefix}-${index}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
    file: entry?.file || entry,
    handle: entry?.handle || null,
  }));
}

export default function LocalSeasonImporter({ onReady, onCancel, saving }) {
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.documentElement.scrollLeft = 0;
    document.body.scrollLeft = 0;
  }, []);
  const [showTitle, setShowTitle] = useState("");
  const [coverFile, setCoverFile] = useState(null);
  const [coverUrl, setCoverUrl] = useState("");
  const [videos, setVideos] = useState([]);
  const [subtitleFiles, setSubtitleFiles] = useState([]);
  const videoEntriesRef = useRef(videos);
  const subtitleEntriesRef = useRef(subtitleFiles);
  const videoInputRef = useRef(null);
  const subtitleInputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(null);
  const { toast } = useToast();

  const inferredSeasonNumber = useMemo(() => {
    const counts = new Map();
    for (const entry of videos) {
      const number = parseEpisodeNumber(entry.file?.name)?.seasonNumber;
      if (number) counts.set(number, (counts.get(number) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] || null;
  }, [videos]);
  const rows = useMemo(() => buildSeasonEpisodeRows(videos, subtitleFiles), [videos, subtitleFiles]);
  const [overrides, setOverrides] = useState({});
  const getRow = (row) => ({ ...row, ...(overrides[row.key] || {}) });
  const setRow = (key, patch) => setOverrides((current) => ({ ...current, [key]: { ...current[key], ...patch } }));

  const appendFiles = (fileList, type) => {
    const entries = Array.from(fileList || []).map((entry) => entry?.file ? entry : { file: entry, handle: null });
    const normalized = normalizeSeasonFiles(entries.map((entry) => entry.file), type);
    if (normalized.wrongKind.length) {
      toast({ title: type === "video" ? "请将字幕拖到字幕区域" : "请将视频拖到视频区域", variant: normalized.accepted.length ? "default" : "destructive" });
    }
    if (normalized.wrongKind.length && !normalized.accepted.length) {
      return;
    }
    if (normalized.unsupported.length) toast({ title: `已忽略 ${normalized.unsupported.length} 个不支持的文件`, description: normalized.unsupported.slice(0, 3).map((file) => file.name).join("、") });
    const current = type === "video" ? videoEntriesRef.current : subtitleEntriesRef.current;
    const names = new Set(current.map((entry) => entry.file.name.toLowerCase()));
    const duplicates = [];
    const episodes = new Set(type === "video" ? current.map((entry) => parseEpisodeNumber(entry.file.name)?.episodeNumber).filter(Boolean) : []);
    for (const file of normalized.accepted) {
      const name = file.name.toLowerCase();
      const episode = type === "video" ? parseEpisodeNumber(file.name)?.episodeNumber : null;
      if (names.has(name)) duplicates.push(`${file.name}（文件名重复）`);
      else if (episode && episodes.has(episode)) duplicates.push(`${file.name}（第 ${episode} 集重复）`);
      names.add(name);
      if (episode) episodes.add(episode);
    }
    if (duplicates.length && !window.confirm(`发现重复文件名：${duplicates.join("、")}。仍要添加这些文件吗？`)) return;
    const acceptedEntries = normalized.accepted.map((file) => entries.find((entry) => entry.file === file) || { file, handle: null });
    const addedEntries = fileEntries(acceptedEntries, type);
    if (!addedEntries.length) return;
    if (type === "video") {
      videoEntriesRef.current = [...videoEntriesRef.current, ...addedEntries];
      setVideos(videoEntriesRef.current);
    } else {
      subtitleEntriesRef.current = [...subtitleEntriesRef.current, ...addedEntries];
      setSubtitleFiles(subtitleEntriesRef.current);
    }
  };

  const pickFiles = async (type) => {
    if (!window.showOpenFilePicker) {
      (type === "video" ? videoInputRef : subtitleInputRef).current?.click();
      return;
    }
    try {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: type === "video"
          ? [{ description: "视频文件", accept: { "video/*": [".mp4", ".webm", ".mov", ".m4v", ".mkv", ".avi"] } }]
          : [{ description: "字幕文件", accept: { "text/plain": [".srt", ".vtt", ".txt"] } }],
      });
      const entries = await Promise.all(handles.map(async (handle) => ({ handle, file: await handle.getFile() })));
      appendFiles(entries, type);
    } catch (error) {
      if (error?.name !== "AbortError") toast({ title: "无法读取所选文件", description: error?.message || "请重试", variant: "destructive" });
    }
  };

  const handleDrop = async (event, type) => {
    event.preventDefault();
    setDragging(null);
    const entries = [];
    for (const item of Array.from(event.dataTransfer?.items || [])) {
      if (item.kind !== "file") continue;
      try {
        const handle = await item.getAsFileSystemHandle?.();
        const file = handle?.kind === "file" ? await handle.getFile() : item.getAsFile();
        if (file) entries.push({ file, handle: handle?.kind === "file" ? handle : null });
      } catch {
        const file = item.getAsFile();
        if (file) entries.push({ file, handle: null });
      }
    }
    if (!entries.length) entries.push(...Array.from(event.dataTransfer?.files || [], (file) => ({ file, handle: null })));
    appendFiles(entries, type);
  };

  const ensurePersistentHandles = async (entries, kind) => {
    // Preserve handles only when the picker supplied them. Ordinary File
    // inputs and dropped files remain session-local and are never copied.
    return new Map(entries.map((entry) => [entry.id, entry.handle || null]));
  };

  const submit = async () => {
    const normalizedShowTitle = showTitle.trim();
    if (!normalizedShowTitle) { toast({ title: "请填写剧名", variant: "destructive" }); return; }
    if (!videos.length) { toast({ title: "请至少选择一个本地视频", variant: "destructive" }); return; }

    setBusy(true);
    try {
      const videoHandles = await ensurePersistentHandles(videos, "video");
      const selectedSubtitleIds = [...new Set(rows.map((row) => getRow(row).subtitleId).filter(Boolean))];
      const selectedSubtitleEntries = subtitleFiles.filter((entry) => selectedSubtitleIds.includes(entry.id));
      const subtitleHandles = selectedSubtitleEntries.length ? await ensurePersistentHandles(selectedSubtitleEntries, "subtitle") : new Map();
      const episodes = [];
      for (const rawRow of rows) {
        const row = getRow(rawRow);
        const number = Number(row.episodeNumber);
        if (!row.videoFile || typeof row.videoFile.name !== "string") throw new Error(`第 ${number || "?"} 集的视频文件不存在，请重新选择视频`);
        if (!Number.isInteger(number) || number < 1 || number > 999) throw new Error(`${row.videoFile.name} 的集数需为 1–999 的整数`);
        const videoEntry = videos.find((entry) => entry.id === row.key);
        const persistentHandle = videoEntry ? videoHandles.get(videoEntry.id) : null;
        const subtitleFile = resolveSeasonSubtitle(subtitleFiles, row.subtitleId);
        if (row.subtitleId && !subtitleFile) throw new Error(`${row.videoFile.name} 的字幕选择已失效，请重新选择配对`);
        const videoCode = parseEpisodeNumber(row.videoFile.name);
        const subtitleCode = parseEpisodeNumber(subtitleFile?.name);
        const subtitleMismatch = Boolean(videoCode && subtitleCode && (videoCode.episodeNumber !== subtitleCode.episodeNumber || (videoCode.seasonNumber != null && subtitleCode.seasonNumber != null && videoCode.seasonNumber !== subtitleCode.seasonNumber)));
        if (subtitleMismatch && !row.confirmSubtitleMismatch) throw new Error(`${formatEpisodeCode(videoCode.seasonNumber || inferredSeasonNumber || 1, videoCode.episodeNumber)} 与字幕 ${formatEpisodeCode(subtitleCode.seasonNumber || inferredSeasonNumber || 1, subtitleCode.episodeNumber)} 集数不匹配，请确认该行后再导入`);
        let subtitles = [];
        if (subtitleFile) {
          if (typeof subtitleFile.name !== "string" || typeof subtitleFile.text !== "function") throw new Error(`${row.videoFile.name} 对应的字幕文件无效，请重新选择`);
          const parsed = mergeFragments(parseTranscript(await subtitleFile.text(), 1800));
          subtitles = (parsed || []).map((cue, index) => ({
            id: `local-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`}`,
            text_en: cue.text_en || "",
            text_zh: cue.text_zh || "",
            speaker: cue.speaker || "",
            time_start: cue.time_start || "",
            time_end: cue.time_end || "",
            order: cue.order ?? index + 1,
            timestamp: cue.time_start || "",
          }));
          if (!subtitles.length) throw new Error(`${subtitleFile.name} 未解析出字幕，请检查文件格式或更换配对`);
        }
        const subtitleEntry = subtitleFiles.find((entry) => entry.id === row.subtitleId);
        episodes.push({ episodeNumber: number, videoFile: videoEntry.file, videoHandle: persistentHandle, subtitleFile, subtitleHandle: subtitleEntry ? subtitleHandles.get(subtitleEntry.id) || subtitleEntry.handle || null : null, title: row.title.trim(), subtitles });
      }
      const diagnostics = episodes.map((episode) => ({
        episodeNumber: episode.episodeNumber,
        videoExists: Boolean(episode.videoFile),
        videoName: episode.videoFile?.name || null,
        subtitleExists: Boolean(episode.subtitleFile),
        subtitleName: episode.subtitleFile?.name || null,
        posterExists: Boolean(coverFile),
      }));
      console.info("[LocalSeasonImporter] pre-save episode diagnostics", diagnostics);
      if (typeof window !== "undefined") window.__LINGOCLUB_LOCAL_SEASON_IMPORT__ = { showTitle: normalizedShowTitle, seasonNumber: inferredSeasonNumber, episodes: diagnostics, recordedAt: new Date().toISOString() };
      await onReady({ showTitle: normalizedShowTitle, seasonNumber: inferredSeasonNumber, seasonCoverFile: coverFile, episodes });
    } catch (error) {
      toast({ title: "剧集导入未完成", description: error?.message || "请检查视频与字幕文件", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="local-season-importer" className="min-h-screen w-full max-w-full overflow-x-hidden">
      <div className="mx-auto w-full max-w-4xl min-w-0 px-4 pt-20 pb-16 md:px-8 md:pt-28">
      <div className="mb-3"><PageBackButton onClick={onCancel}>返回我的影片</PageBackButton></div>
      <h1 className="mt-2 font-display text-2xl text-foreground md:text-3xl">导入剧集</h1>
      <p className="mt-2 text-sm text-muted-foreground">可多选视频和字幕，也可拖入文件预览配对。视频不会复制或上传；刷新后无法恢复文件时，重新选择原视频即可。字幕、收藏和学习进度会保留。</p>

      <div className="mt-6 grid gap-4 rounded-2xl border border-border bg-background-elev/30 p-4 md:grid-cols-[1fr_10rem_1fr] md:p-5">
        <label className="text-xs text-muted-foreground md:col-span-3">项目名称
          <input value={showTitle} onChange={(event) => setShowTitle(event.target.value)} placeholder="例如 绝望写手 第二季" className="mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground" />
        </label>
      </div>

      <div className="mt-4 min-w-0 max-w-full">
        <PosterPickerBoundary>
        <LocalPosterPicker title={showTitle} type="tv" selectedUrl={coverUrl} onSelect={({ file, url }) => { setCoverFile(file); setCoverUrl(url); }} />
        </PosterPickerBoundary>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div onDragEnter={(event) => { event.preventDefault(); setDragging("video"); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(null); }} onDrop={(event) => handleDrop(event, "video")} className={`relative rounded-xl border p-3 transition-colors ${dragging === "video" ? "border-copper bg-copper/5" : "border-border"}`}>
          <p className="mb-2 flex items-center gap-2 text-xs font-medium text-foreground"><FileVideo size={15} className="text-copper" />视频</p>
          <input ref={videoInputRef} type="file" multiple accept="video/*,.mp4,.webm,.mov,.m4v,.mkv,.avi" className="hidden" onChange={(event) => { appendFiles(event.target.files, "video"); event.target.value = ""; }} />
          <button type="button" onClick={() => pickFiles("video")} className="flex w-full items-center justify-between rounded-lg border border-dashed border-copper/40 px-3 py-2.5 text-sm text-copper hover:bg-copper/5"><span>选择多个视频{videos.length ? ` · 已选 ${videos.length} 个` : ""}</span></button>
          {dragging === "video" && <p className="mt-2 text-xs text-copper">松开以添加视频</p>}
        </div>
        <div onDragEnter={(event) => { event.preventDefault(); setDragging("subtitle"); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(null); }} onDrop={(event) => handleDrop(event, "subtitle")} className={`relative rounded-xl border p-3 transition-colors ${dragging === "subtitle" ? "border-copper bg-copper/5" : "border-border"}`}>
          <p className="mb-2 flex items-center gap-2 text-xs font-medium text-foreground"><FileText size={15} className="text-copper" />字幕（可选）</p>
          <input ref={subtitleInputRef} type="file" multiple accept=".srt,.vtt,.txt,text/plain" className="hidden" onChange={(event) => { appendFiles(event.target.files, "subtitle"); event.target.value = ""; }} />
          <button type="button" onClick={() => pickFiles("subtitle")} className="flex w-full items-center justify-between rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-foreground hover:bg-muted/40"><span>选择多个字幕{subtitleFiles.length ? ` · 已选 ${subtitleFiles.length} 个` : ""}</span></button>
          {dragging === "subtitle" && <p className="mt-2 text-xs text-copper">松开以添加字幕</p>}
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">拖入文件可先预览配对。兼容浏览器会把视频 Blob 尝试保存到当前设备的浏览器存储；空间不足时仍可本次播放，之后可能需要重新选择。</p>

      {!!videos.length && (
        <div className="mt-5 min-w-0 max-w-full overflow-hidden rounded-xl border border-border">
          <div className="grid grid-cols-1 gap-2 bg-background-elev/60 px-3 py-2 text-[11px] font-medium text-muted-foreground md:grid-cols-[minmax(0,1fr)_5.5rem_minmax(0,1fr)]">
            <span>视频</span><span>集数</span><span>字幕配对</span>
          </div>
          <div className="divide-y divide-border/60">
            {rows.map((rawRow) => {
              const row = getRow(rawRow);
              return (
                <div key={row.key} className="grid min-w-0 max-w-full grid-cols-1 items-center gap-2 px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_5.5rem_minmax(0,1fr)]">
                  <div className="min-w-0">
                  <p className="truncate text-xs text-foreground">{row.videoFile?.name || "视频文件缺失"}</p>
                  <input value={row.title} onChange={(event) => setRow(row.key, { title: event.target.value })} placeholder={`${formatEpisodeCode(inferredSeasonNumber, row.episodeNumber)} 标题（选填）`} className="mt-1 w-full bg-transparent text-[11px] text-muted-foreground outline-none placeholder:text-muted-foreground/50" />
                </div>
                  <input type="number" min="1" max="999" value={row.episodeNumber} onChange={(event) => setRow(row.key, { episodeNumber: event.target.value, confirmSubtitleMismatch: false })} aria-label={`${row.videoFile?.name || "视频"} 集数`} className="min-w-0 max-w-full w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground" />
                  <select value={row.subtitleId} onChange={(event) => setRow(row.key, { subtitleId: event.target.value, confirmSubtitleMismatch: false })} aria-label={`${row.videoFile?.name || "视频"} 字幕配对`} className="min-w-0 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground">
                    <option value="">不配字幕</option>
                    {subtitleFiles.map((entry) => <option key={entry.id} value={entry.id}>{entry.file.name}</option>)}
                  </select>
                  {(() => {
                    const selected = subtitleFiles.find((entry) => entry.id === row.subtitleId)?.file;
                    const videoCode = parseEpisodeNumber(row.videoFile?.name);
                    const subtitleCode = parseEpisodeNumber(selected?.name);
                    const mismatch = Boolean(videoCode && subtitleCode && (videoCode.episodeNumber !== subtitleCode.episodeNumber || (videoCode.seasonNumber != null && subtitleCode.seasonNumber != null && videoCode.seasonNumber !== subtitleCode.seasonNumber)));
                    return selected ? <div className={`col-span-3 text-[10px] ${mismatch ? "text-rose-300" : "text-muted-foreground"}`}>
                      <span>{formatEpisodeCode(videoCode?.seasonNumber || inferredSeasonNumber || 1, Number(row.episodeNumber))} · 视频：{row.videoFile?.name}</span>
                      <span className="ml-1">字幕：{selected.name} {mismatch ? "· 集数不匹配" : "✓"}</span>
                      {mismatch && <label className="mt-1 flex items-center gap-1.5 text-rose-200"><input type="checkbox" checked={Boolean(row.confirmSubtitleMismatch)} onChange={(event) => setRow(row.key, { confirmSubtitleMismatch: event.target.checked })} />仍然按此配对导入</label>}
                    </div> : null;
                  })()}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <button type="button" onClick={submit} disabled={busy || saving} className="inline-flex items-center gap-2 rounded-full bg-copper px-5 py-2.5 text-sm font-medium text-copper-foreground disabled:opacity-50">
          {(busy || saving) && <Loader2 size={14} className="animate-spin" />}{busy || saving ? "导入中…" : `导入 ${videos.length || "本季"} 集`}
        </button>
      </div>
      </div>
    </div>
  );
}
