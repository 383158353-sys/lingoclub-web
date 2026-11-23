import React, { useEffect, useState } from "react";
import { importLibraryArticle, updateLibraryArticle } from "@/lib/libraryArticles";
import { useToast } from "@/components/ui/use-toast";
import ArticleAnalysisEditor, { analysisFromEditor, analysisToEditor } from "./ArticleAnalysisEditor";

const EMPTY = { source_url: "", title: "", body_en: "", author: "", outlet: "", level: "", summary_zh: "" };

export default function ArticleLinkImporter({ article, onReady, onCancel }) {
  const editing = Boolean(article?.id);
  const [draft, setDraft] = useState(EMPTY);
  const [analysis, setAnalysis] = useState(analysisToEditor({}));
  const [analysisJson, setAnalysisJson] = useState("");
  const [showJson, setShowJson] = useState(false);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!article) return;
    setDraft({
      source_url: article.source_url || "",
      title: article.title || "",
      body_en: article.body_en || "",
      author: article.author || "",
      outlet: article.outlet || "",
      level: article.level || "",
      summary_zh: article.summary_zh || "",
    });
    const next = analysisToEditor(article.analysis);
    setAnalysis(next);
    setAnalysisJson(JSON.stringify(article.analysis || {}, null, 2));
  }, [article]);

  const extract = async () => {
    if (extracting) return;
    const url = draft.source_url?.trim();
    if (!url) { toast({ title: "请先粘贴文章链接", variant: "destructive" }); return; }
    setExtracting(true);
    try {
      const { supabase } = await import("@/lib/supabaseClient");
      const { data } = await supabase?.auth.getSession() || { data: { session: null } };
      const token = data?.session?.access_token;
      if (!token) throw new Error("请先登录后提取文章");
      const response = await fetch("/api/articles/extract", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url }), cache: "no-store",
      });
      const extracted = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(extracted.error || "无法自动提取，请粘贴正文");
      setDraft((current) => current.source_url?.trim() !== url ? current : ({
        ...current, source_url: extracted.source_url || current.source_url,
        title: extracted.title || current.title, body_en: extracted.body_en || current.body_en,
        author: extracted.author || current.author, outlet: extracted.outlet || current.outlet,
      }));
      toast({ title: "正文已提取", description: "请检查并编辑内容，再保存文章" });
    } catch (error) { toast({ title: "提取失败", description: `${error.message || "无法自动提取"}；请粘贴正文`, variant: "destructive" }); }
    finally { setExtracting(false); }
  };

  const applyJson = () => {
    try {
      const parsed = analysisJson.trim() ? JSON.parse(analysisJson) : {};
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new SyntaxError();
      setAnalysis(analysisToEditor(parsed));
      toast({ title: "已从 JSON 填充表单" });
    } catch { toast({ title: "精读解析 JSON 格式无效", variant: "destructive" }); }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      let parsed = {};
      if (showJson && analysisJson.trim()) {
        parsed = JSON.parse(analysisJson);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new SyntaxError();
      }
      const analysisPayload = { ...parsed, ...analysisFromEditor(analysis) };
      const payload = { ...draft, analysis: analysisPayload };
      if (editing) await updateLibraryArticle(article.id, payload, article);
      else await importLibraryArticle(payload);
      toast({ title: editing ? "文章已保存" : "文章已导入" });
      onReady(article?.id);
    } catch (error) {
      toast({
        title: editing ? "保存失败" : "导入失败",
        description: error instanceof SyntaxError ? "精读解析 JSON 格式无效" : error.message,
        variant: "destructive",
      });
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-5 px-4 pb-24 pt-6 md:pt-28">
      <h1 className="font-display text-2xl">{editing ? "编辑精读文章" : "导入精读文章"}</h1>
      <p className="text-sm text-muted-foreground">{editing ? "保存后仍使用原来的文章地址，不会新增一篇。" : "粘贴公开文章链接，可尝试自动提取标题和正文。付费墙或限制抓取的网站可能失败，可手动粘贴正文。"}</p>
      <label className="block text-sm"><span>出处链接</span><input type="url" required value={draft.source_url} onChange={(e) => setDraft({ ...draft, source_url: e.target.value })} className="mt-2 w-full rounded-xl border border-border bg-card p-3" /></label>
      <button type="button" disabled={extracting || saving} onClick={extract} className="min-h-11 rounded-full border border-copper px-5 text-sm text-copper disabled:opacity-50">{extracting ? "提取中…" : "提取正文"}</button>
      {[["title", "标题", true], ["body_en", "英文正文", true], ["author", "作者"], ["outlet", "出处名称"], ["level", "难度"], ["summary_zh", "中文简介"]].map(([key, label, required]) => (
        <label key={key} className="block text-sm"><span>{label}</span>
          {["body_en", "summary_zh"].includes(key)
            ? <textarea required={required} rows={key === "body_en" ? 10 : 4} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} className="mt-2 w-full rounded-xl border border-border bg-card p-3" />
            : <input type="text" required={required} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} className="mt-2 w-full rounded-xl border border-border bg-card p-3" />}
        </label>
      ))}
      <ArticleAnalysisEditor analysis={analysis} onChange={setAnalysis} />
      <div>
        <button type="button" onClick={() => setShowJson((value) => !value)} className="text-sm text-muted-foreground">{showJson ? "收起 JSON" : "兼容：直接编辑 JSON"}</button>
        {showJson && (
          <div className="mt-2 space-y-2">
            <textarea rows={8} value={analysisJson} onChange={(e) => setAnalysisJson(e.target.value)} className="w-full rounded-xl border border-border bg-card p-3 font-mono text-xs" />
            <button type="button" onClick={applyJson} className="text-sm text-copper">用 JSON 填充上方表单</button>
          </div>
        )}
      </div>
      <div className="flex gap-4">
        <button disabled={saving} className="min-h-11 rounded-full bg-copper px-6 text-copper-foreground">{saving ? (editing ? "保存中…" : "导入中…") : (editing ? "保存修改" : "导入文章")}</button>
        <button type="button" disabled={saving} onClick={onCancel}>取消</button>
      </div>
    </form>
  );
}
