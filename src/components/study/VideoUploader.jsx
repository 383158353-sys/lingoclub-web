import React, { useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Upload, Link2, Loader2, Film } from "lucide-react";

// Admin-only: configure a play-on-site video for an episode.
// Long films exceed the 100MB upload cap, so we default to pasting a direct
// streamable URL (the in-page <video> player plays any MP4 URL). A small
// (<=100MB) clip can still be uploaded as a file.
export default function VideoUploader({ episodeId, onSaved }) {
  const inputRef = useRef(null);
  const [mode, setMode] = useState("url");
  const [url, setUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");

  const saveUrl = async (e) => {
    e.preventDefault();
    // 1) 从粘贴内容里提取第一个 URL —— B站「分享」按钮会复制成
    //    "【标题】 https://b23.tv/xxx 丹麦语..." 这类带前后缀的文本，
    //    直接 new URL() 会失败，所以先正则抠出 https://... 片段。
    const matched = url.match(/https?:\/\/[^\s，。、】]+/i);
    const u = (matched ? matched[0] : url).trim();
    if (!u) { setErr("请粘贴视频链接"); return; }
    try { new URL(u); } catch { setErr("链接格式不正确，请复制完整 https://... 链接"); return; }
    // 2) B站「分享」短链 b23.tv 是跳转链接，无法在站内 iframe 播放；
    //    引导用户改用地址栏的完整 bilibili.com/video/BV... 链接。
    if (/b23\.tv/i.test(new URL(u).hostname)) {
      setErr("暂不支持 b23.tv 分享短链。请在B站视频页用浏览器地址栏复制形如 bilibili.com/video/BV... 的完整链接。");
      return;
    }
    setUploading(true); setErr("");
    try {
      await base44.entities.Episode.update(episodeId, { video_url: u });
      onSaved?.(u);
      setUrl("");
    } catch (error) {
      setErr(error?.message || "保存失败，请重试");
    } finally { setUploading(false); }
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) {
      setErr("文件超过 100MB，整部长片请改用「粘贴整片链接」上传。");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setUploading(true); setErr("");
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      await base44.entities.Episode.update(episodeId, { video_url: file_url });
      onSaved?.(file_url);
    } catch (error) {
      setErr(error?.message || "上传失败，请重试");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="rounded-2xl border border-dashed border-border bg-background-elev/40 p-6">
      <Film size={24} className="mx-auto text-copper/70" />
      <p className="mt-2 text-center text-sm text-foreground">为本集配置视频</p>
      <p className="mt-1 text-center text-xs text-muted-foreground">MP4 直链任意长度；B站请用<b>浏览器地址栏</b>完整链接（bilibili.com/video/BV…），<b>不要</b>用「分享」按钮的 b23.tv 短链。单文件片段上限 100MB。</p>

      <div className="mt-4 flex justify-center gap-2 text-xs">
        <button type="button" onClick={() => setMode("url")} className={`rounded-full px-3 py-1 transition-colors ${mode === "url" ? "bg-copper text-copper-foreground" : "border border-border text-muted-foreground hover:text-foreground"}`}>粘贴整片链接</button>
        <button type="button" onClick={() => setMode("file")} className={`rounded-full px-3 py-1 transition-colors ${mode === "file" ? "bg-copper text-copper-foreground" : "border border-border text-muted-foreground hover:text-foreground"}`}>上传片段</button>
      </div>

      {mode === "url" ? (
        <form onSubmit={saveUrl} className="mt-4 flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="MP4 直链 或 bilibili.com/video/BV… 链接"
            className="flex-1 rounded-lg border border-border bg-background-elev/50 px-3 py-2 text-sm text-[#3a2a1a] placeholder:text-[#8a7a6a]/70 focus:border-copper/50 focus:outline-none"
          />
          <button type="submit" disabled={uploading} className="inline-flex items-center gap-2 rounded-full bg-copper px-4 py-2 text-sm font-medium text-copper-foreground transition-transform hover:scale-[1.02] disabled:opacity-50">
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} 保存
          </button>
        </form>
      ) : (
        <div className="mt-4 text-center">
          <input ref={inputRef} type="file" accept="video/*" className="hidden" onChange={handleFile} />
          <button type="button" disabled={uploading} onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-2 rounded-full bg-copper px-5 py-2 text-sm font-medium text-copper-foreground transition-transform hover:scale-[1.02] disabled:opacity-50">
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} 选择文件上传（≤100MB）
          </button>
        </div>
      )}

      {err && <p className="mt-3 text-center text-xs text-rose-300">{err}</p>}
    </div>
  );
}