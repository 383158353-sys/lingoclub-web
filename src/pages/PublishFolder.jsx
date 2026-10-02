import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import ImageUploadField from "@/components/common/ImageUploadField";
import AiCoverGenerator from "@/components/common/AiCoverGenerator";
import AiMetaFill from "@/components/common/AiMetaFill";
import { Plus, Loader2, Send, Film, ExternalLink, Trash2, Library, Search } from "lucide-react";
import PageBackButton from "@/components/common/PageBackButton";
import { Image as BaseImage } from "@/components/ui/image";

// 发布文件夹为共享小组：
// 用户在「我的视频」整理好文件夹后，点右键「发布为共享小组」来到此页。
// 可编辑标题/简介/封面/推荐图，查看文件夹内所有视频，追加新视频链接，
// 然后一键发布为公开小组（Movie + Episodes + Subtitles）。
export default function PublishFolder() {
  const { folderId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const requireAuth = useRequireAuth();

  const [folder, setFolder] = useState(null);
  const [metas, setMetas] = useState([]);
  const [movie, setMovie] = useState(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);

  const [form, setForm] = useState({
    title: "",
    tagline: "",
    description: "",
    poster_url: "",
    backdrop_url: "",
    difficulty: "intermediate",
    price_credits: 0,
  });

  const [library, setLibrary] = useState([]); // 用户全部在线视频（用于选择器）
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [addingId, setAddingId] = useState(null);
  const [removingId, setRemovingId] = useState(null);

  const load = useCallback(async () => {
    if (!folderId) return;
    setLoading(true);
    try {
      const f = await base44.entities.StudyFolder.get(folderId);
      setFolder(f);
      setForm({
        title: f?.name || "",
        tagline: "",
        description: "",
        poster_url: f?.cover_url || "",
        backdrop_url: "",
        difficulty: "intermediate",
        price_credits: 0,
      });
      const vids = await base44.entities.LocalMovieMeta.filter({ folder: folderId }, "sort_order", 200);
      setMetas(vids || []);
      if (f?.is_shared && f?.movie_id) {
        try {
          const m = await base44.entities.Movie.get(f.movie_id);
          setMovie(m);
          setForm({
            title: m?.title || f.name,
            tagline: m?.tagline || "",
            description: m?.description || "",
            poster_url: m?.poster_url || f.cover_url || "",
            backdrop_url: m?.backdrop_url || "",
            difficulty: m?.difficulty || "intermediate",
            price_credits: m?.price_credits || 0,
          });
        } catch { /* noop */ }
      }
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  useEffect(() => { load(); loadLibrary(); }, [load]);

  // 加载用户全部在线视频（我的视频），用于选择器
  const loadLibrary = useCallback(async () => {
    try {
      const all = await base44.entities.LocalMovieMeta.list("-updated_date", 200);
      setLibrary((all || []).filter((m) => m.video_url));
    } catch { /* noop */ }
  }, []);

  // 从「我的视频」中选一个加入此文件夹
  const addVideoFromLibrary = async (meta) => {
    if (addingId) return;
    setAddingId(meta.id);
    try {
      const nextOrder = (metas.at(-1)?.sort_order || 0) + 10;
      await base44.entities.LocalMovieMeta.update(meta.id, { folder: folderId, sort_order: nextOrder });
      // 如果文件夹已发布，同步为公开 Episode
      if (folder?.is_shared && folder?.movie_id) {
        try {
          const res = await base44.functions.invoke("syncVideoToGroup", {
            folder_id: folderId, meta_id: meta.id, action: "add",
          });
          const data = res?.data || res;
          if (data?.error) throw new Error(data.error);
        } catch (err) {
          toast({ title: "视频已加入文件夹，但公开同步失败", description: err?.message, variant: "destructive" });
        }
      }
      setMetas((m) => [...m, { ...meta, folder: folderId, sort_order: nextOrder }]);
      setLibrary((lib) => lib.filter((v) => v.id !== meta.id));
      toast({ title: "已加入小组", description: folder?.is_shared ? "已同步到公开小组。" : "发布后将自动同步到公开小组。" });
    } catch (err) {
      toast({ title: "添加失败", description: err?.message, variant: "destructive" });
    } finally {
      setAddingId(null);
    }
  };

  // 从文件夹中移除视频（移回未分类，不删除）
  const removeVideo = async (meta) => {
    if (removingId) return;
    setRemovingId(meta.id);
    try {
      await base44.entities.LocalMovieMeta.update(meta.id, { folder: "" });
      // 如果文件夹已发布，删除对应的公开 Episode
      if (folder?.is_shared && folder?.movie_id) {
        try {
          const res = await base44.functions.invoke("syncVideoToGroup", {
            folder_id: folderId, meta_id: meta.id, action: "remove",
          });
          const data = res?.data || res;
          if (data?.error) throw new Error(data.error);
        } catch (err) {
          toast({ title: "视频已移出文件夹，但公开同步失败", description: err?.message, variant: "destructive" });
        }
      }
      setMetas((m) => m.filter((v) => v.id !== meta.id));
      setLibrary((lib) => [...lib, meta]);
      toast({ title: "已移出小组" });
    } catch (err) {
      toast({ title: "移除失败", description: err?.message, variant: "destructive" });
    } finally {
      setRemovingId(null);
    }
  };

  const publish = async () => {
    if (!form.title.trim()) {
      toast({ title: "请填写小组标题", variant: "destructive" });
      return;
    }
    if (metas.length === 0) {
      toast({ title: "文件夹中没有视频", description: "请先添加至少一个视频再发布。", variant: "destructive" });
      return;
    }
    setPublishing(true);
    try {
      const res = await base44.functions.invoke("publishFolderAsGroup", {
        folder_id: folderId,
        title: form.title,
        tagline: form.tagline,
        description: form.description,
        poster_url: form.poster_url,
        backdrop_url: form.backdrop_url,
        difficulty: form.difficulty,
        price_credits: form.price_credits,
      });
      const data = res?.data || res;
      if (data?.error) throw new Error(data.error);
      toast({
        title: data.already_published ? "视频单已存在" : "发布成功！",
        description: `已创建 ${data.episode_count || metas.length} 集视频单，其他用户可在「视频单」看到并收藏。`,
      });
      navigate("/communities");
    } catch (err) {
      toast({ title: "发布失败", description: err?.message, variant: "destructive" });
    } finally {
      setPublishing(false);
    }
  };

  const saveMeta = async () => {
    if (!movie) return;
    setSavingMeta(true);
    try {
      const updated = await base44.entities.Movie.update(movie.id, {
        title: form.title,
        tagline: form.tagline,
        description: form.description,
        poster_url: form.poster_url,
        backdrop_url: form.backdrop_url,
        difficulty: form.difficulty,
        price_credits: form.price_credits,
      });
      setMovie(updated);
      toast({ title: "已保存修改" });
    } catch (err) {
      toast({ title: "保存失败", description: err?.message, variant: "destructive" });
    } finally {
      setSavingMeta(false);
    }
  };

  if (loading) return <div className="pt-28 pb-20 text-center text-muted-foreground">加载…</div>;
  if (!folder) return <div className="pt-28 pb-20 text-center text-muted-foreground">未找到该文件夹。</div>;

  return (
    <div className="mx-auto max-w-7xl px-5 lg:px-8 pt-28 pb-20">
      <PageBackButton onClick={() => navigate("/local-study")} className="mb-3" />

      <div className="mt-6 border-b border-border/50 pb-8">
        <p className="text-[11px] uppercase tracking-luxe text-copper/80">发布视频单</p>
        <h1 className="mt-2 font-display text-3xl text-foreground md:text-4xl">{movie ? "编辑视频单" : "将文件夹发布为视频单"}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          编辑标题、简介和封面，文件夹中的 {metas.length} 个视频将作为剧集发布。发布后其他用户可在「视频单」看到并收藏。
        </p>
        {movie && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link to={`/movie/${movie.id}`} className="inline-flex items-center gap-1.5 text-sm text-copper hover:underline">
              <ExternalLink size={14} /> 查看小组主页
            </Link>
            {movie.visibility === "public" && (
              <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] text-emerald-200/90">已公开</span>
            )}
          </div>
        )}
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[380px_1fr]">
        {/* 左栏：小组信息编辑 */}
        <div className="space-y-5">
          <div className="rounded-2xl border border-border/60 bg-card p-6">
            <h2 className="font-display text-lg text-foreground">小组信息</h2>
            <div className="mt-4 space-y-3">
              <Field label="小组标题" value={form.title} onChange={(v) => setForm({ ...form, title: v })} placeholder="例：每日英语听力训练" />
              <Field label="标语" value={form.tagline} onChange={(v) => setForm({ ...form, tagline: v })} placeholder="一句能勾起好奇心的话" />
              <Textarea label="简介" value={form.description} onChange={(v) => setForm({ ...form, description: v })} placeholder="这个小组适合什么人？包含什么内容？" />

              <AiMetaFill
                title={form.title}
                onFilled={({ title_en, tagline, description }) =>
                  setForm((f) => ({ ...f, tagline: tagline || f.tagline, description: description || f.description }))
                } />

              <AiCoverGenerator
                title={form.title}
                tagline={form.tagline}
                description={form.description}
                onGenerated={({ poster_url, backdrop_url }) => setForm((f) => ({ ...f, poster_url, backdrop_url }))} />

              <ImageUploadField label="封面图" value={form.poster_url} onChange={(v) => setForm({ ...form, poster_url: v })} hint="建议 16:9 横版，用于视频单封面。" aspect="16/9" />
              <ImageUploadField label="推荐页图（剧照）" value={form.backdrop_url} onChange={(v) => setForm({ ...form, backdrop_url: v })} hint="建议 16:9 横版，用于首页推荐轮播。" aspect="16/9" />

              <div className="grid grid-cols-2 gap-3">
                <Select label="难度" value={form.difficulty} onChange={(v) => setForm({ ...form, difficulty: v })} options={[["beginner", "入门"], ["intermediate", "进阶"], ["advanced", "高级"]]} />
                <Field label="加入积分" value={String(form.price_credits)} onChange={(v) => setForm({ ...form, price_credits: Number(v) || 0 })} placeholder="0 = 免费" type="number" />
              </div>
            </div>

            {movie ? (
              <button type="button" onClick={saveMeta} disabled={savingMeta} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-copper px-5 py-2.5 text-sm font-medium text-copper-foreground disabled:opacity-50">
                {savingMeta ? <Loader2 size={15} className="animate-spin" /> : null} 保存修改
              </button>
            ) : (
              <button type="button" onClick={publish} disabled={publishing} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-copper px-5 py-2.5 text-sm font-medium text-copper-foreground transition-transform hover:scale-[1.01] disabled:opacity-50">
                {publishing ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} 发布视频单
              </button>
            )}
          </div>
        </div>

        {/* 右栏：视频列表 + 添加 */}
        <div>
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg text-foreground">小组视频 <span className="text-sm font-body text-muted-foreground">· {metas.length}</span></h2>
          </div>

          {/* 添加视频：从「我的视频」中选择 */}
          <div className="mt-4 rounded-2xl border border-border/60 bg-card p-5">
            <p className="flex items-center gap-2 text-sm text-foreground"><Library size={15} className="text-copper" /> 添加视频</p>
            <p className="mt-1 text-xs text-muted-foreground">从你的「我的视频」库中选择视频加入此小组。{folder?.is_shared ? "所有者添加的视频会自动同步到公开小组。" : "发布小组后，新增视频也会自动同步到公开小组。"}</p>
            <button type="button" onClick={() => { setPickerOpen(true); setPickerQuery(""); }} className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-copper px-4 py-2 text-sm font-medium text-copper-foreground transition-transform hover:scale-[1.02]">
              <Plus size={14} /> 从我的视频选择
            </button>
          </div>

          {/* 视频选择弹窗 */}
          {pickerOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setPickerOpen(false)}>
              <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-background-elev shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="border-b border-border/60 p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-lg text-foreground">选择视频加入小组</h3>
                    <button type="button" onClick={() => setPickerOpen(false)} className="text-muted-foreground hover:text-foreground">✕</button>
                  </div>
                  <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
                    <Search size={14} className="text-muted-foreground/60" />
                    <input
                      value={pickerQuery}
                      onChange={(e) => setPickerQuery(e.target.value)}
                      placeholder="搜索视频名…"
                      className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                      autoFocus
                    />
                  </div>
                </div>
                <div className="overflow-y-auto p-4">
                  {(() => {
                    const inFolder = new Set(metas.map((m) => m.id));
                    const available = library.filter((m) => !inFolder.has(m.id) && (!pickerQuery || m.name?.toLowerCase().includes(pickerQuery.toLowerCase())));
                    if (available.length === 0) {
                      return (
                        <div className="py-10 text-center text-sm text-muted-foreground">
                          {library.length === 0 ? "你的「我的视频」库中还没有在线视频。" : "没有可添加的视频。"}
                        </div>
                      );
                    }
                    return (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {available.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => { addVideoFromLibrary(m); setPickerOpen(false); }}
                            disabled={!!addingId}
                            className="group flex items-center gap-3 rounded-xl border border-border/60 bg-background/60 p-3 text-left transition-colors hover:border-copper/40 hover:bg-copper/5 disabled:opacity-50"
                          >
                            <div className="h-12 w-20 shrink-0 overflow-hidden rounded border border-border bg-background-elev/50">
                              {m.poster_url ? <BaseImage src={m.poster_url} alt="" className="h-full w-full object-cover" /> : <Film size={16} className="m-auto mt-3 text-muted-foreground/40" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm text-foreground">{m.name}</p>
                              <p className="truncate text-[11px] text-muted-foreground/60">{(m.subtitles || []).length} 句台词</p>
                            </div>
                            <Plus size={14} className="shrink-0 text-copper opacity-0 transition-opacity group-hover:opacity-100" />
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}

          {metas.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">
              <Film size={28} className="mx-auto mb-3 text-muted-foreground/50" />
              文件夹中还没有视频，先添加几个吧。
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {metas.map((v, i) => (
                <div key={v.id} className="group flex items-center gap-3 rounded-xl border border-border/60 bg-background-elev/40 p-3 hover:border-copper/30">
                  <span className="font-mono text-xs text-copper/80">E{String(i + 1).padStart(2, "0")}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{v.name}</p>
                    {v.video_url && <p className="truncate text-[11px] text-muted-foreground/60">{v.video_url}</p>}
                  </div>
                  <span className="text-[11px] text-muted-foreground">{(v.subtitles || []).length} 句台词</span>
                  <button type="button" onClick={() => removeVideo(v)} disabled={removingId === v.id} className="text-muted-foreground/50 transition-colors hover:text-rose-300 disabled:opacity-50">
                    {removingId === v.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-luxe text-muted-foreground">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-1.5 w-full rounded-lg border border-border bg-background-elev/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-copper/50 focus:outline-none" />
    </label>
  );
}
function Textarea({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-luxe text-muted-foreground">{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} placeholder={placeholder} className="mt-1.5 w-full resize-none rounded-lg border border-border bg-background-elev/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-copper/50 focus:outline-none" />
    </label>
  );
}
function Select({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-luxe text-muted-foreground">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1.5 w-full rounded-lg border border-border bg-background-elev/50 px-3 py-2 text-sm text-foreground focus:border-copper/50 focus:outline-none">
        {options.map(([v, l]) => <option key={v} value={v} className="bg-background">{l}</option>)}
      </select>
    </label>
  );
}
