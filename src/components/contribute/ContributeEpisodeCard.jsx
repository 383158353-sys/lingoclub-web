import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Plus, Send, Link2 } from "lucide-react";

// Any logged-in user can propose an episode (with optional video link) to a
// community they did not create. The new Episode lands with contribution_status
// "pending" and only becomes visible to others after the community owner /
// admin approves it from StudioManage. After submitting the contributor is
// taken to the episode page where they can keep editing subtitles / scenes
// pending review.
export default function ContributeEpisodeCard({ movie, onContributed, joined = true }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const requireAuth = useRequireAuth();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", synopsis: "", video_url: "" });
  const [submitting, setSubmitting] = useState(false);

  if (!user) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-background-elev/30 p-6 text-center">
        <p className="text-sm text-muted-foreground">登录后即可向本小组投稿新剧集，提交后由小组拥有者或管理员审核通过后公开。</p>
        <button
          type="button"
          onClick={() => requireAuth()}
          className="mt-4 inline-flex items-center gap-2 rounded-full border border-copper/40 bg-copper/10 px-4 py-2 text-sm font-medium text-copper transition-transform hover:scale-[1.01]"
        >
          <Plus size={14} /> 登录后投稿
        </button>
      </div>
    );
  }

  if (joined === false) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 bg-background-elev/30 p-6 text-center">
        <p className="font-display text-base text-foreground">加入小组后即可投稿新剧集</p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          先加入本小组，再添加标题与视频链接提交，待小组拥有者或管理员审核通过后在小组列表公开。
        </p>
      </div>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSubmitting(true);
    try {
      const ep = await base44.entities.Episode.create({
        movie_id: movie.id,
        title: form.title,
        synopsis: form.synopsis,
        video_url: form.video_url,
        contribution_status: "draft",
        proposed_by_id: user.id,
        proposed_by_name: user.full_name || user.email || "社区成员",
        order: 99,
      });
      toast({ title: "已创建草稿", description: "在新页面继续完善台词与场景精读，完成后再点「提交审核」。" });
      onContributed?.(ep);
      navigate(`/episode/${ep.id}`);
    } catch (err) {
      toast({ title: "提交失败", description: err?.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <div className="rounded-2xl border border-dashed border-border/80 bg-background-elev/30 p-5">
        <p className="font-display text-base text-foreground">小组的每一集都来自大家</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">如果你也想翻译一份外语剧集，添上台词与精读，欢迎贡献一集。投稿后会先保存为草稿，你可在新页面继续完善台词与场景精读；编辑完成后点「提交审核」，由小组拥有者或管理员通过后在小组列表公开。</p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 inline-flex items-center gap-2 rounded-full border border-copper/40 bg-copper/10 px-4 py-2 text-sm font-medium text-copper transition-transform hover:scale-[1.01]"
        >
          <Plus size={14} /> 贡献新剧集
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-border/60 bg-card p-5">
      <p className="flex items-center gap-2 font-display text-base text-foreground"><Send size={14} className="text-copper" /> 投稿新剧集 · 先存草稿</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">填写标题、简介与视频链接（MP4 直链 或 bilibili.com/video/BV…，暂不支持 b23.tv 短链）。提交后会保存为草稿，进入剧集页继续完善台词与场景；编辑完成后点「提交审核」，由管理员通过后在小组列表公开。</p>
      <div className="mt-4 space-y-3">
        <Field label="标题" value={form.title} onChange={(v) => setForm({ ...form, title: v })} placeholder="例：开篇" />
        <Textarea label="简介（可选）" value={form.synopsis} onChange={(v) => setForm({ ...form, synopsis: v })} placeholder="本集内容概要" />
        <Field label="视频链接（可选）" value={form.video_url} onChange={(v) => setForm({ ...form, video_url: v })} placeholder="MP4 直链 或 bilibili.com/video/BV…" icon={Link2} />
      </div>
      <div className="mt-4 flex items-center gap-2">
        <button
          type="submit"
          disabled={submitting || !form.title.trim()}
          className="inline-flex items-center gap-2 rounded-full bg-copper px-4 py-2 text-sm font-medium text-copper-foreground disabled:opacity-50"
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} 保存草稿
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-full border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          取消
        </button>
      </div>
    </form>
  );
}

function Field({ label, value, onChange, placeholder, icon: Icon }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-luxe text-muted-foreground">{label}</span>
      <div className="relative mt-1.5">
        {Icon && <Icon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" />}
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full rounded-lg border border-border bg-background-elev/50 py-2 pr-3 text-sm text-[#3a2a1a] placeholder:text-[#8a7a6a]/70 focus:border-copper/50 focus:outline-none ${Icon ? "pl-9" : "pl-3"}`}
        />
      </div>
    </label>
  );
}

function Textarea({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-luxe text-muted-foreground">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        placeholder={placeholder}
        className="mt-1.5 w-full resize-none rounded-lg border border-border bg-background-elev/50 px-3 py-2 text-sm text-[#3a2a1a] placeholder:text-[#8a7a6a]/70 focus:border-copper/50 focus:outline-none"
      />
    </label>
  );
}