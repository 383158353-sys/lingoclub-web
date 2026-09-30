import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import { Image as BaseImage } from "@/components/ui/image";
import { Plus, Loader2, Search, Film, X } from "lucide-react";

// 视频单详情页：所有者点击「添加视频」，从自己的「我的视频」库中选择视频
// 加入到公开视频单中（调用 syncVideoToGroup 后端函数同步为 Episode）。
export default function AddVideoToGroup({ movieId, isOwner, onAdded }) {
  const [open, setOpen] = useState(false);
  const [library, setLibrary] = useState([]);
  const [folderId, setFolderId] = useState(null);
  const [query, setQuery] = useState("");
  const [addingId, setAddingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const folders = await base44.entities.StudyFolder.filter({ movie_id: movieId });
      if (folders?.length > 0) setFolderId(folders[0].id);
      const all = await base44.entities.LocalMovieMeta.list("-updated_date", 200);
      setLibrary((all || []).filter((m) => m.video_url));
    } catch { /* noop */ }
    finally { setLoading(false); }
  };

  useEffect(() => { if (isOwner && open && !folderId) load(); }, [isOwner, open]);

  const addVideo = async (meta) => {
    if (!folderId || addingId) return;
    setAddingId(meta.id);
    try {
      const res = await base44.functions.invoke("syncVideoToGroup", {
        folder_id: folderId, meta_id: meta.id, action: "add",
      });
      const data = res?.data || res;
      if (data?.error) throw new Error(data.error);
      setLibrary((lib) => lib.filter((v) => v.id !== meta.id));
      toast({ title: "已添加到视频单" });
      onAdded?.();
    } catch (err) {
      toast({ title: "添加失败", description: err?.message, variant: "destructive" });
    } finally {
      setAddingId(null);
    }
  };

  if (!isOwner) return null;

  const available = library.filter((m) => !query || m.name?.toLowerCase().includes(query.toLowerCase()));

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); load(); }} className="inline-flex items-center gap-1.5 rounded-full border border-copper/40 bg-copper/10 px-4 py-2 text-sm font-medium text-copper transition-colors hover:bg-copper/20">
        <Plus size={14} /> 添加视频
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-background-elev shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-border/60 p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg text-foreground">添加视频到视频单</h3>
                <button type="button" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
              </div>
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
                <Search size={14} className="text-muted-foreground/60" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索视频名…" className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none" autoFocus />
              </div>
            </div>
            <div className="overflow-y-auto p-4">
              {loading ? (
                <div className="py-10 text-center text-sm text-muted-foreground"><Loader2 size={16} className="mx-auto animate-spin" /></div>
              ) : available.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  {library.length === 0 ? "你的「我的视频」库中还没有在线视频。" : "没有可添加的视频。"}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {available.map((m) => (
                    <button key={m.id} type="button" onClick={() => addVideo(m)} disabled={!!addingId} className="group flex items-center gap-3 rounded-xl border border-border/60 bg-background/60 p-3 text-left transition-colors hover:border-copper/40 hover:bg-copper/5 disabled:opacity-50">
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
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}