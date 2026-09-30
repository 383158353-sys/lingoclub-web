import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import ImageUploadField from "@/components/common/ImageUploadField";
import { Check, Loader2 } from "lucide-react";

// Post-publish editor for a Movie community. Lets the creator keep editing
// every field they set at creation time — title (中/英), tagline, intro, the
// poster & recommendation images, difficulty, monthly price — directly from
// the studio manage page. Visibility states are untouched here (admin review
// still controls public vs. private), but the publish-time fields stay
// editable for the life of the project.
export default function MovieMetaForm({ movie, onSaved }) {
  const { toast } = useToast();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  // Re-sync the form whenever the underlying movie record changes (initial
  // load, after a save round-trip, or after an external update).
  useEffect(() => {
    if (!movie) return;
    setForm({
      title: movie.title || "",
      title_en: movie.title_en || "",
      tagline: movie.tagline || "",
      description: movie.description || "",
      poster_url: movie.poster_url || "",
      backdrop_url: movie.backdrop_url || "",
      difficulty: movie.difficulty || "intermediate",
      price_credits: movie.price_credits || 0,
    });
  }, [movie?.id, movie?.updated_date]);

  if (!form || !movie) return null;

  const dirty =
    form.title !== (movie.title || "") ||
    form.title_en !== (movie.title_en || "") ||
    form.tagline !== (movie.tagline || "") ||
    form.description !== (movie.description || "") ||
    form.poster_url !== (movie.poster_url || "") ||
    form.backdrop_url !== (movie.backdrop_url || "") ||
    form.difficulty !== (movie.difficulty || "intermediate") ||
    Number(form.price_credits) !== Number(movie.price_credits || 0);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await base44.entities.Movie.update(movie.id, {
        title: form.title.trim() || movie.title,
        title_en: form.title_en,
        tagline: form.tagline,
        description: form.description,
        poster_url: form.poster_url,
        backdrop_url: form.backdrop_url,
        difficulty: form.difficulty,
        price_credits: Number(form.price_credits) || 0,
      });
      toast({ title: "已保存", description: "项目信息已更新，社区页面同步生效。" });
      onSaved?.(updated);
    } catch (e) {
      toast({ title: "保存失败", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); save(); }}
      className="rounded-2xl border border-border/60 bg-card p-6 h-fit"
    >
      <h2 className="font-display text-lg text-foreground">编辑项目信息</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        发布后仍可随时修改：标题、标语、简介、封面与推荐图、难度与加入所需积分。保存后社区页面即时同步。
      </p>
      <div className="mt-4 space-y-3">
        <Field label="片名（中）" value={form.title} onChange={(v) => setForm({ ...form, title: v })} placeholder="例：布达佩斯大饭店" />
        <Field label="片名（英）" value={form.title_en} onChange={(v) => setForm({ ...form, title_en: v })} placeholder="The Grand Budapest Hotel" />
        <Field label="标语" value={form.tagline} onChange={(v) => setForm({ ...form, tagline: v })} placeholder="一句能勾起好奇心的标语" />
        <Textarea label="简介" value={form.description} onChange={(v) => setForm({ ...form, description: v })} placeholder="这部作品将带学习者进入怎样的世界？" />
        <ImageUploadField
          label="封面图（影片海报）"
          value={form.poster_url}
          onChange={(v) => setForm({ ...form, poster_url: v })}
          hint="建议 2:3 竖版海报，用于社区列表卡片。"
          aspect="2/3"
        />
        <ImageUploadField
          label="推荐页图（影片剧照）"
          value={form.backdrop_url}
          onChange={(v) => setForm({ ...form, backdrop_url: v })}
          hint="推荐使用影片内部真实剧照截图，用于首页推荐轮播大图。"
          aspect="16/9"
        />
        <div className="grid grid-cols-2 gap-3">
          <Select label="难度" value={form.difficulty} onChange={(v) => setForm({ ...form, difficulty: v })} options={[["beginner", "入门"], ["intermediate", "进阶"], ["advanced", "高级"]]} />
          <Field label="加入所需积分" value={String(form.price_credits)} onChange={(v) => setForm({ ...form, price_credits: Number(v) || 0 })} placeholder="0" type="number" />
        </div>
      </div>
      <button
        type="submit"
        disabled={saving || !dirty}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-copper px-5 py-2.5 text-sm font-medium text-copper-foreground transition-transform hover:scale-[1.01] disabled:opacity-50"
      >
        {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} 保存修改
      </button>
    </form>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-luxe text-muted-foreground">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-1.5 w-full rounded-lg border border-border bg-background-elev/50 px-3 py-2 text-sm text-[#3a2a1a] placeholder:text-[#8a7a6a]/70 focus:border-copper/50 focus:outline-none" />
    </label>
  );
}
function Textarea({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-luxe text-muted-foreground">{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} placeholder={placeholder} className="mt-1.5 w-full resize-none rounded-lg border border-border bg-background-elev/50 px-3 py-2 text-sm text-[#3a2a1a] placeholder:text-[#8a7a6a]/70 focus:border-copper/50 focus:outline-none" />
    </label>
  );
}
function Select({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-luxe text-muted-foreground">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1.5 w-full rounded-lg border border-border bg-background-elev/50 px-3 py-2 text-sm text-[#3a2a1a] focus:border-copper/50 focus:outline-none">
        {options.map(([v, l]) => <option key={v} value={v} className="bg-background">{l}</option>)}
      </select>
    </label>
  );
}