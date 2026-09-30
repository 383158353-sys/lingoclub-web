import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import { validateVideoUrl, urlHost } from "@/components/study/EpisodeVideoUrlEditor";
import { Link2, Loader2, Save, X, Pencil } from "lucide-react";

// 管理工坊剧集行内:直接粘贴 B站 / YouTube 链接即可绑定到本集,无需进入剧集页。
// 链接校验复用 EpisodeVideoUrlEditor(拒绝 b23.tv 短链,仅放行 bilibili.com/video/BV… 与 YouTube)。
export default function InlineEpisodeVideoBinder({ episode, onSaved }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(!episode.video_url);
  const [url, setUrl] = useState(episode.video_url || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    const e = validateVideoUrl(url);
    if (e) { setErr(e); return; }
    setErr("");
    setSaving(true);
    try {
      const updated = await base44.entities.Episode.update(episode.id, { video_url: url.trim() });
      onSaved?.(updated);
      setOpen(false);
      toast({ title: "视频已绑定到本集", description: episode.title });
    } catch (e2) {
      toast({ title: "保存失败", description: e2?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!open && episode.video_url) {
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="inline-flex items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-2 py-0.5 text-mint">
          <Link2 size={10} /> {urlHost(episode.video_url)}
        </span>
        <button
          type="button"
          onClick={() => { setUrl(episode.video_url); setErr(""); setOpen(true); }}
          className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-muted-foreground transition-colors hover:text-copper"
        >
          <Pencil size={10} /> 更换
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-1.5 sm:flex-row sm:items-start">
      <input
        value={url}
        onChange={(e) => { setUrl(e.target.value); setErr(""); }}
        placeholder="粘贴 B站或 YouTube 链接，直接绑定到本集"
        className="flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-copper/50 focus:outline-none"
        onKeyDown={(e) => { if (e.key === "Enter") save(); }}
      />
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1 rounded-full bg-copper px-3 py-1.5 text-xs font-medium text-copper-foreground disabled:opacity-50"
        >
          {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />} 绑定
        </button>
        {episode.video_url && (
          <button
            type="button"
            onClick={() => { setOpen(false); setErr(""); }}
            className="inline-flex items-center rounded-full border border-border px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <X size={11} />
          </button>
        )}
      </div>
      {err && <p className="text-[11px] text-rose-300">{err}</p>}
    </div>
  );
}