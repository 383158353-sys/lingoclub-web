import { vocabListMarker } from "@/lib/vocabListCard";

export default function VocabListCard({ c, onSelect, hideSource = false, fontScale = 1 }) {
  const marker = vocabListMarker(c);
  return (
    <div className="rounded-lg border border-border/60 bg-card">
      <button type="button" onClick={() => onSelect?.(c)} className="block w-full rounded-lg p-2 text-left touch-manipulation [-webkit-tap-highlight-color:transparent] active:bg-white/[0.04] md:rounded-xl md:p-4">
        <p style={{ "--corpus-font-scale": fontScale }} className="font-display text-[calc(1.25rem*var(--corpus-font-scale))] font-semibold leading-snug text-foreground md:text-[calc(1.5rem*var(--corpus-font-scale))]">{c.expression_en || c.text_en}</p>
        {(c.meaning_zh || c.text_zh) && <p style={{ "--corpus-font-scale": fontScale }} className="mt-1 text-[calc(0.875rem*var(--corpus-font-scale))] leading-snug text-foreground/75 md:text-[calc(1rem*var(--corpus-font-scale))]">{c.meaning_zh || c.text_zh}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px] md:mt-2.5 md:gap-1.5 md:text-xs">
          <span className={`rounded-full px-1.5 py-0.5 md:px-2 ${marker.className}`}>{marker.label}</span>
        </div>
        {!hideSource && c.source_movie_title && <p className="mt-1 text-[10px] text-muted-foreground/65 md:text-[11px]">— {c.source_movie_title}</p>}
      </button>
    </div>
  );
}
