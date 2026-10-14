import React from "react";
import { Link } from "react-router-dom";
import { MobileTutorial, DesktopTutorial } from "@/components/study/YoutubeImportGuide";

export default function ExtensionGuide() {
  return (
    <div className="mx-auto w-full max-w-2xl px-5 pt-6 pb-20 md:pt-28 lg:px-10">
      <p className="text-[11px] uppercase tracking-luxe text-copper/80">工具箱 · 导入教程</p>
      <h1 className="mt-2 font-display text-3xl leading-tight text-foreground md:text-4xl">导入视频开始学习</h1>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
        打开导入页粘贴 YouTube 链接即可开始。下面是当前设备的操作教程。
      </p>
      <Link to="/local-study?import=youtube" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-copper px-5 text-sm font-medium text-copper-foreground">粘贴链接导入</Link>
      <div className="mt-8 md:hidden"><MobileTutorial /></div>
      <div className="mt-8 hidden md:block"><DesktopTutorial /></div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link to="/local-study" className="inline-flex items-center gap-2 rounded-full bg-copper px-5 py-2.5 text-sm font-medium text-copper-foreground transition-transform hover:scale-[1.02]">
          前往我的影片
        </Link>
        <Link to="/" className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-copper/50">
          返回首页
        </Link>
      </div>
    </div>
  );
}
