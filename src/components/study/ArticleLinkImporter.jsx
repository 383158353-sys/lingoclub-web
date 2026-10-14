import React, { useState } from "react";
import { importLibraryArticle } from "@/lib/libraryArticles";
import { useToast } from "@/components/ui/use-toast";

export default function ArticleLinkImporter({ onReady, onCancel }) {
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const { toast } = useToast();
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
      const article = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(article.error || "无法自动提取，请粘贴正文");
      setDraft((current) => current.source_url?.trim() !== url ? current : ({
        ...current, source_url: article.source_url || current.source_url,
        title: article.title || current.title, body_en: article.body_en || current.body_en,
        author: article.author || current.author, outlet: article.outlet || current.outlet,
      }));
      toast({ title: "正文已提取", description: "请检查并编辑内容，再导入文章" });
    } catch (error) { toast({ title: "提取失败", description: `${error.message || "无法自动提取"}；请粘贴正文`, variant: "destructive" }); }
    finally { setExtracting(false); }
  };
  const submit = async (event) => {
    event.preventDefault(); setSaving(true);
    try {
      const analysis = draft.analysis?.trim() ? JSON.parse(draft.analysis) : {};
      await importLibraryArticle({ ...draft, analysis });
      toast({ title: "文章已导入" }); onReady();
    } catch (error) { toast({ title: "导入失败", description: error instanceof SyntaxError ? "精读解析 JSON 格式无效" : error.message, variant: "destructive" }); }
    finally { setSaving(false); }
  };
  return <form onSubmit={submit} className="mx-auto max-w-2xl space-y-5 px-4 pb-24 pt-6 md:pt-28">
    <h1 className="font-display text-2xl">导入精读文章</h1><p className="text-sm text-muted-foreground">粘贴公开文章链接，可尝试自动提取标题和正文。付费墙或限制抓取的网站可能失败，可手动粘贴正文。</p>
    <label className="block text-sm"><span>出处链接</span><input type="url" required value={draft.source_url || ''} onChange={e=>setDraft({...draft,source_url:e.target.value})} className="mt-2 w-full rounded-xl border border-border bg-card p-3"/></label>
    <button type="button" disabled={extracting || saving} onClick={extract} className="min-h-11 rounded-full border border-copper px-5 text-sm text-copper disabled:opacity-50">{extracting ? '提取中…' : '提取正文'}</button>
    {[['title','标题',true],['body_en','英文正文',true],['author','作者'],['outlet','出处名称'],['level','难度'],['summary_zh','中文简介'],['analysis','精读解析 JSON（选填）']].map(([key,label,required])=><label key={key} className="block text-sm"><span>{label}</span>{['body_en','analysis','summary_zh'].includes(key)?<textarea required={required} rows={key==='body_en'?10:4} value={draft[key]||''} onChange={e=>setDraft({...draft,[key]:e.target.value})} className="mt-2 w-full rounded-xl border border-border bg-card p-3"/>:<input type="text" required={required} value={draft[key]||''} onChange={e=>setDraft({...draft,[key]:e.target.value})} className="mt-2 w-full rounded-xl border border-border bg-card p-3"/>}</label>)}
    <div className="flex gap-4"><button disabled={saving} className="min-h-11 rounded-full bg-copper px-6 text-copper-foreground">{saving?'导入中…':'导入文章'}</button><button type="button" disabled={saving} onClick={onCancel}>取消</button></div>
  </form>;
}
