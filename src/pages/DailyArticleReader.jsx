import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, Heart, Loader2, Pencil, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { useToast } from "@/components/ui/use-toast";
import SelectionBubble from "@/components/study/SelectionBubble";
import SubtitleWordLookup from "@/components/study/SubtitleWordLookup";
import VocabSaveButton from "@/components/study/VocabSaveButton";
import ArticleQuestionTable from "@/components/study/ArticleQuestionTable";
import { articlesAvailable, getDailyArticle, markArticleRead, setArticleFavorite } from "@/lib/dailyArticles";
import {
  analysisHasClassroomNotes,
  articleDomain,
  articleParagraphs,
  articleSourceUrl,
  expressionDisplayFields,
  normalizeAnalysis,
  sentenceDisplayFields,
  vocabDisplayFields,
} from "@/lib/dailyArticlesFormat";
import { locateArticleSentence, splitSourceSentences } from "@/lib/sourceSentenceFocus";
import { getLibraryArticle, markLibraryArticleRead, restoreLibraryArticles, setLibraryArticleFavorite, softDeleteLibraryArticles } from "@/lib/libraryArticles";

const FIELD_LABEL = {
  ipa: "音标",
  pos: "词性",
  zh: "",
  collocation: "搭配",
  example_en: "例句",
  example_zh: "译文",
  forms: "词形",
  confusion: "易混",
  note: "",
  structure: "主干",
  clauses: "结构",
  reference: "指代",
  exam_note: "解题",
  usage: "用法",
  how: "用法",
};

