import React, { useEffect, useState } from "react";
import { ListVideo, Loader2, RefreshCw, AlertCircle } from "lucide-react";
import SubtitleAnalysisPanel from "./SubtitleAnalysisPanel";
import { AISettingsButton } from "@/components/AISettingsPanel";

// Right rail: AI close-read of the active subtitle line. Shares state with
// the subtitle list under the video via the `study` object from useEpisodeStudy.
export default function StudyAnalysisColumn({ study, movieTitle, movieId, videoId, episodeId, episodeTitle, sourceType, sourceUrl, sourceRecordId }) {
  const { loading, subs, pinnedId, analyses, analyzingId, failedIds, retry } = study;
  const active = subs.find((s) => s.id === pinnedId) || null;
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!analyzingId) { setSlow(false); return undefined; }
    const timer = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(timer);
  }, [analyzingId]);

  if (loading) {
    return (
      <div>
        <div className="flex items-center justify-between gap-2"><h2 className="font-display text-lg text-foreground">实时台词精读</h2><AISettingsButton className="text-xs text-muted-foreground hover:text-copper">AI 设置</AISettingsButton></div>
        <p className="mt-3 text-sm text-muted-foreground">加载精读…</p>
      </div>
    );
  }

  if (subs.length === 0) {
    return (
      <div>
        <div className="flex items-center justify-between gap-2"><h2 className="font-display text-lg text-foreground">实时台词精读</h2><AISettingsButton className="text-xs text-muted-foreground hover:text-copper">AI 设置</AISettingsButton></div>
        <p className="mt-1 text-xs text-muted-foreground">点击下方某句台词即可开始 AI 精读。本集暂无台词。</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2"><h2 className="font-display text-base text-foreground">实时台词精读</h2><AISettingsButton className="text-xs text-muted-foreground hover:text-copper">AI 设置</AISettingsButton></div>
      <div className="mt-2">
        {active ? (
          analyzingId === active.id && !analyses[active.id] ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-border py-14 text-center">
              <Loader2 size={22} className="animate-spin text-copper" />
              <p className="mt-3 text-sm text-muted-foreground">{slow ? "正在分析，请稍候…" : "正在精读这句台词…"}</p>
            </div>
          ) : failedIds?.has?.(active.id) && !analyses[active.id] ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-border py-12 text-center">
              <AlertCircle size={20} className="text-muted-foreground/70" />
              <p className="mt-3 text-sm text-muted-foreground">这句暂未解析成功。</p>
              <button
                type="button"
                onClick={() => retry?.(active)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-xs text-foreground transition-colors hover:border-mint/50 hover:text-mint"
              >
                <RefreshCw size={12} /> 重试解析
              </button>
            </div>
          ) : (
            <div className="rounded-2xl border border-border/60 bg-card p-5">
              <SubtitleAnalysisPanel
                key={active.id}
                subtitle={{ ...active, analysis_status: analyses[active.id] ? "done" : "none", ai_analysis: analyses[active.id] || null }}
                movieTitle={movieTitle}
                movieId={movieId}
                videoId={videoId}
                sceneId={active.scene_id || null}
                episodeId={episodeId}
                episodeTitle={episodeTitle}
          sourceType={sourceType}
          sourceUrl={sourceUrl}
          sourceRecordId={sourceRecordId}
              />
            </div>
          )
        ) : (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">
            <ListVideo size={22} className="text-copper/70" />
            <p className="mt-3">点击下方某句台词，开始 AI 精读。</p>
          </div>
        )}
      </div>
    </div>
  );
}
