import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, Heart, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { useToast } from "@/components/ui/use-toast";
import SelectionBubble from "@/components/study/SelectionBubble";
import VocabSaveButton from "@/components/study/VocabSaveButton";
import { articlesAvailable, getDailyArticle, markArticleRead, setArticleFavorite } from "@/lib/dailyArticles";
import { articleDomain, articleParagraphs, articleSourceUrl, normalizeAnalysis } from "@/lib/dailyArticlesFormat";

export default function DailyArticleReader() {
  const { id } = useParams();
  const { user } = useAuth();
  const { toast } = useToast();
  const [article, setArticle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    setArticle(null); setError(""); setLoading(true);
    if (!user || !articlesAvailable()) { setLoading(false); return; }
    getDailyArticle(id).then(async (row) => {
      if (!active) return;
      if (!row) { setError("文章不存在或无权查看"); return; }
      const readAt = row.read_at || new Date().toISOString();
      setArticle({ ...row, read_at: readAt });
      if (!row.read_at) {
        try { await markArticleRead(id, readAt); }
        catch {
          if (active) { setArticle((current) => current ? { ...current, read_at: null } : current); toast({ title: "阅读状态保存失败", description: "请稍后重新打开文章", variant: "destructive" }); }
        }
      }
    }).catch(() => { if (active) setError("文章加载失败，请稍后重试"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, user?.id, refresh, toast]);
  const favorite = async () => {
    const next = !article.favorited;
    setSaving(true); setArticle((row) => ({ ...row, favorited: next }));
    try { await setArticleFavorite(id, next); }
    catch { setArticle((row) => ({ ...row, favorited: !next })); toast({ title: "收藏失败", description: "请稍后重试", variant: "destructive" }); }
    finally { setSaving(false); }
  };
  const analysis = normalizeAnalysis(article?.analysis);
  const source = article ? { sourceType: "article", sourceRecordId: article.id, sourceUrl: article.source_url, movieTitle: article.title } : {};
  const href = articleSourceUrl(article?.source_url);
  return <div className="mx-auto max-w-5xl px-4 pb-20 pt-24 md:px-8 md:pt-28">
    <div className="flex items-center justify-between gap-3">
      <Link to="/recommendations?tab=articles" className="inline-flex min-h-10 items-center gap-2 text-sm text-muted-foreground"><ArrowLeft size={16} /><span className="md:hidden">返回文章</span><span className="hidden md:inline">返回今日推荐</span></Link>
      <Link to="/collection" className="inline-flex min-h-10 items-center text-sm text-copper">语料库</Link>
    </div>
    {!user ? <div className="py-16 text-center"><p>登录后查看每日推荐</p><Link to="/login" className="mt-4 inline-block text-copper">邮箱登录</Link></div>
      : !articlesAvailable() ? <p className="py-16 text-center">云端服务未配置</p>
      : loading ? <div className="flex justify-center py-20"><Loader2 className="animate-spin" /></div>
      : error ? <div className="py-16 text-center"><p>{error}</p><button type="button" onClick={() => setRefresh((n) => n + 1)} className="mt-4 text-copper">重试</button></div>
      : article && <>
        <header className="mt-6 border-b border-border pb-6">
          <h1 className="font-display text-2xl leading-tight md:text-4xl">{article.title}</h1>
          <p className="mt-3 text-xs text-muted-foreground">{[article.outlet || articleDomain(article.source_url), article.author, article.rec_date, article.level, article.read_at && "已读"].filter(Boolean).join(" · ")}</p>
          <div className="mt-4 flex gap-4">{href && <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-2 text-sm text-copper"><ExternalLink size={15} /> 查看出处</a>}
            <button type="button" onClick={favorite} disabled={saving} aria-pressed={article.favorited} className="inline-flex min-h-9 items-center gap-2 text-sm text-copper"><Heart size={16} fill={article.favorited ? "currentColor" : "none"} />{article.favorited ? "已收藏" : "收藏文章"}</button></div>
        </header>
        <section className="mt-8" aria-label="正文">
          <h2 className="mb-5 font-display text-xl">正文</h2>
          <p className="mb-4 text-xs text-muted-foreground">划选单词或短语，点击弹出的收藏按钮即可加入语料库；手机上可长按选词。</p>
          <div className="space-y-7">{articleParagraphs(article.body_en).map((paragraph, index) => {
            const summary = analysis.paragraph_summaries.find((row) => row.index === index + 1)?.zh;
            return <div key={`${id}-${index}`}>
              <SelectionBubble {...source} text={paragraph} translation={summary} className="whitespace-pre-line text-base leading-8 md:text-lg md:leading-9" />
              {summary && <p className="mt-3 border-l-2 border-copper/30 pl-4 text-sm leading-relaxed text-muted-foreground"><span className="mr-2 text-foreground/70">段落大意</span>{summary}</p>}
            </div>;
          })}</div>
        </section>
        <details open className="mt-10 rounded-2xl border border-border bg-background-soft/60 p-5 md:p-7">
          <summary className="cursor-pointer font-display text-xl">精读解析</summary>
          <AnalysisSection title="重点词汇" rows={analysis.key_vocab} type="word" source={source} />
          <AnalysisSection title="长难句" rows={analysis.long_sentences} type="sentence" source={source} />
          <AnalysisSection title="雅思可用表达" rows={analysis.ielts_expressions} type="phrase" source={source} />
        </details>
      </>}
  </div>;
}

function AnalysisSection({ title, rows, type, source }) {
  return <section className="mt-7"><h3 className="mb-3 font-medium text-copper">{title}</h3>
    {!rows.length ? <p className="text-sm text-muted-foreground">暂无解析</p> : <div className="space-y-4">{rows.map((row, index) => <div key={`${row.en}-${index}`} className="border-b border-border pb-4 last:border-0">
      <div className="flex items-start gap-3"><p className="flex-1 leading-relaxed">{row.en}</p><VocabSaveButton {...source} expression={row.en} meaning={row.zh || row.usage} type={type} sourceSentenceEn={type === "sentence" ? row.en : undefined} sourceSentenceZh={row.zh} /></div>
      {[row.zh, row.note, row.structure, row.usage].filter(Boolean).map((text, i) => <p key={i} className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{text}</p>)}
    </div>)}</div>}
  </section>;
}
