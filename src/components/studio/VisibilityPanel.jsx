import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import { Eye, EyeOff, Loader2, Send, ShieldAlert, CheckCircle2 } from "lucide-react";

// Lets the creator take the community offline (下架 → private) at any time,
// or re-submit it for public review (申请公开 → pending). Public status is
// only granted by an admin via ReviewQueue, so the only transitions here are
// → private and → pending. Shows the current state and any admin review note.
const STATE = {
  private: { label: "未公开", tone: "muted", icon: EyeOff, hint: "仅你自己可见，其他用户无法浏览或加入。" },
  pending: { label: "审核中", tone: "copper", icon: Loader2, hint: "已提交公开申请，等待管理员审核。" },
  public: { label: "已公开", tone: "green", icon: CheckCircle2, hint: "社区对所有人开放，可被浏览与加入。" },
  rejected: { label: "未通过", tone: "red", icon: ShieldAlert, hint: "公开申请被退回，请按下方备注修改后重新提交。" },
};

export default function VisibilityPanel({ movie, onSaved }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const visibility = movie?.visibility || "private";
  const st = STATE[visibility] || STATE.private;
  const Icon = st.icon;

  const update = async (next) => {
    setBusy(true);
    try {
      const updated = await base44.entities.Movie.update(movie.id, { visibility: next });
      toast({ title: next === "private" ? "已下架社区" : "已提交公开申请", description: next === "private" ? "社区已设为仅自己可见。" : "等待管理员审核通过后将公开。" });
      onSaved?.(updated);
    } catch (e) {
      toast({ title: "操作失败", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const isPublicLike = visibility === "public" || visibility === "pending";

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-6 h-fit">
      <h2 className="font-display text-lg text-foreground">社区可见性</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">控制本项目是否对外公开。下架后立即仅自己可见；申请公开需管理员审核通过。</p>

      <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-background-elev/40 px-3 py-2.5">
        <span className={`flex h-7 w-7 items-center justify-center rounded-full ${
          st.tone === "green" ? "bg-emerald-500/15 text-emerald-300"
          : st.tone === "red" ? "bg-red-500/15 text-red-300"
          : st.tone === "copper" ? "bg-copper/15 text-copper"
          : "bg-muted text-muted-foreground"
        }`}>
          <Icon size={14} className={visibility === "pending" ? "animate-spin" : ""} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">当前状态 · {st.label}</p>
          <p className="text-[11px] leading-snug text-muted-foreground">{st.hint}</p>
        </div>
      </div>

      {visibility === "rejected" && movie.review_note && (
        <div className="mt-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs leading-relaxed text-red-200/90">
          <span className="font-medium">审核备注：</span>{movie.review_note}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {isPublicLike ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => update("private")}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-border bg-background-elev/40 px-4 py-2 text-sm text-foreground transition-colors hover:border-red-400/40 hover:text-red-200 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <EyeOff size={14} />} 下架社区
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => update("pending")}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-copper px-4 py-2 text-sm font-medium text-copper-foreground transition-transform hover:scale-[1.01] disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} 申请公开
          </button>
        )}
        {isPublicLike && (
          <span className="inline-flex items-center justify-center gap-1.5 rounded-full border border-border px-3 py-2 text-[11px] text-muted-foreground">
            <Eye size={12} /> 公开后可再次下架
          </span>
        )}
      </div>
    </div>
  );
}