import { RotateCw } from "lucide-react";
import { STATUS_FILTERS } from "@/lib/libraryFilters";

export default function StatusFilterBar({ value, onChange, onRefresh, loading = false, refreshLabel = "刷新" }) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2 md:mt-8">
      {STATUS_FILTERS.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={value === key}
          className={`min-h-9 rounded-full border px-4 text-xs transition-colors ${value === key ? "border-copper/60 bg-copper/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
        >
          {label}
        </button>
      ))}
      {onRefresh && (
        <button type="button" onClick={onRefresh} disabled={loading} aria-label={refreshLabel} className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border px-3 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
          <RotateCw size={13} className={loading ? "animate-spin" : ""} /> {refreshLabel}
        </button>
      )}
    </div>
  );
}
