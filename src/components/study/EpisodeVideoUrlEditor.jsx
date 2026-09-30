import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import { Link2, Loader2, Pencil, Save, X, ExternalLink } from "lucide-react";

// 仅创作者/管理员可见:为本集配置/更换视频链接(支持 B站完整链接 与 YouTube)。
// 无 video_url 时以输入框替代静态占位;已有链接时收起为"当前视频 + 更换"。
export const validateVideoUrl = (u) => {
  const s = (u || "").trim();
  if (!s) return "请粘贴视频链接";
  if (/b23\.tv\//i.test(s)) return "请粘贴完整 B 站链接，不支持 b23.tv 分享短链";
  const okYt = /youtube\.com\/(watch|embed)|youtu\.be\//i.test(s);
  const okBili = /bilibili\.com\/video\/(BV|av)|player\.bilibili\.com\/player/i.test(s);
  if (!okYt && !okBili) return "仅支持 B站(bilibili.com/video/BV…) 或 YouTube 链接";
  return "";
};

export const urlHost = (s) => {
  if (/bilibili\.com|player\.bilibili/i.test(s)) return "Bilibili";
  if (/youtube|youtu\.be/i.test(s)) return "YouTube";
  return "已配置";
};

export default function EpisodeVideoUrlEditor({ episode, onSaved }) {
  const [open, setOpen] = useState(!episode.video_url);
  const [url, setUrl] = useState(episode.video_url || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const { toast } = useToast();

  const save = async () => {
    const e = validateVideoUrl(url);
    if (e) { setErr(e); return; }
    setErr("");
    setSaving(true);
    try {
      const updated = await base44.entities.Episode.update(episode.id, { video_url: url.trim() });
      onSaved?.(updated);
      setOpen(false);
      toast({ title: "视频链接已保存" });
    } catch (e2) {
      toast({ title: "保存失败", description: e2?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!open && episode.video_url) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background-elev/40 px-3 py-1">
          <Link2 size={12} className="text-copper/80" /> 当前视频 · {urlHost(episode.video_url)}
        </span>
        <a href={episode.video_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-copper hover:underline">原站打开 <ExternalLink size={11} /></a>
        <button
          type="button"
          onClick={() => { setUrl(episode.video_url); setErr(""); setOpen(true); }}
          className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-muted-foreground hover:text-copper"
        >
          <Pencil size={12} /> 更换链接
        </button>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border border-dashed border-border bg-background-elev/30 ${episode.video_url ? "mt-3 p-4" : "p-8"}`}>
      <p className="text-[11px] uppercase tracking-luxe text-copper/80">配置本集视频</p>
      <p className="mt-1 text-sm text-muted-foreground">粘贴 B站(bilibili.com/video/BV…) 或 YouTube 完整链接，作为本集学习视频。</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={url}
          onChange={(e) => { setUrl(e.target.value); setErr(""); }}
          placeholder="https://www.bilibili.com/video/BV…  或  https://www.youtube.com/watch?v=…"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-copper/50 focus:outline-none"
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-full bg-copper px-4 py-2 text-sm font-medium text-copper-foreground disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} 保存
          </button>
          {episode.video_url && (
            <button
              type="button"
              onClick={() => { setOpen(false); setErr(""); }}
              className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <X size={13} /> 取消
            </button>
          )}
        </div>
      </div>
      {err && <p className="mt-2 text-xs text-rose-300">{err}</p>}
    </div>
  );
}