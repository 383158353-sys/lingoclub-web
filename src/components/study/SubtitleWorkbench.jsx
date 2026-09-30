import React, { useState, useRef, useCallback } from "react";
import { useToast } from "@/components/ui/use-toast";
import { parseTranscript } from "@/lib/transcriptParser";
import { mergeFragments } from "@/lib/subtitleCleaner";
import { toSec } from "@/lib/timecode";
import {
  Loader2, UploadCloud, ListPlus, Check,
  Sparkles, Plus, Trash2, Pencil, X, Wand2,
} from "lucide-react";

function genSubId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// 统一字幕工作台：粘贴·文件导入 / 手动逐句
// 两个 Tab 集成在一个面板里。结果统一追加到外部传入的 subs 数组，
// onChanged 同步给父组件持久化。
export default function SubtitleWorkbench({ videoRef, videoUrl = "", subs = [], onChanged, onSeek, canPlay = false, initialTab = "paste" }) {
  const { toast } = useToast();
  const [tab, setTab] = useState(initialTab);
  const [pastedText, setPastedText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [totalSec, setTotalSec] = useState(1058);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState("");
  const fileInputRef = useRef(null);

  // 手动逐句状态
  const [form, setForm] = useState({ time_start: "", time_end: "", text_en: "", text_zh: "", speaker: "" });
  const [err, setErr] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);

  // 批量选择删除
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // ===== 粘贴 / 文件导入 =====
  const parsedFromText = pastedText.trim() ? mergeFragments(parseTranscript(pastedText, totalSec)).slice(0, 300) : [];
  const pasteTimed = parsedFromText.filter((l) => l.time_start).length;

  const readFile = async (f) => {
    try {
      const txt = await f.text();
      setPastedText(txt);
      setFileName(f.name);
    } catch (e) {
      toast({ title: "读取文件失败", description: e?.message, variant: "destructive" });
    }
  };

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) readFile(f);
  }, []);

  const appendParsed = (text) => {
    setParsing(true);
    setTimeout(() => {
      try {
        const parsed = mergeFragments(parseTranscript(text, 1800));
        if (!parsed?.length) {
          toast({ title: "未解析出台词", description: "请确认文件是 SRT / WebVTT 或带时间码文本。", variant: "destructive" });
          setParsing(false);
          return;
        }
        const mapped = parsed.map((p, i) => ({
          id: genSubId(),
          text_en: p.text_en || "",
          text_zh: p.text_zh || "",
          speaker: p.speaker || "",
          time_start: p.time_start || "",
          time_end: p.time_end || "",
          order: p.order ?? subs.length + i + 1,
          timestamp: p.time_start || "",
        }));
        const sorted = [...subs, ...mapped].sort((a, b) => (a.order || 0) - (b.order || 0));
        onChanged(sorted);
        setPastedText("");
        setFileName("");
        toast({ title: `已追加 ${mapped.length} 句台词` });
      } catch (e) {
        toast({ title: "解析失败", description: e?.message, variant: "destructive" });
      } finally {
        setParsing(false);
      }
    }, 30);
  };

  const importParsed = (rows) => {
    if (!rows?.length) { toast({ title: "没有可导入的台词", variant: "destructive" }); return; }
    const mapped = rows.map((l, i) => ({
      id: genSubId(),
      text_en: l.text_en || "",
      text_zh: l.text_zh || "",
      speaker: l.speaker || "",
      time_start: l.time_start || "",
      time_end: l.time_end || "",
      order: l.order ?? (subs.length + i + 1),
      timestamp: l.time_start || "",
    }));
    const sorted = [...subs, ...mapped].sort((a, b) => (a.order || 0) - (b.order || 0));
    onChanged(sorted);
    setPastedText("");
    setFileName("");
    toast({ title: `已追加 ${mapped.length} 句台词`, description: pasteTimed > 0 ? `其中 ${pasteTimed} 条带时间戳` : "" });
  };

  // ===== 手动逐句 =====
  const addManual = (e) => {
    e.preventDefault();
    setErr("");
    if (!form.text_en.trim()) { setErr("请输入英文台词"); return; }
    const start = toSec(form.time_start);
    if (form.time_start && Number.isNaN(start)) { setErr("开始时间格式应为 MM:SS"); return; }
    if (form.time_end && Number.isNaN(toSec(form.time_end))) { setErr("结束时间格式不正确"); return; }
    const newSub = {
      id: genSubId(),
      text_en: form.text_en,
      text_zh: form.text_zh,
      speaker: form.speaker,
      time_start: form.time_start,
      time_end: form.time_end,
      order: Number.isNaN(start) ? subs.length + 1 : Math.floor(start),
      timestamp: form.time_start,
    };
    const sorted = [...subs, newSub].sort((a, b) => (a.order || 0) - (b.order || 0));
    onChanged(sorted);
    setForm({ time_start: "", time_end: "", text_en: "", text_zh: "", speaker: "" });
  };

  const del = (id) => onChanged(subs.filter((s) => s.id !== id));

  // 本地智能分句：按语言学规则重新切分，并保留时间戳对齐。
  // timingSource 是用于「分句 + 对齐」的带时间戳行——传入越细粒度（原始 cue 级
  // 而非合并后的整句），词级时间轴越精准，分句边界落点越准确。
  const [aiSegmenting, setAiSegmenting] = useState(false);
  const runAiSegment = async (timingSource) => {
    const segmented = mergeFragments(timingSource);
    if (!segmented.length) throw new Error("未生成分句结果");
    return segmented.map((line, i) => ({ ...line, id: line.id || genSubId(), order: i + 1, timestamp: line.time_start || "" }));
  };

  // 对已导入字幕重新 AI 分句（按钮）
  const aiSegment = async (sourceSubs) => {
    const targets = Array.isArray(sourceSubs) && sourceSubs.length ? sourceSubs : subs;
    if (!targets.length) return;
    if (!targets.some((s) => s.time_start)) {
      toast({ title: "当前字幕无时间戳", description: "AI 智能分句需要带时间戳的字幕以保持播放同步。", variant: "destructive" });
      return;
    }
    setAiSegmenting(true);
    try {
      const mapped = await runAiSegment(targets);
      onChanged(mapped);
      toast({ title: "智能分句完成", description: `${mapped.length} 个字幕块 · 已保留时间戳对齐` });
    } catch (e) {
      const msg = e?.response?.data?.error || e?.data?.error || e?.message || "请稍后重试";
      toast({ title: "智能分句失败", description: msg, variant: "destructive" });
    } finally {
      setAiSegmenting(false);
    }
  };

  // 导入即分句：用 pre-merge（原始 cue 级）时间戳作为对齐源（粒度更细、
  // 时间戳更精准），AI 分句后追加到现有字幕。无时间戳则回退规则合并。
  const importAndSegment = async () => {
    if (!pastedText.trim()) return;
    setParsing(true);
    try {
      const parsed = parseTranscript(pastedText, totalSec);
      if (!parsed?.length) {
        toast({ title: "未解析出台词", description: "请确认是 SRT / WebVTT 或带时间码文本。", variant: "destructive" });
        return;
      }
      const timed = parsed.filter((p) => p.time_start);
      let mapped;
      if (timed.length) {
        mapped = (await runAiSegment(parsed)).map((c, i) => ({ ...c, order: subs.length + i + 1 }));
      } else {
        mapped = mergeFragments(parsed).map((p, i) => ({
          id: genSubId(),
          text_en: p.text_en || "",
          text_zh: p.text_zh || "",
          speaker: p.speaker || "",
          time_start: p.time_start || "",
          time_end: p.time_end || "",
          order: p.order ?? subs.length + i + 1,
          timestamp: p.time_start || "",
        }));
      }
      const sorted = [...subs, ...mapped].sort((a, b) => (a.order || 0) - (b.order || 0));
      onChanged(sorted);
      setPastedText("");
      setFileName("");
      toast({ title: `已导入 ${mapped.length} 句`, description: timed.length ? "智能分句 · 已保留时间戳对齐" : "" });
    } catch (e) {
      const msg = e?.response?.data?.error || e?.data?.error || e?.message || "请稍后重试";
      toast({ title: "导入失败", description: msg, variant: "destructive" });
    } finally {
      setParsing(false);
    }
  };

  const deleteAll = () => {
    if (!subs.length) return;
    if (!window.confirm(`确定删除全部 ${subs.length} 条台词？此操作不可撤销。`)) return;
    onChanged([]);
    setSelectedIds(new Set());
    setSelectMode(false);
  };

  const deleteSelected = () => {
    if (!selectedIds.size) return;
    onChanged(subs.filter((s) => !selectedIds.has(s.id)));
    setSelectedIds(new Set());
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === subs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(subs.map((s) => s.id)));
    }
  };

  const startEdit = (s) => {
    setEditingId(s.id);
    setEditDraft({ time_start: s.time_start || "", time_end: s.time_end || "", text_en: s.text_en || "", text_zh: s.text_zh || "" });
  };

  const saveEdit = () => {
    if (!editDraft || !editingId) return;
    const cur = subs.find((s) => s.id === editingId);
    if (!cur) return;
    if (!editDraft.text_en?.trim()) { toast({ title: "英文台词不能为空", variant: "destructive" }); return; }
    const start = toSec(editDraft.time_start || "");
    const updated = {
      ...cur,
      time_start: editDraft.time_start || "",
      time_end: editDraft.time_end || "",
      text_en: editDraft.text_en,
      text_zh: editDraft.text_zh || "",
      order: Number.isNaN(start) ? cur.order : Math.floor(start),
      timestamp: editDraft.time_start || "",
    };
    onChanged(subs.map((s) => (s.id === editingId ? updated : s)));
    setEditingId(null);
    setEditDraft(null);
  };

  const TabBtn = ({ id, icon: Icon, label, disabled }) => (
    <button
      type="button"
      onClick={() => !disabled && setTab(id)}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
        tab === id
          ? "bg-copper text-copper-foreground"
          : "border border-border text-muted-foreground hover:text-foreground"
      } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
    >
      <Icon size={13} /> {label}
    </button>
  );

  const tabs = [
    { id: "paste", icon: UploadCloud, label: "粘贴 / 文件导入" },
    { id: "manual", icon: ListPlus, label: "手动逐句" },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <Sparkles size={15} className="text-copper" />
        <h3 className="font-display text-sm text-foreground">内置字幕转写工作台</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        拖拽 / 上传 SRT·VTT·TXT 文件自动解析，或直接粘贴带时间码的文本；也可手动逐句添加。抓不到时直接把带时间码的文本粘贴进来也能解析。
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <TabBtn key={t.id} id={t.id} icon={t.icon} label={t.label} disabled={t.disabled} />
        ))}
      </div>

      {/* ===== 粘贴 / 文件导入 ===== */}
      {tab === "paste" && (
        <div className="mt-4">
          <label className="block">
            <span className="text-[11px] uppercase tracking-luxe text-muted-foreground">直接粘贴文本</span>
            <textarea
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              rows={6}
              placeholder={"粘贴 SRT / VTT 或带时间码的英文字幕...\n例（SRT）：\n1\n00:00:12,340 --> 00:00:15,000\nYou're going to give me a call.\n\n例（行内时间码）：\n0:12 Hello everyone\n0:15 Welcome back"}
              className="mt-1.5 w-full resize-y rounded-lg border border-border bg-background-elev/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-copper/50 focus:outline-none"
            />
          </label>

          <label className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase tracking-luxe text-muted-foreground">总时长(秒 · 无时间码时按文字长度分配)</span>
            <input
              type="number"
              min={1}
              value={totalSec}
              onChange={(e) => setTotalSec(Number(e.target.value) || 0)}
              className="w-28 rounded-lg border border-border bg-background-elev/50 px-2 py-1 text-sm text-foreground focus:border-copper/50 focus:outline-none"
            />
          </label>

          {parsedFromText.length > 0 && (
            <div className="mt-3 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs text-copper">
                <Check size={12} /> {parsedFromText.length} 条预览 · {pasteTimed} 条带时间戳
              </span>
              <button
                type="button"
                onClick={importAndSegment}
                disabled={parsing}
                className="inline-flex items-center gap-2 rounded-full bg-mint px-4 py-1.5 text-xs font-medium text-background transition-transform hover:scale-[1.02] disabled:opacity-50"
              >
                {parsing ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} 智能分句并追加
              </button>
            </div>
          )}
          {parsedFromText.length > 0 && (
            <ul className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-border bg-background/60 p-2 text-xs leading-relaxed">
              {parsedFromText.slice(0, 30).map((l, i) => (
                <li key={i} className="flex gap-2 border-b border-border/40 py-1 last:border-0">
                  {l.time_start ? <span className="font-mono text-copper/70">{l.time_start}</span> : <span className="font-mono text-muted-foreground/50">--:--</span>}
                  <span className="text-foreground/75">{l.text_en}</span>
                </li>
              ))}
            </ul>
          )}

          <div
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => fileInputRef.current?.click()}
            className={`mt-3 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
              dragOver ? "border-copper bg-copper/10" : "border-border bg-background-elev/30 hover:border-copper/50"
            }`}
          >
            <UploadCloud size={22} className="text-copper/80" />
            <p className="mt-2 text-xs text-foreground/80">拖拽 SRT / VTT / TXT 文件到这里，或点击选择文件</p>
            <p className="mt-1 text-[11px] text-muted-foreground">支持带时间码的纯文本、标准 SRT/WebVTT、以及「时间码独占一行 + 下一行文本」格式</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.srt,.vtt,.doc,text/plain"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) readFile(f); }}
            />
          </div>
          {fileName && <p className="mt-2 text-[11px] text-copper/70">已载入：{fileName}</p>}
        </div>
      )}

      {/* ===== 手动逐句 ===== */}
      {tab === "manual" && (
        <div className="mt-4">
          <form onSubmit={addManual} className="rounded-xl border border-border bg-background-elev/30 p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="开始时间" value={form.time_start} onChange={(v) => setForm({ ...form, time_start: v })} placeholder="MM:SS" />
              <Field label="结束时间" value={form.time_end} onChange={(v) => setForm({ ...form, time_end: v })} placeholder="MM:SS" />
              <Field label="说话者" value={form.speaker} onChange={(v) => setForm({ ...form, speaker: v })} placeholder="可选" />
            </div>
            <div className="mt-3"><Field label="英文台词" value={form.text_en} onChange={(v) => setForm({ ...form, text_en: v })} placeholder="The line spoken in the film" /></div>
            <div className="mt-3"><Field label="中文翻译" value={form.text_zh} onChange={(v) => setForm({ ...form, text_zh: v })} placeholder="可选" /></div>
            {err && <p className="mt-3 text-xs text-rose-300">{err}</p>}
            <button type="submit" className="mt-4 inline-flex items-center gap-2 rounded-full bg-copper px-5 py-2 text-sm font-medium text-copper-foreground">
              <Plus size={14} /> 添加台词
            </button>
          </form>
        </div>
      )}

      {/* ===== 已有字幕列表（所有 Tab 下都显示）===== */}
      <div className="mt-5 border-t border-border/40 pt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">已添加 · {subs.length}</span>
          {subs.length > 0 && (
            <div className="flex items-center gap-2">
              {!selectMode ? (
                <>
                  <button
                    type="button"
                    onClick={() => aiSegment()}
                    disabled={aiSegmenting}
                    title="AI 按语言学规范重新分句，保留词级时间戳确保播放同步"
                    className="inline-flex items-center gap-1.5 rounded-full border border-copper/40 bg-copper/10 px-3 py-1.5 text-[11px] font-medium text-copper transition-colors hover:bg-copper/20 disabled:opacity-50"
                  >
                    {aiSegmenting ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />} 智能分句
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectMode(true)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-copper/50"
                  >
                    <Check size={11} /> 选择删除
                  </button>
                  <button
                    type="button"
                    onClick={deleteAll}
                    className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 px-3 py-1.5 text-[11px] font-medium text-rose-300/80 transition-colors hover:text-rose-300 hover:border-rose-500/50"
                  >
                    <Trash2 size={11} /> 删除全部
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {selectedIds.size === subs.length ? "取消全选" : "全选"}
                  </button>
                  <button
                    type="button"
                    onClick={deleteSelected}
                    disabled={selectedIds.size === 0}
                    className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/80 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Trash2 size={11} /> 删除选中({selectedIds.size})
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSelectMode(false); setSelectedIds(new Set()); }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X size={11} /> 取消
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {subs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">还没有台词，选择上方任意方式添加第一句。</div>
        ) : (
          <ul className="max-h-72 space-y-2 overflow-y-auto scrollbar-none pr-1">
            {subs.map((s) => (
              <li key={s.id} className="rounded-xl border border-border/50 bg-background-elev/30 p-3">
                {editingId === s.id ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <input value={editDraft.time_start} onChange={(e) => setEditDraft((d) => ({ ...d, time_start: e.target.value }))} placeholder="开始 MM:SS" className="w-24 rounded-lg border border-border bg-background-elev/50 px-2 py-1 font-mono text-xs text-foreground focus:border-copper/50 focus:outline-none" />
                      <input value={editDraft.time_end} onChange={(e) => setEditDraft((d) => ({ ...d, time_end: e.target.value }))} placeholder="结束 MM:SS" className="w-24 rounded-lg border border-border bg-background-elev/50 px-2 py-1 font-mono text-xs text-foreground focus:border-copper/50 focus:outline-none" />
                    </div>
                    <input value={editDraft.text_en} onChange={(e) => setEditDraft((d) => ({ ...d, text_en: e.target.value }))} placeholder="英文台词" className="w-full rounded-lg border border-border bg-background-elev/50 px-2.5 py-1.5 text-sm text-foreground focus:border-copper/50 focus:outline-none" />
                    <input value={editDraft.text_zh} onChange={(e) => setEditDraft((d) => ({ ...d, text_zh: e.target.value }))} placeholder="中文翻译（可选）" className="w-full rounded-lg border border-border bg-background-elev/50 px-2.5 py-1.5 text-sm text-foreground focus:border-copper/50 focus:outline-none" />
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={saveEdit} className="inline-flex items-center gap-1.5 rounded-full bg-copper px-3.5 py-1.5 text-xs font-medium text-copper-foreground">
                        <Check size={12} /> 保存
                      </button>
                      <button type="button" onClick={() => { setEditingId(null); setEditDraft(null); }} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                        <X size={12} /> 取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    {selectMode && (
                      <button
                        type="button"
                        onClick={() => toggleSelect(s.id)}
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                          selectedIds.has(s.id)
                            ? "border-copper bg-copper text-copper-foreground"
                            : "border-border bg-transparent hover:border-copper/50"
                        }`}
                      >
                        {selectedIds.has(s.id) && <Check size={12} />}
                      </button>
                    )}
                    <button type="button" onClick={() => onSeek?.(toSec(s.time_start))} disabled={!onSeek} title={s.time_start ? "定位到视频此处" : ""} className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left transition-colors hover:bg-white/5 disabled:cursor-default disabled:hover:bg-transparent">
                      <span className="mt-0.5 font-mono text-[11px] text-copper/80">{s.time_start || "—"}</span>
                      <span className="block min-w-0 flex-1">
                        {s.speaker && <span className="text-[11px] uppercase tracking-luxe text-muted-foreground">{s.speaker}</span>}
                        <p className="text-sm text-foreground">{s.text_en}</p>
                        {s.text_zh && <p className="text-xs text-muted-foreground">{s.text_zh}</p>}
                      </span>
                    </button>
                    {!selectMode && (
                      <>
                        <button type="button" onClick={() => startEdit(s)} title="编辑此条" className="mt-0.5 shrink-0 text-muted-foreground hover:text-copper"><Pencil size={14} /></button>
                        <button type="button" onClick={() => del(s.id)} title="删除此条" className="mt-0.5 shrink-0 text-muted-foreground hover:text-rose-300"><Trash2 size={14} /></button>
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-luxe text-muted-foreground">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-1.5 w-full rounded-lg border border-border bg-background-elev/50 px-3 py-2 text-sm text-foreground focus:border-copper/50 focus:outline-none" />
    </label>
  );
}
