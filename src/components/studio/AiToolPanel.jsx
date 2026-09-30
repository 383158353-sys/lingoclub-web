import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import AiMetaFill from "@/components/common/AiMetaFill";
import AiCoverGenerator from "@/components/common/AiCoverGenerator";
import { Wand2 } from "lucide-react";

// 项目管理页 AI 助手：一键补全英文标语简介、一键生成海报 + 推荐图，
// 结果直接写回 Movie 实体并 onSaved 回灌父级状态，立即同步社区页面。
export default function AiToolPanel({ movie, onSaved }) {
  const { toast } = useToast();
  const [savingMeta, setSavingMeta] = useState(false);
  const [savingCover, setSavingCover] = useState(false);

  const applyMeta = async ({ title_en, tagline, description }) => {
    setSavingMeta(true);
    try {
      const updated = await base44.entities.Movie.update(movie.id, {
        title_en: title_en || movie.title_en || "",
        tagline: tagline || movie.tagline || "",
        description: description || movie.description || "",
      });
      onSaved?.(updated);
      toast({ title: "AI 已补全并保存", description: "英文片名、标语、简介已写回项目。" });
    } catch (e) {
      toast({ title: "保存失败", description: e?.message, variant: "destructive" });
    } finally {
      setSavingMeta(false);
    }
  };

  const applyCover = async ({ poster_url, backdrop_url }) => {
    setSavingCover(true);
    try {
      const updated = await base44.entities.Movie.update(movie.id, {
        poster_url,
        backdrop_url,
      });
      onSaved?.(updated);
      toast({ title: "AI 封面已生成并保存", description: "海报与推荐页图已写回项目。" });
    } catch (e) {
      toast({ title: "保存失败", description: e?.message, variant: "destructive" });
    } finally {
      setSavingCover(false);
    }
  };

  return (
    <div className="rounded-2xl border border-copper/25 bg-copper/[0.06] p-6 h-fit">
      <h2 className="font-display text-lg text-foreground flex items-center gap-2">
        <Wand2 size={16} className="text-copper" /> AI 助手 · 一键发布
      </h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        一键补全英文片名 / 标语 / 简介，并生成竖版海报与横版推荐页图。结果会直接写回项目并同步社区页面。
      </p>

      <div className="mt-4 space-y-4">
        <div>
          <p className="text-[10px] uppercase tracking-luxe text-copper">文本元信息</p>
          <div className="mt-2 flex items-center gap-2">
            <AiMetaFill title={movie.title} onFilled={applyMeta} />
            {savingMeta && <span className="text-[11px] text-muted-foreground">写入中…</span>}
          </div>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-luxe text-copper">视觉封面</p>
          <div className="mt-2">
            <AiCoverGenerator
              title={movie.title}
              tagline={movie.tagline}
              description={movie.description}
              onGenerated={applyCover}
            />
            {savingCover && <p className="mt-2 text-[11px] text-muted-foreground">写入中…</p>}
          </div>

          {(movie.poster_url || movie.backdrop_url) && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              {movie.poster_url && (
                <div>
                  <p className="text-[10px] uppercase tracking-luxe text-muted-foreground">当前海报</p>
                  <div className="mt-1 aspect-[2/3] overflow-hidden rounded-lg border border-border bg-background-elev">
                    <img src={movie.poster_url} alt="" className="h-full w-full object-cover" />
                  </div>
                </div>
              )}
              {movie.backdrop_url && (
                <div>
                  <p className="text-[10px] uppercase tracking-luxe text-muted-foreground">当前推荐图</p>
                  <div className="mt-1 aspect-video overflow-hidden rounded-lg border border-border bg-background-elev">
                    <img src={movie.backdrop_url} alt="" className="h-full w-full object-cover" />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}