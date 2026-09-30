import React, { useState, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import { ArrowLeft, Scissors, Loader2, Copy, Download, Check, RotateCcw, FileText, Wand2 } from "lucide-react";

const MAX_CHARS = 6000;
const SAMPLE = `I was thinking that if we leave early in the morning, we might avoid all the heavy traffic on the highway and arrive before lunch. But we should probably check the weather forecast first, because the roads can get really dangerous when it rains heavily in this region during the autumn season.`;

// 单行 CPL 着色：≤38 合格(mint)，39~42 警告(amber)，>42 超限(red)
function cplColor(n) {
  if (n <= 0) return "text-muted-foreground/40";
  if (n <= 38) return "text-mint";
  if (n <= 42) return "text-amber-300";
  return "text-rose-300";
}
function cplBadge(n) {
  if (n <= 0) return "bg-muted/40 text-muted-foreground/60";
  if (n <= 38) return "bg-mint/15 text-mint";
  if (n <= 42) return "bg-amber-500/15 text-amber-300";
  return "bg-rose-500/15 text-rose-300";
}

export default function SubtitleSegmentation() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { subtitles: [], count }
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const segment = useCallback(async () => {
    const text = input.trim();
    if (!text) {
      toast({ title: "请先粘贴台词文本", variant: "destructive" });
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await base44.functions.invoke("segment-subtitles", { text });
      const data = res?.data || res;
      if (data?.error) throw new Error(data.error);
      setResult(data);
      toast({ title: `已切分为 ${data.count} 个字幕块` });
    } catch (e) {
      toast({ title: "分句失败", description: e?.message || "请稍后重试", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [input, toast]);

  const stats = useMemo(() => {
    if (!result?.subtitles?.length) return null;
    const subs = result.subtitles;
    const maxCpl = subs.reduce((m, s) => Math.max(m, s.cpl_line1 || 0, s.cpl_line2 || 0), 0);
    const overLimit = subs.filter((s) => (s.cpl_line1 || 0) > 42 || (s.cpl_line2 || 0) > 42).length;
    const totalWords = subs.reduce((n, s) => n + (s.text || "").split(/\s+/).filter(Boolean).length, 0);
    return { maxCpl, overLimit, avgWords: Math.round(totalWords / subs.length) };
  }, [result]);

  const jsonText = useMemo(() => (result ? JSON.stringify({ subtitles: result.subtitles }, null, 2) : ""), [result]);

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(jsonText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast({ title: "复制失败", variant: "destructive" });
    }
  };

  const downloadJson = () => {
    const blob = new Blob([jsonText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "subtitles.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => { setInput(""); setResult(null); };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 lg:px-8 pt-20 pb-16 md:pt-28 md:pb-20">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-copper">
        <ArrowLeft size={15} /> 返回首页
      </Link>

      <header className="mt-4">
        <p className="text-[11px] uppercase tracking-luxe text-copper/80">工具箱 · Subtitle Segmentation</p>
        <h1 className="mt-2 font-display text-2xl font-bold leading-tight text-foreground md:text-4xl">英文台词智能字幕分句</h1>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-foreground md:mt-3 md:text-sm">
          粘贴一段连续的英文台词或对话，AI 将按字幕工业排版规范（每块 1~2 行、每行 ≤38 字符）与英文语言学断句优先级切分为标准字幕块，输出可直接用于渲染的 JSON。
        </p>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* 输入区 */}
        <div className="flex flex-col">
          <div className="mb-2 flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-xs font-medium text-foreground/80">
              <FileText size={13} className="text-copper/70" /> 原始台词文本
            </label>
            <span className={`text-[11px] ${input.length > MAX_CHARS ? "text-rose-300" : "text-muted-foreground/60"}`}>
              {input.length} / {MAX_CHARS}
            </span>
          </div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="在此粘贴连续的英文台词 / 对话文本…"
            className="min-h-[320px] flex-1 resize-y rounded-xl border border-border bg-background-elev/40 p-4 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:border-copper/50 focus:outline-none"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={segment}
              disabled={loading || !input.trim()}
              className="inline-flex items-center gap-2 rounded-full bg-copper px-5 py-2.5 text-sm font-medium text-copper-foreground transition-transform hover:scale-[1.02] disabled:opacity-40"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
              {loading ? "分句中…" : "智能分句"}
            </button>
            <button
              type="button"
              onClick={() => setInput(SAMPLE)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground hover:border-copper/40"
            >
              <Scissors size={13} /> 示例文本
            </button>
            {(input || result) && (
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <RotateCcw size={13} /> 清空
              </button>
            )}
          </div>

          {/* 规范速览 */}
          <div className="mt-4 rounded-xl border border-border/60 bg-background-elev/20 p-3.5">
            <p className="text-[11px] font-medium text-foreground/70">排版与语言学规范</p>
            <ul className="mt-1.5 space-y-0.5 text-[11px] leading-relaxed text-muted-foreground/80">
              <li>· 每块 1~2 行，每行 ≤38 字符（绝对上限 42）</li>
              <li>· 断点优先级：句末标点/并列连词 → 从句边界 → 非谓语短语 → 介词短语前</li>
              <li>· 禁止拆分：冠词+名词、助动词+谓语、动词短语习语；行尾禁悬挂介词/连词</li>
            </ul>
          </div>
        </div>

        {/* 结果区 */}
        <div className="flex flex-col">
          <div className="mb-2 flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-xs font-medium text-foreground/80">
              <Scissors size={13} className="text-copper/70" /> 分句结果
            </label>
            {result?.subtitles?.length > 0 && (
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={copyJson} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground hover:border-copper/40">
                  {copied ? <Check size={11} className="text-mint" /> : <Copy size={11} />} 复制 JSON
                </button>
                <button type="button" onClick={downloadJson} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground hover:border-copper/40">
                  <Download size={11} /> 下载
                </button>
              </div>
            )}
          </div>

          {loading ? (
            <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-border/60 bg-background-elev/20">
              <div className="text-center">
                <Loader2 size={24} className="mx-auto animate-spin text-copper" />
                <p className="mt-3 text-xs text-muted-foreground">正在按语言学规范切分…</p>
              </div>
            </div>
          ) : result?.subtitles?.length ? (
            <div className="flex flex-col">
              {stats && (
                <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                  <span><span className="text-foreground/80">{result.count}</span> 个字幕块</span>
                  <span className="h-3 w-px bg-border/50" />
                  <span>最大 CPL <span className={cplColor(stats.maxCpl)}>{stats.maxCpl}</span></span>
                  <span className="h-3 w-px bg-border/50" />
                  <span>平均 <span className="text-foreground/80">{stats.avgWords}</span> 词/块</span>
                  {stats.overLimit > 0 && <span className="text-rose-300">{stats.overLimit} 行超限</span>}
                </div>
              )}
              <div className="max-h-[560px] space-y-2.5 overflow-y-auto pr-1">
                {result.subtitles.map((s) => {
                  const lines = (s.text || "").split("\n");
                  return (
                    <div key={s.id} className="rounded-lg border border-border/60 bg-background-elev/30 p-3">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="font-mono text-[10px] text-muted-foreground/60">#{s.id}</span>
                        <div className="flex items-center gap-1">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cplBadge(s.cpl_line1 || lines[0]?.length || 0)}`}>L1 {s.cpl_line1 ?? lines[0]?.length ?? 0}</span>
                          {(s.line_count > 1 || lines.length > 1) && (
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cplBadge(s.cpl_line2 || lines[1]?.length || 0)}`}>L2 {s.cpl_line2 ?? lines[1]?.length ?? 0}</span>
                          )}
                        </div>
                      </div>
                      <div className="rounded-md bg-black/30 px-3 py-2">
                        {lines.map((ln, i) => (
                          <p key={i} className="text-sm leading-snug text-foreground/90">{ln || "\u00A0"}</p>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed border-border bg-background-elev/20 text-center">
              <div>
                <Scissors size={26} className="mx-auto text-muted-foreground/40" />
                <p className="mt-3 text-xs text-muted-foreground">粘贴文本后点击「智能分句」</p>
                <p className="mt-1 text-[11px] text-muted-foreground/60">结果将显示为带 CPL 校验的字幕块</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}