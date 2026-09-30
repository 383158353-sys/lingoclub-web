import React from "react";
import { ExternalLink, Info } from "lucide-react";

// B 站内嵌 iframe 清晰度说明：
// 浏览器出于隐私策略对跨域 iframe 默认隔离 Cookie，且 B 站对内嵌播放器
// 有防搬运清晰度上限，二者叠加导致：即便用户在 B 站原站登录成功，回到
// 本页的内嵌播放器仍无法继承登录态、仍停留在标清。这是浏览器与 B 站策略
// 的客观限制，无法在本页内绕过。
// 因此这里不再"引导登录"（误导），改为直接提供「去原站看高清」入口，
// 让用户在 B 站原站（其自身登录态所在环境）获得最高清晰度；本页内嵌
// 仅用于配合台词逐句跟读的"标清跟读模式"。
export default function BilibiliLoginBanner({ videoUrl }) {
  if (!videoUrl) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-mint/15 bg-mint/5 px-4 py-3">
      <Info size={15} className="shrink-0 text-mint/80" />
      <div className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">标清跟读模式　</span>
        B 站内嵌受浏览器跨域隔离与防搬运策略限制，即使登录也停留在标清；
        如需高清画质，请用下方按钮前往 B 站原站观看（你的登录态在原站始终生效）。
      </div>
      <a
        href={videoUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-mint/15 px-3.5 py-1.5 text-xs font-medium text-mint ring-1 ring-mint/40 transition-colors hover:bg-mint/25"
      >
        <ExternalLink size={12} /> 去 B 站看高清
      </a>
    </div>
  );
}