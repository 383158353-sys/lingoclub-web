// 语料库列表卡只展示掌握状态。类型、轮次、时间序号不在这里返回。
export const VOCAB_MASTERY = {
  new: { label: "未学", className: "text-muted-foreground bg-background-elev" },
  learning: { label: "学习中", className: "text-amber-300/90 bg-amber-400/10" },
  familiar: { label: "熟悉", className: "text-sky-300/90 bg-sky-400/10" },
  mastered: { label: "已掌握", className: "text-emerald-300/90 bg-emerald-400/10" },
};

export function vocabListMarker(card) {
  return VOCAB_MASTERY[card?.mastery_level] || VOCAB_MASTERY.new;
}
