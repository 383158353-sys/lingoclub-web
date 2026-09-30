import React, { useState, useEffect } from "react";
import { Smartphone, Share, Plus, Monitor, Download } from "lucide-react";

// 首页底部的「安装到主屏幕」教程区块。
// 自动检测设备类型，显示对应的安装步骤。
export default function PwaInstallSection() {
  const [platform, setPlatform] = useState("desktop");

  useEffect(() => {
    const ua = navigator.userAgent || "";
    const ios = /iPhone|iPad|iPod/i.test(ua);
    const android = /Android/i.test(ua);
    if (ios) setPlatform("ios");
    else if (android) setPlatform("android");
    else setPlatform("desktop");
  }, []);

  const steps = {
    ios: [
      { icon: Share, title: "点击底部「分享」", desc: "在 Safari 中打开本站，点击底部工具栏的分享按钮。" },
      { icon: Plus, title: "选择「添加到主屏幕」", desc: "在弹出的菜单中找到并点击「添加到主屏幕」。" },
      { icon: Smartphone, title: "像 App 一样使用", desc: "主屏幕出现 LingoClub 图标，点击即可全屏沉浸学习。" },
    ],
    android: [
      { icon: Monitor, title: "点击浏览器菜单", desc: "在 Chrome 中打开本站，点击右上角三点菜单。" },
      { icon: Download, title: "选择「安装应用」", desc: "在菜单中找到「安装应用」或「添加到主屏幕」。" },
      { icon: Smartphone, title: "像 App 一样使用", desc: "桌面出现 LingoClub 图标，点击即可全屏沉浸学习。" },
    ],
    desktop: [
      { icon: Monitor, title: "点击地址栏右侧安装图标", desc: "在 Chrome / Edge 中打开本站，地址栏右侧出现安装图标。" },
      { icon: Download, title: "点击「安装」", desc: "点击安装图标，在弹窗中确认安装。" },
      { icon: Smartphone, title: "桌面快捷方式", desc: "桌面出现 LingoClub 快捷方式，点击即可独立窗口打开。" },
    ],
  };

  const currentSteps = steps[platform];
  const platformLabel = platform === "ios" ? "iPhone / iPad" : platform === "android" ? "Android" : "电脑端";

  return (
    <section className="mx-auto max-w-7xl px-5 py-16 lg:px-8">
      <div className="overflow-hidden rounded-2xl border border-mint/25 bg-gradient-to-br from-card to-background-elev/50">
        <div className="grid items-center gap-8 p-8 md:p-12 lg:grid-cols-2">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-mint/50 bg-mint/10 px-3.5 py-1 text-[11px] uppercase tracking-luxe text-mint">
              <Smartphone size={12} /> 安装到主屏幕 · Install App
            </span>
            <h2 className="mt-4 font-display text-2xl font-bold leading-tight text-foreground md:text-3xl">
              把 LingoClub 装到手机<br />像原生 App 一样全屏学习
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground md:text-base">
              无需下载、无需应用商店。安装后全屏沉浸播放、像 App 一样独立运行，还能离线打开已缓存的学习内容。
            </p>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-mint/80">
              <Smartphone size={13} /> 当前设备：{platformLabel}
            </p>
          </div>

          <div className="space-y-4">
            {currentSteps.map((s, i) => (
              <div key={i} className="flex items-start gap-3.5 rounded-xl border border-white/8 bg-background-elev/40 p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-mint text-background">
                  <s.icon size={17} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-mint">{i + 1}</span>
                    <h3 className="font-display text-sm font-semibold text-foreground">{s.title}</h3>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}