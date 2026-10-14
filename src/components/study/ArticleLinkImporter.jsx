import React, { useState } from "react";
import { importLibraryArticle } from "@/lib/libraryArticles";
import { useToast } from "@/components/ui/use-toast";

export default function ArticleLinkImporter({ onReady, onCancel }) {
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
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
    <h1 className="font-display text-2xl">导入精读文章</h1><p className="text-sm text-muted-foreground">粘贴出处链接和英文正文，不会自动抓取网页。</p>
    {[['source_url','出处链接',true],['title','标题',true],['body_en','英文正文',true],['author','作者'],['outlet','出处名称'],['level','难度'],['summary_zh','中文简介'],['analysis','精读解析 JSON（选填）']].map(([key,label,required])=><label key={key} className="block text-sm"><span>{label}</span>{['body_en','analysis','summary_zh'].includes(key)?<textarea required={required} rows={key==='body_en'?10:4} value={draft[key]||''} onChange={e=>setDraft({...draft,[key]:e.target.value})} className="mt-2 w-full rounded-xl border border-border bg-card p-3"/>:<input type={key==='source_url'?'url':'text'} required={required} value={draft[key]||''} onChange={e=>setDraft({...draft,[key]:e.target.value})} className="mt-2 w-full rounded-xl border border-border bg-card p-3"/>}</label>)}
    <div className="flex gap-4"><button disabled={saving} className="min-h-11 rounded-full bg-copper px-6 text-copper-foreground">{saving?'导入中…':'导入文章'}</button><button type="button" disabled={saving} onClick={onCancel}>取消</button></div>
  </form>;
}
