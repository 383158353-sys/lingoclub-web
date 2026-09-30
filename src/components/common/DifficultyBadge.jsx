import React from "react";

// 难度徽章：统一青绿描边 + 半透明深底，在海报/剧照上清晰可读；
// 仅用透明度区分三档，避免抢眼。
const MAP = {
  beginner: { label: "入门", cls: "border-mint/50 bg-mint/15 text-mint" },
  intermediate: { label: "进阶", cls: "border-mint/40 bg-mint/10 text-mint/90" },
  advanced: { label: "高级", cls: "border-mint/30 bg-mint/5 text-mint/80" },
};

export default function DifficultyBadge({ level, className = "" }) {
  const c = MAP[level] || MAP.intermediate;
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide ${c.cls} ${className}`}>
      {c.label}
    </span>
  );
}