export default function DailyArticleReader({ library = false }) {
  const getArticle = library ? getLibraryArticle : getDailyArticle;
  const markRead = library ? markLibraryArticleRead : markArticleRead;
  const setFavorite = library ? setLibraryArticleFavorite : setArticleFavorite;
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focusSentence = searchParams.get("sentence") || "";
  const focusWord = searchParams.get("word") || "";
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
    getArticle(id).then(async (row) => {
      if (!active) return;
      if (!row) { setError("文章不存在或无权查看"); return; }
      const readAt = row.read_at || new Date().toISOString();
      setArticle({ ...row, read_at: readAt });
      if (!row.read_at && !row.deleted_at) {
        try { await markRead(id, readAt); }
        catch {
          if (active) { setArticle((current) => current ? { ...current, read_at: null } : current); toast({ title: "阅读状态保存失败", description: "请稍后重新打开文章", variant: "destructive" }); }
        }
      }
    }).catch(() => { if (active) setError("文章加载失败，请稍后重试"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, user?.id, refresh, toast, getArticle, markRead]);
  const favorite = async () => {
    const next = !article.favorited;
    setSaving(true); setArticle((row) => ({ ...row, favorited: next }));
    try { await setFavorite(id, next); }
    catch { setArticle((row) => ({ ...row, favorited: !next })); toast({ title: "收藏失败", description: "请稍后重试", variant: "destructive" }); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!library || saving) return;
    setSaving(true);
    try {
      await softDeleteLibraryArticles([id]);
      toast({
        title: "已放入回收站",
        action: <button type="button" className="text-sm text-copper" onClick={() => restoreLibraryArticles([id]).then(() => setRefresh((n) => n + 1))}>撤销</button>,
      });
      navigate("/local-study?tab=articles");
    } catch { toast({ title: "删除失败", description: "请稍后重试", variant: "destructive" }); }
    finally { setSaving(false); }
  };
  const restore = async () => {
    setSaving(true);
    try {
      await restoreLibraryArticles([id]);
      toast({ title: "文章已恢复" });
      setRefresh((n) => n + 1);
    } catch { toast({ title: "恢复失败", variant: "destructive" }); }
    finally { setSaving(false); }
  };
  const analysis = normalizeAnalysis(article?.analysis);
  const located = article ? locateArticleSentence(article.body_en, { sentence: focusSentence, word: focusWord }) : null;
  const focusParagraph = located?.paragraphIndex;
  const focusSentenceIndex = located?.sentenceIndex;
  useEffect(() => {
    if (loading || focusParagraph === undefined || focusSentenceIndex === undefined || (!focusSentence && !focusWord)) return undefined;
    const selector = `[data-article-sentence="${focusParagraph}-${focusSentenceIndex}"]`;
    const frame = requestAnimationFrame(() => {
      document.querySelector(selector)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [article?.id, loading, focusParagraph, focusSentenceIndex, focusSentence, focusWord]);
  const source = article ? { sourceType: library ? "library_article" : "article", sourceRecordId: article.id, sourceUrl: article.source_url, movieTitle: article.title } : {};
  const href = articleSourceUrl(article?.source_url);
  const meanings = Object.fromEntries([...analysis.key_vocab, ...analysis.long_sentences, ...analysis.ielts_expressions].map((row) => [row.en.toLowerCase(), row.zh || row.usage || ""]));
  return <div className="mx-auto max-w-5xl px-4 pb-20 pt-[calc(env(safe-area-inset-top)+1rem)] md:px-8 md:pt-28">
    <div className="flex items-center justify-between gap-3">
      <Link to={library ? "/local-study?tab=articles" : "/recommendations?tab=articles"} className="inline-flex min-h-10 items-center gap-2 text-sm text-muted-foreground"><ArrowLeft size={16} />{library ? "返回学习文章" : "返回文章"}</Link>
      <Link to="/collection" className="inline-flex min-h-10 items-center text-sm text-copper">语料库</Link>
    </div>
    {!user ? <div className="py-16 text-center"><p>登录后查看每日推荐</p><Link to="/login" className="mt-4 inline-block text-copper">邮箱登录</Link></div>
      : !articlesAvailable() ? <p className="py-16 text-center">云端服务未配置</p>
      : loading ? <div className="flex justify-center py-20"><Loader2 className="animate-spin" /></div>
      : error ? <div className="py-16 text-center"><p>{error}</p><button type="button" onClick={() => setRefresh((n) => n + 1)} className="mt-4 text-copper">重试</button></div>
      : article && <>
        <header className="mt-6 border-b border-border pb-6">
          <h1 className="font-display text-2xl leading-tight md:text-4xl">{article.title}</h1>
          <p className="mt-3 text-xs text-muted-foreground">{[article.outlet || articleDomain(article.source_url), article.author, article.rec_date, article.level, article.read_at && "已读", article.deleted_at && "回收站"].filter(Boolean).join(" · ")}</p>
          {article.summary_zh && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{article.summary_zh}</p>}
          <div className="mt-4 flex flex-wrap gap-4">
            {href && <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-2 text-sm text-copper"><ExternalLink size={15} /> 查看出处</a>}
            {!article.deleted_at && <button type="button" onClick={favorite} disabled={saving} aria-pressed={article.favorited} className="inline-flex min-h-9 items-center gap-2 text-sm text-copper"><Heart size={16} fill={article.favorited ? "currentColor" : "none"} />{article.favorited ? "已收藏" : "收藏文章"}</button>}
            {library && !article.deleted_at && <Link to={`/local-study?tab=articles&edit=${encodeURIComponent(id)}`} className="inline-flex min-h-9 items-center gap-2 text-sm text-copper"><Pencil size={15} /> 编辑</Link>}
            {library && !article.deleted_at && <button type="button" onClick={remove} disabled={saving} className="inline-flex min-h-9 items-center gap-2 text-sm text-muted-foreground"><Trash2 size={15} /> 删除</button>}
            {library && article.deleted_at && <button type="button" onClick={restore} disabled={saving} className="inline-flex min-h-9 items-center gap-2 text-sm text-copper">从回收站恢复</button>}
          </div>
        </header>
        {article.deleted_at ? <p className="py-12 text-center text-muted-foreground">这篇文章在回收站中。词汇收藏和复习进度仍保留，恢复后可继续从词条跳回。</p> : <>
        <section className="mt-8" aria-label="英文原文">
          <h2 className="mb-5 font-display text-xl">英文原文</h2>
          <p className="mb-4 text-xs text-muted-foreground">点击单词查看释义并收藏；短语、整句可划选后收藏，手机上可长按拖选。</p>
          <div className="space-y-7">{articleParagraphs(article.body_en).map((paragraph, index) => {
            const summary = analysis.paragraph_summaries.find((row) => row.index === index + 1)?.zh;
            const sentences = splitSourceSentences(paragraph);
            const parts = sentences.length ? sentences : [paragraph];
            return <div key={`${id}-${index}`}>
              <SelectionBubble {...source} text={paragraph} translation={summary} selectionMeanings={meanings} className="whitespace-pre-line text-base leading-8 md:text-lg md:leading-9">
                {parts.map((sentence, sentenceIndex) => {
                  const focused = located?.paragraphIndex === index && located?.sentenceIndex === sentenceIndex;
                  return <span key={sentenceIndex} data-article-sentence={`${index}-${sentenceIndex}`} className={focused ? "scroll-mt-24 rounded-sm bg-mint/10" : undefined}>{sentenceIndex > 0 ? " " : ""}<SubtitleWordLookup as="span" {...source} text={sentence} translation={summary} contextText={paragraph} highlightTerm={focused ? focusWord : ""} wordMeanings={Object.fromEntries(analysis.key_vocab.filter((row) => row.zh).map((row) => [row.en.toLowerCase(), row.zh]))} /></span>;
                })}
              </SelectionBubble>
              {summary && <p className="mt-3 border-l-2 border-copper/30 pl-4 text-sm leading-relaxed text-muted-foreground"><span className="mr-2 text-foreground/70">段落大意</span>{summary}</p>}
            </div>;
          })}</div>
        </section>
        {analysis.questions.map((question, index) => (
          <section key={`${question.number}-${index}`} className="mt-10" aria-label="题目">
            <h2 className="mb-3 font-display text-xl">{question.number ? `题目 ${question.number}` : "题目"}</h2>
            {question.instruction && <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{question.instruction}</p>}
            {question.prompt && <p className="mt-2 whitespace-pre-line leading-relaxed">{question.prompt}</p>}
            <ArticleQuestionTable table={question.table} />
          </section>
        ))}
        {analysisHasClassroomNotes(analysis) && (
          <div className="mt-10 space-y-10">
            <AnalysisSection title="重点词汇与短语" rows={analysis.key_vocab} type="word" source={source} fields={vocabDisplayFields} />
            <AnalysisSection title="长难句" rows={analysis.long_sentences} type="sentence" source={source} fields={sentenceDisplayFields} extra={(row) => row.question_no && <p className="mt-2 text-xs text-copper">对应题号 {row.question_no}</p>} />
            <AnalysisSection title="实用表达" rows={analysis.ielts_expressions} type="phrase" source={source} fields={expressionDisplayFields} />
            {(analysis.answer_key.length || analysis.pitfalls.length) ? (
              <details className="rounded-2xl border border-border bg-background-soft/60 p-5 md:p-7">
                <summary className="cursor-pointer font-display text-xl">答案解析与本课易错点</summary>
                <p className="mt-2 text-xs text-muted-foreground">先自行重做题目，再展开对照。</p>
                {analysis.answer_key.map((row, index) => (
                  <div key={`${row.number}-${index}`} className="mt-4 border-b border-border pb-3 last:border-0">
                    <p className="font-medium">{[row.number, row.answer].filter(Boolean).join(" · ")}</p>
                    {row.explanation && <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{row.explanation}</p>}
                  </div>
                ))}
                {analysis.pitfalls.map((item, index) => <p key={index} className="mt-3 text-sm leading-relaxed text-muted-foreground">{item}</p>)}
              </details>
            ) : null}
          </div>
        )}
        </>}
      </>}
  </div>;
}

function AnalysisSection({ title, rows, type, source, fields, extra }) {
  if (!rows?.length) return null;
  return <section><h2 className="mb-4 font-display text-xl">{title}</h2>
    <div className="space-y-4">{rows.map((row, index) => <div key={`${row.en}-${index}`} className="border-b border-border pb-4 last:border-0">
      <div className="flex items-start gap-3"><p className="flex-1 leading-relaxed">{row.en}</p><VocabSaveButton {...source} expression={row.en} meaning={row.zh || row.usage} type={type} sourceSentenceEn={type === "sentence" ? row.en : undefined} sourceSentenceZh={row.zh} /></div>
      {fields(row).map(([key, value]) => (
        <p key={key} className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
          {FIELD_LABEL[key] ? <span className="mr-2 text-foreground/70">{FIELD_LABEL[key]}</span> : null}{value}
        </p>
      ))}
      {extra?.(row)}
    </div>)}</div>
  </section>;
}
