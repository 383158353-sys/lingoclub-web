import React, { useEffect, useState } from "react";
import { invokeAI } from "@/lib/localApi";
import { useToast } from "@/components/ui/use-toast";
import { Sparkles, Loader2, Volume2, BookOpen, Globe, Languages, Quote } from "lucide-react";
import VocabSaveButton from "./VocabSaveButton";
import SelectionBubble from "./SelectionBubble";
import { AISettingsButton } from "@/components/AISettingsPanel";
import { safeAIErrorMessage } from "@/lib/aiSettings";

// Renders the structured AI language + cultural analysis for one subtitle line.
export default function SubtitleAnalysisPanel({ subtitle, movieTitle, movieId, videoId = "local", sceneId, episodeId, episodeTitle, sourceType, sourceUrl, sourceRecordId, onSaved }) {
  const stored = subtitle.analysis_status === "done" && subtitle.ai_analysis ? subtitle.ai_analysis : null;
  const [analysis, setAnalysis] = useState(stored);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { toast } = useToast();
  useEffect(() => {
    if (stored) setAnalysis(stored);
  }, [stored]);
  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await invokeAI("translate_sentence", {
        text_en: subtitle.text_en,
        subtitle_text: subtitle.text_en,
        video_id: videoId,
        movie_title: movieTitle,
        speaker: subtitle.speaker,
      });
      const a = res?.analysis;
      if (!a) throw new Error("解析未返回内容");
      setAnalysis(a);
    } catch (e) {
      const safeMessage = safeAIErrorMessage(e);
      setError(safeMessage);
      toast({ title: e?.code === "AI_NOT_CONFIGURED" ? "AI 解析尚未配置" : "AI 解析失败", description: safeMessage, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (!analysis && !loading) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center">
        <Sparkles size={22} className="text-copper" />
        <p className="mt-3 text-sm text-muted-foreground">让 AI 解构这句台词的单词、语法、发音与文化背景。</p>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        {error === "AI 解析尚未配置" && <AISettingsButton className="mt-2 text-xs text-copper underline">设置 AI →</AISettingsButton>}
        <div className="mt-2"><AISettingsButton className="text-xs text-muted-foreground hover:text-copper">AI 设置</AISettingsButton></div>
        <button
          onClick={generate}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-copper px-5 py-2 text-sm font-medium text-copper-foreground transition-transform hover:scale-[1.02]"
        >
          <Sparkles size={15} /> 生成 AI 精读
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-border py-12 text-center">
        <Loader2 size={22} className="animate-spin text-copper" />
        <p className="mt-3 text-sm text-muted-foreground">正在精读这句台词…</p>
      </div>
    );
  }

  const a = analysis;
  const translation = a?.translation || subtitle.ai_processing?.translation || subtitle.text_zh || "";
  const sourceCue = { id: subtitle.id, start: subtitle.time_start, end: subtitle.time_end, textEn: subtitle.text_en, textZh: translation };
  return (
    <div className="space-y-5">
      {/* header line */}
      <div className="flex items-start justify-between gap-4 border-b border-border/50 pb-4">
        <div className="min-w-0">
          <SelectionBubble
            text={subtitle.text_en}
            translation={translation}
            className="select-text font-display text-lg leading-snug text-foreground"
            title="可拖动选中单词或短语加入收藏"
            movieId={movieId}
            sourceUrl={sourceUrl}
            sourceRecordId={sourceRecordId}
            movieTitle={movieTitle}
            sceneId={sceneId}
            subtitleId={subtitle.id}
            sourceCue={sourceCue}
            timestamp={subtitle.timestamp}
            sourceSentenceEn={subtitle.text_en}
            sourceSentenceZh={translation}
            episodeId={episodeId}
            episodeTitle={episodeTitle}
            sourceType={sourceType}
          />
          {translation && <p className="mt-1.5 flex items-start gap-1.5 text-[15px] leading-relaxed text-muted-foreground"><Languages size={13} className="mt-1 shrink-0 text-copper/60" />{translation}</p>}
          {subtitle.speaker && <p className="mt-1 text-xs text-copper/80">— {subtitle.speaker}</p>}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          {translation && (
            <VocabSaveButton
              expression={subtitle.text_en}
              meaning={translation}
              tag="整句台词"
              type="sentence"
              movieId={movieId}
              movieTitle={movieTitle}
              sceneId={sceneId}
              subtitleId={subtitle.id}
              sourceCue={sourceCue}
              timestamp={subtitle.timestamp}
              timestampSeconds={subtitle.time_start}
              sourceSentenceEn={subtitle.text_en}
              sourceSentenceZh={translation}
              episodeId={episodeId}
              episodeTitle={episodeTitle}
              sourceType={sourceType}
              sourceUrl={sourceUrl}
              sourceRecordId={sourceRecordId}
              onSaved={onSaved}
            />
          )}
        </div>
      </div>
      {!a._complete && <p className="text-[11px] text-muted-foreground">已显示预处理翻译与重点表达，正在补充精读分析…</p>}

      <Grid>
        {a.words?.length > 0 && (
          <Section title="单词" icon={BookOpen}>
            <ul className="space-y-2.5">
              {a.words.map((w, i) => (
                <li key={i} className="group flex items-start justify-between gap-3">
                  <p className="text-sm">
                    <span className="font-medium text-foreground">{w.word}</span>
                    {w.phonetic && <span className="ml-2 font-mono text-[11px] text-muted-foreground">{w.phonetic}</span>}
                    {(w.partOfSpeech || w.pos) && <span className="ml-2 text-[11px] italic text-copper/70">{w.partOfSpeech || w.pos}</span>}
                    <span className="block text-xs text-muted-foreground">{w.meaning}</span>
                    {w.contextMeaning && <span className="block text-[11px] text-muted-foreground/70">{w.contextMeaning}</span>}
                  </p>
                  <VocabSaveButton expression={w.word} meaning={w.meaning} tag="生词" type="word" movieId={movieId} movieTitle={movieTitle} sceneId={sceneId} subtitleId={subtitle.id} sourceCue={sourceCue} timestamp={subtitle.timestamp} timestampSeconds={subtitle.time_start} timestampEnd={subtitle.time_end} sourceSentenceEn={subtitle.text_en} sourceSentenceZh={translation} episodeId={episodeId} episodeTitle={episodeTitle} sourceType={sourceType} sourceUrl={sourceUrl} sourceRecordId={sourceRecordId} onSaved={onSaved} />
                </li>
              ))}
            </ul>
          </Section>
        )}
        {a.phrases?.length > 0 && (
          <Section title="短语" icon={Languages}>
            <ul className="space-y-2.5">
              {a.phrases.map((p, i) => (
                <li key={i} className="group flex items-start justify-between gap-3">
                  <p className="text-sm">
                    <span className="font-medium text-foreground">{p.phrase}</span>
                    <span className="block text-xs text-muted-foreground">{p.meaning}</span>
                    {p.usage && <span className="block text-[11px] text-muted-foreground/70">{p.usage}</span>}
                  </p>
                  <VocabSaveButton expression={p.phrase} meaning={p.meaning} tag="短语" type="phrase" movieId={movieId} movieTitle={movieTitle} sceneId={sceneId} subtitleId={subtitle.id} sourceCue={sourceCue} timestamp={subtitle.timestamp} timestampSeconds={subtitle.time_start} timestampEnd={subtitle.time_end} sourceSentenceEn={subtitle.text_en} sourceSentenceZh={translation} episodeId={episodeId} episodeTitle={episodeTitle} sourceType={sourceType} sourceUrl={sourceUrl} sourceRecordId={sourceRecordId} onSaved={onSaved} />
                </li>
              ))}
            </ul>
          </Section>
        )}
      </Grid>

      <Field icon={Volume2} label="发音提示" text={a.pronunciation} />
      <Field icon={BookOpen} label="语法结构" text={a.grammar} />
      <Field icon={Globe} label="文化背景" text={a.cultural} />

      {a.expressions?.length > 0 && (
        <div>
          <p className="mb-3 flex items-center gap-2 text-xs uppercase tracking-luxe text-copper/80">
            <Quote size={12} /> AI 扩展表达
          </p>
          <div className="space-y-2.5">
            {a.expressions.map((e, i) => (
              <div key={i} className="rounded-lg border border-border bg-background-elev/40 p-3">
                <p className="text-sm text-foreground">{e.expression}</p>
                {e.meaning && <p className="mt-1 text-xs text-muted-foreground">{e.meaning}</p>}
                <div className="mt-2">
                  <VocabSaveButton expression={e.expression} meaning={e.meaning} tag="扩展表达" type="phrase" movieId={movieId} movieTitle={movieTitle} sceneId={sceneId} subtitleId={subtitle.id} sourceCue={sourceCue} timestamp={subtitle.timestamp} timestampSeconds={subtitle.time_start} timestampEnd={subtitle.time_end} sourceSentenceEn={subtitle.text_en} sourceSentenceZh={translation} episodeId={episodeId} episodeTitle={episodeTitle} sourceType={sourceType} sourceUrl={sourceUrl} sourceRecordId={sourceRecordId} onSaved={onSaved} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Grid({ children }) {
  return <div className="space-y-5">{children}</div>;
}

function Section({ title, icon: Icon, children }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background-elev/40 p-4">
      <p className="mb-3 flex items-center gap-2 text-xs uppercase tracking-luxe text-copper/80">
        <Icon size={12} /> {title}
      </p>
      {children}
    </div>
  );
}

function Field({ icon: Icon, label, text }) {
  if (!text) return null;
  return (
    <div className="border-l-2 border-copper/30 pl-4">
      <p className="flex items-center gap-2 text-xs uppercase tracking-luxe text-copper/80">
        <Icon size={12} /> {label}
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-foreground/85">{text}</p>
    </div>
  );
}
