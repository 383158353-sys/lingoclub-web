import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useToast } from "@/components/ui/use-toast";
import ImageUploadField from "@/components/common/ImageUploadField";
import AiCoverGenerator from "@/components/common/AiCoverGenerator";
import AiMetaFill from "@/components/common/AiMetaFill";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { Plus, Users, Loader2, ArrowRight, Clapperboard, Eye, EyeOff, Clock, XCircle } from "lucide-react";

export default function CreatorStudio() {
  const [mine, setMine] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", title_en: "", tagline: "", description: "", poster_url: "", backdrop_url: "", difficulty: "intermediate", price_credits: 0 });
  const { toast } = useToast();
  const { user } = useAuth();
  const requireAuth = useRequireAuth();

  const reload = async () => {
    setLoading(true);
    try {
      const all = await base44.entities.Movie.list("-updated_date", 50);
      // "我的项目" 只显示当前用户创建的影视（admin 同样），避免把全站项目都列进来
      setMine((all || []).filter((m) => m.created_by_id === user?.id));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {reload();}, []);

  const submitForReview = async (m) => {
    try {
      await base44.entities.Movie.update(m.id, { visibility: "pending" });
      setMine((ms) => ms.map((x) => x.id === m.id ? { ...x, visibility: "pending" } : x));
      toast({ title: "已提交公开申请", description: "项目将在管理员审核通过后进入公开影苑。" });
    } catch (err) {
      toast({ title: "提交失败", description: err.message, variant: "destructive" });
    }
  };

  const create = async (e) => {
    e.preventDefault();
    if (!requireAuth()) return;
    if (!form.title.trim()) return;
    setCreating(true);
    try {
      const movie = await base44.entities.Movie.create({
        ...form,
        genre: ["创作"],
        language: "en",
        year: new Date().getFullYear(),
        rating: 0,
        member_count: 0,
        total_episodes: 0,
        is_featured: false,
        visibility: "private",
        poster_url: form.poster_url || "https://media.base44.com/images/public/6a73619e5499baa21f415b49/1c3e1d637_generated_image.png",
        backdrop_url: form.backdrop_url || form.poster_url || "",
        creator_name: "你"
      });
      setMine((m) => [movie, ...m]);
      setForm({ title: "", title_en: "", tagline: "", description: "", poster_url: "", backdrop_url: "", difficulty: "intermediate", price_credits: 0 });
      toast({ title: "小组已创建（仅自己可见）", description: "在右侧项目卡上点击「提交申请公开」即可进入审核流程。" });
    } catch (err) {
      toast({ title: "创建失败", description: err.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-5 lg:px-8 pt-28 pb-20">
      <header className="max-w-2xl">
        <p className="mb-3 text-[11px] uppercase tracking-luxe text-copper/80">Creator Studio</p>
        <h1 className="font-display text-4xl leading-tight text-foreground md:text-5xl">创作者工坊</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">为拥有合法版权或原创作品的创作者。上传字幕、添加翻译与知识解析，建立你自己的影视学习小组。</p>
      </header>

      <div className="mt-10 grid gap-10 lg:grid-cols-[360px_1fr]">
        <form onSubmit={create} className="rounded-2xl border border-border/60 bg-card p-6 h-fit">
          <h2 className="font-display text-lg text-foreground">新建小组</h2>
          <div className="mt-4 space-y-3">
            <Field label="片名（中）" value={form.title} onChange={(v) => setForm({ ...form, title: v })} placeholder="例：布达佩斯大饭店" />
            <Field label="片名（英）" value={form.title_en} onChange={(v) => setForm({ ...form, title_en: v })} placeholder="The Grand Budapest Hotel" />
            <Field label="标语" value={form.tagline} onChange={(v) => setForm({ ...form, tagline: v })} placeholder="一句能勾起好奇心的标语" />
            <Textarea label="简介" value={form.description} onChange={(v) => setForm({ ...form, description: v })} placeholder="这部作品将带学习者进入怎样的世界？" />
            <AiMetaFill
              title={form.title}
              onFilled={({ title_en, tagline, description }) =>
              setForm((f) => ({
                ...f,
                title_en: title_en || f.title_en,
                tagline: tagline || f.tagline,
                description: description || f.description
              }))
              } />
            
            <AiCoverGenerator
              title={form.title}
              tagline={form.tagline}
              description={form.description}
              onGenerated={({ poster_url, backdrop_url }) => setForm((f) => ({ ...f, poster_url, backdrop_url }))} />
            
            <ImageUploadField
              label="封面图（影片海报）"
              value={form.poster_url}
              onChange={(v) => setForm({ ...form, poster_url: v })}
              hint="建议 2:3 竖版海报，用于小组列表卡片。"
              aspect="2/3" />
            
            <ImageUploadField
              label="推荐页图（影片剧照）"
              value={form.backdrop_url}
              onChange={(v) => setForm({ ...form, backdrop_url: v })}
              hint="推荐使用影片内部真实剧照截图，用于首页推荐轮播大图。"
              aspect="16/9" />
            
            <div className="grid grid-cols-2 gap-3">
              <Select label="难度" value={form.difficulty} onChange={(v) => setForm({ ...form, difficulty: v })} options={[["beginner", "入门"], ["intermediate", "进阶"], ["advanced", "高级"]]} />
              <Field label="加入所需积分" value={String(form.price_credits)} onChange={(v) => setForm({ ...form, price_credits: Number(v) || 0 })} placeholder="0" type="number" />
            </div>
            <p className="rounded-lg border border-border/60 bg-background-elev/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              新建项目默认仅自己可见，创建后在右侧项目卡上点击「提交申请公开」，审核通过后所有用户都能进入该小组。
            </p>
          </div>
          <button type="submit" disabled={creating} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-copper px-5 py-2.5 text-sm font-medium text-copper-foreground transition-transform hover:scale-[1.01] disabled:opacity-50">
            {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} 发布项目
          </button>
        </form>

        <div>
          <h2 className="font-display text-lg text-foreground">我的项目</h2>
          {loading ?
          <p className="mt-4 text-sm text-muted-foreground">加载…</p> :
          mine.length === 0 ?
          <div className="mt-4 rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">还没有项目，从左边创建第一个吧。</div> :

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {mine.map((m) =>
            <div key={m.id} className="group flex gap-4 rounded-xl border border-border/60 bg-background-elev/40 p-4 hover:border-copper/30">
                  <Link to={`/studio/${m.id}`} className="block h-24 w-16 shrink-0 overflow-hidden rounded border border-border">
                    <img src={m.poster_url} alt="" className="h-full w-full object-cover" />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link to={`/studio/${m.id}`} className="truncate font-display text-base text-foreground hover:text-copper">{m.title}</Link>
                    <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Users size={11} /> {m.member_count || 0} 成员</p>
                    <p className="mt-1 text-xs text-copper">{m.price_credits > 0 ? `${m.price_credits} 积分` : "免费"}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <VisibilityBadge status={m.visibility} note={m.review_note} />
                      {m.visibility === "private" &&
                  <button
                    type="button"
                    onClick={() => submitForReview(m)}
                    className="inline-flex items-center gap-1 rounded-full border border-copper/40 bg-copper/10 px-2.5 py-0.5 text-[10px] font-medium text-copper hover:bg-copper/20">
                    
                          提交申请公开
                        </button>
                  }
                      <Link to={`/studio/${m.id}`} className="ml-auto inline-flex items-center gap-1 text-xs text-copper opacity-0 transition-opacity group-hover:opacity-100">管理 <ArrowRight size={12} /></Link>
                    </div>
                  </div>
                </div>
            )}
            </div>
          }
          <div className="mt-6 rounded-xl border border-border/60 bg-background-elev/30 p-5">
            <p className="flex items-center gap-2 text-sm text-foreground"><Clapperboard size={15} className="text-copper" /> 字幕与场景解析</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">创建项目后，进入该影视小组即可添加剧集、场景与台词。每句台词可由 AI 即时生成精读解析。</p>
          </div>
        </div>
      </div>
    </div>);

}

function Field({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-luxe text-muted-foreground">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-1.5 w-full rounded-lg border border-border bg-background-elev/50 px-3 py-2 text-sm text-[#3a2a1a] placeholder:text-[#8a7a6a]/70 focus:border-copper/50 focus:outline-none" />
    </label>);

}
function Textarea({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-luxe text-muted-foreground">{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} placeholder={placeholder} className="mt-1.5 w-full resize-none rounded-lg border border-border bg-background-elev/50 px-3 py-2 text-sm text-[#3a2a1a] placeholder:text-[#8a7a6a]/70 focus:border-copper/50 focus:outline-none" />
    </label>);

}
function Select({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-luxe text-muted-foreground">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1.5 w-full rounded-lg border border-border bg-background-elev/50 px-3 py-2 text-sm text-[#3a2a1a] focus:border-copper/50 focus:outline-none">
        {options.map(([v, l]) => <option key={v} value={v} className="bg-background">{l}</option>)}
      </select>
    </label>);

}

function VisibilityBadge({ status, note }) {
  if (status === "public") return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-200/90"><Eye size={10} /> 公开</span>);

  if (status === "pending") return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-200/90" title={note || "等待管理员审核"}><Clock size={10} /> 审核中</span>);

  if (status === "rejected") return (
    <span className="inline-flex items-center gap-1 rounded-full border border-rose-400/40 bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-200/90" title={note || "审核未通过"}><XCircle size={10} /> 未通过</span>);

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground"><EyeOff size={10} /> 仅自己可见</span>);

}