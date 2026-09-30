import React from "react";
import { Image as BaseImage } from "@/components/ui/image";
import LocalPosterImage from "@/components/study/LocalPosterImage";
import { extractYouTubeId } from "@/lib/youtubeTranscriptClient";
import { Film, Trash2, Check } from "lucide-react";

function getThumbUrl(meta) {
  if (meta.poster_url) return meta.poster_url;
  if (meta.video_url) {
    const ytId = extractYouTubeId(meta.video_url);
    if (ytId) return `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
  }
  return null;
}

export default function LocalMovieCard({ meta, manageMode, selected, onToggleSelect, onOpen, onDelete, landscape }) {
  const thumbUrl = getThumbUrl(meta);
  const aspectClass = landscape ? "aspect-video" : "aspect-[2/3]";
  const titleClass = landscape
    ? "line-clamp-2 px-2 py-1.5 text-left font-body text-[11px] leading-snug text-foreground md:px-3 md:py-2 md:text-[13px]"
    : "line-clamp-2 px-2 py-1.5 text-center font-display text-[11px] leading-snug text-foreground md:px-2.5 md:py-2 md:text-[13px]";

  return (
    <div className={`group relative overflow-hidden rounded-xl border bg-card transition-colors ${selected ? "border-copper" : "border-border/60 hover:border-copper/40"}`}>
      {manageMode && (
        <button
          type="button"
          onClick={() => onToggleSelect(meta.id)}
          className={`absolute left-1.5 top-1.5 z-20 flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors ${selected ? "border-copper bg-copper text-copper-foreground" : "border-white/40 bg-black/50 text-transparent hover:border-copper"}`}
        >
          {selected && <Check size={14} />}
        </button>
      )}
      <button type="button" onClick={() => !manageMode && onOpen(meta)} className="block w-full text-left" disabled={manageMode}>
        <div className={`${aspectClass} w-full overflow-hidden bg-muted/30`}>
          {meta.video_url ? (thumbUrl ? (
            <BaseImage src={thumbUrl} fittingType="fill" alt={meta.name || "封面"} className="h-full w-full transition-transform duration-300 group-hover:scale-105" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground/40"><Film size={28} /></div>
          )) : <LocalPosterImage item={meta} alt={meta.name || "封面"} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" placeholder={<div className="flex h-full w-full items-center justify-center text-muted-foreground/40"><Film size={28} /></div>} />}
        </div>
        <h3 className={titleClass}>{meta.name}</h3>
      </button>
      {!manageMode && (
        <button
          type="button"
          onClick={() => onDelete(meta.id)}
          title="删除这部影片"
          className="absolute right-1 top-1 inline-flex items-center rounded-full bg-black/55 p-1 text-white/75 opacity-0 backdrop-blur-sm transition-all hover:bg-rose-500/80 hover:text-white group-hover:opacity-100 md:right-1.5 md:top-1.5 md:p-1.5"
        >
          <Trash2 size={12} className="md:size-[13px]" />
        </button>
      )}
    </div>
  );
}
