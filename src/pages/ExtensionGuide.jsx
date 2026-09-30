import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Smartphone, Monitor } from "lucide-react";
import { MobileTutorial, DesktopTutorial } from "@/components/study/YoutubeImportGuide";

export default function ExtensionGuide() {
  // 自动检测设备，默认选中对应 tab
  const [tab, setTab] = useState(() => {
    if (typeof window === "undefined") return "mobile";
    const ua = navigator.userAgent || "";
    if (/iPhone|iPad|iPod|Android|Mobile/i.test(ua)) return "mobile";
    return "desktop";
  });

  return (
    <div className="mx-auto w-full max-w-2xl px-5 lg:px-10 pt-28 pb-20">
      <p className="text-[11px] uppercase tracking-luxe text-copper/80">工具箱 · 导入教程</p>
      <h1 className="mt-2 font-display text-3xl leading-tight text-foreground md:text-4xl">导入视频开始学习</h1>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
        选择你的设备类型，查看对应的导入方式。移动端安装 App 后直接粘贴链接即可，电脑端用书签一键导入。
      </p>

      {/* Tab 切换 */}
      <div className="mt-8 flex gap-2 rounded-full border border-border bg-background-elev/40 p-1">
        <button
          type="button"
          onClick={() => setTab("mobile")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition-colors ${
            tab === "mobile" ? "bg-mint text-background" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Smartphone size={15} /> 移动端（手机 / 平板）
        </button>
        <button
          type="button"
          onClick={() => setTab("desktop")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition-colors ${
            tab === "desktop" ? "bg-mint text-background" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Monitor size={15} /> 电脑端
        </button>
      </div>

      {/* ===== 移动端教程 ===== */}
      {tab === "mobile" && (
        <div className="mt-8">
          <MobileTutorial />
        </div>
      )}

      {/* ===== 电脑端教程 ===== */}
      {tab === "desktop" && (
        <div className="mt-8">
          <DesktopTutorial />
        </div>
      )}

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