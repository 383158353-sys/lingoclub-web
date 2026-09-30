import React, { useState } from "react";
import { Wand2, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";

// AI 一键生成封面：调用 ai-cover-generate 后端函数，由 service role 并行生成海报与推荐图。
export default function AiCoverGenerator({ title, tagline, description, onGenerated }) {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const run = async () => {
    if (!title?.trim()) {
      toast({ title: "请先填写片名", description: "AI 会根据片名生成海报与推荐页图。", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await base44.functions.invoke("ai-cover-generate", { title, tagline, description });
      const data = res.data || {};
      onGenerated?.({
        poster_url: data.poster_url || "",
        backdrop_url: data.backdrop_url || "",
      });
      toast({ title: "AI 封面已生成", description: "已填入下方海报与推荐页图，可进一步微调。" });
    } catch (err) {
      toast({ title: "生成失败", description: err?.message || "请稍后再试", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <span className="text-[11px] uppercase tracking-luxe text-copper">AI 一键生成封面</span>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg border border-copper/30 bg-copper/5 px-3 py-2.5">
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-full bg-copper px-3.5 py-1.5 text-xs font-medium text-copper-foreground transition-transform hover:scale-[1.02] disabled:opacity-50"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
          {busy ? "AI 生成中…" : "生成海报 + 推荐图"}
        </button>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          根据片名 / 标语 / 简介生成竖版海报与横版推荐图，未填写的字段会留白。
        </p>
      </div>
    </div>
  );
}