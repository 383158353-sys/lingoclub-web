import React, { useState } from "react";
import { Wand2, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";

// AI 一键补全项目元信息：调用 ai-meta-fill 后端函数，由 service role 调用 InvokeLLM。
export default function AiMetaFill({ title, onFilled }) {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const run = async () => {
    if (!title?.trim()) {
      toast({ title: "请先填写片名", description: "AI 会以片名为线索补全其余元信息。", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await base44.functions.invoke("ai-meta-fill", { title });
      const data = res.data || {};
      onFilled?.({
        title_en: data.title_en || "",
        tagline: data.tagline || "",
        description: data.description || "",
      });
      toast({ title: "已 AI 补全", description: "已填入英文片名、标语、简介。" });
    } catch (err) {
      toast({ title: "填写失败", description: err?.message || "请稍后再试", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className="inline-flex items-center gap-2 rounded-full border border-copper/40 bg-copper/10 px-3.5 py-1.5 text-xs font-medium text-copper transition-transform hover:scale-[1.02] disabled:opacity-50"
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
      {busy ? "AI 填写中…" : "AI 补全英文 / 标语 / 简介"}
    </button>
  );
}