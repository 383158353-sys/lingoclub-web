import React from "react";
import { Link } from "react-router-dom";

const COLS = [
  { title: "学习", items: [["首页", "/"], ["我的影片", "/local-study"], ["我的收藏", "/collection"]] },
  { title: "导入", items: [["YouTube 学习", "/local-study"], ["本地视频", "/local-study"]] },
  { title: "复习", items: [["单词复习", "/collection"], ["句子复习", "/collection"]] },
  { title: "账号", items: [["可选登录", "/login"]] },
];

export default function SiteFooter() {
  return (
    <footer className="relative border-t border-white/10 bg-background-soft/40">
      <div className="mx-auto max-w-7xl px-5 lg:px-8 py-10">
        <div className="grid gap-6 md:grid-cols-[1.5fr_1fr_1fr_1fr_1fr]">
          <div>
            <span className="font-display text-base font-bold tracking-tight text-foreground">Lingo Club</span>
            <p className="mt-3 max-w-xs text-xs leading-relaxed text-muted-foreground">
              把电影与美剧，变成你的英语课堂。在喜欢的故事里学会一门语言。
            </p>
            <div className="mt-4 flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="cursor-pointer transition-colors hover:text-mint">bilibili</span>
              <span className="cursor-pointer transition-colors hover:text-mint">Instagram</span>
              <span className="cursor-pointer transition-colors hover:text-mint">YouTube</span>
            </div>
          </div>
          {COLS.map((c) => (
            <div key={c.title}>
              <h4 className="text-[11px] font-semibold uppercase tracking-luxe text-foreground/70">{c.title}</h4>
              <ul className="mt-3 space-y-1.5">
                {c.items.map(([label, to]) => (
                  <li key={to}>
                    <Link to={to} className="text-xs text-muted-foreground transition-colors hover:text-mint">{label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-8 flex flex-col items-start justify-between gap-3 border-t border-white/10 pt-5 text-[11px] text-muted-foreground sm:flex-row sm:items-center">
          <span>© {new Date().getFullYear()} Lingo Club. All rights reserved.</span>
          <div className="flex items-center gap-4">
            <a href="#" className="transition-colors hover:text-mint">隐私政策</a>
            <a href="#" className="transition-colors hover:text-mint">用户协议</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
