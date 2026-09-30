import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import { Trash2, AlertTriangle, Loader2, X } from "lucide-react";

// 删除整个小组：级联清理该影视下的剧集 / 订阅 / 评论 / 笔记后再删 Movie，
// 避免在「个人订阅」等页面留下指向已删除小组的孤儿记录。
// 仅创建者受 RLS 允许执行（admin 同样允许），调用失败由 RLS 拦截并提示。
export default function DeleteGroupButton({ movie, afterDeleted }) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const doDelete = async () => {
    if (confirmText.trim() !== movie.title) return;
    setBusy(true);
    try {
      const mid = movie.id;
      await Promise.all([
        base44.entities.Episode.deleteMany({ movie_id: mid }).catch(() => {}),
        base44.entities.Subscription.deleteMany({ movie_id: mid }).catch(() => {}),
        base44.entities.Comment.deleteMany({ movie_id: mid }).catch(() => {}),
        base44.entities.Note.deleteMany({ movie_id: mid }).catch(() => {}),
        base44.entities.Scene.deleteMany({ movie_id: mid }).catch(() => {}),
      ]);
      await base44.entities.Movie.delete(mid);
      toast({ title: "小组已删除", description: "相关剧集、订阅、评论与笔记已一并清理。" });
      setOpen(false);
      if (afterDeleted) afterDeleted();
      else navigate("/studio");
    } catch (err) {
      toast({ title: "删除失败", description: err?.message || "请稍后重试", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-red-400/20 bg-red-500/5 px-5 py-3 text-sm text-red-200/80 transition-colors hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-100"
      >
        <Trash2 size={15} /> 删除小组
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-red-400/30 bg-card p-6 shadow-xl">
            <div className="flex items-start justify-between">
              <p className="flex items-center gap-2 font-display text-lg text-foreground">
                <AlertTriangle size={18} className="text-red-300" /> 删除小组
              </p>
              <button type="button" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X size={18} />
              </button>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              此操作不可撤销。将一并删除该小组下的所有剧集、台词、场景、讨论与订阅记录，且所有用户无法再访问此小组。
            </p>
            <p className="mt-3 text-xs text-muted-foreground">请输入小组名称 <span className="text-foreground">{movie.title}</span> 以确认：</p>
            <input
              autoFocus
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={movie.title}
              className="mt-2 w-full rounded-lg border border-border bg-background-elev/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-red-400/50 focus:outline-none"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded-full border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={doDelete}
                disabled={busy || confirmText.trim() !== movie.title}
                className="inline-flex items-center gap-1.5 rounded-full bg-red-500/90 px-5 py-2 text-sm font-medium text-white transition-transform hover:scale-[1.01] disabled:opacity-40"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} 永久删除
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}