import React, { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import SiteNav from "./SiteNav";
import SiteFooter from "./SiteFooter";
import PwaInstallHint from "./PwaInstallHint";
import MobileBottomNav from "./MobileBottomNav";

const immersiveRoute = (pathname) =>
  pathname === "/quick-study" ||
  pathname === "/subtitle-segmentation" ||
  /^\/(episode|scene|movie)\//.test(pathname);

export default function SiteLayout() {
  const { pathname } = useLocation();
  const [immersiveContent, setImmersiveContent] = useState(false);
  const immersive = immersiveRoute(pathname) || immersiveContent;

  useEffect(() => {
    setImmersiveContent(false);
    if (pathname !== "/local-study" && pathname !== "/collection") return undefined;
    const main = document.querySelector("[data-app-main]");
    if (!main) return undefined;
    const update = () => {
      if (pathname === "/local-study") {
        const hasPlayer = Boolean(main.querySelector("video, iframe"));
        const hasStudyBackButton = [...main.querySelectorAll("button")]
          .some((button) => button.textContent.trim() === "返回我的影片");
        setImmersiveContent(hasPlayer || hasStudyBackButton);
        return;
      }
      setImmersiveContent(main.textContent.includes("当前单词 ·"));
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(main, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname]);

  return (
    <div className="flex min-h-[100dvh] w-full min-w-0 flex-col overflow-x-clip md:overflow-x-visible">
      <div className={immersive ? "hidden md:block" : ""}>
        <SiteNav />
      </div>
      <main data-app-main className={`w-full min-w-0 max-w-full flex-1 ${immersive ? "pb-0" : "pb-[calc(5.75rem+env(safe-area-inset-bottom))] md:pb-0"}`}>
        <Outlet />
      </main>
      <SiteFooter />
      <PwaInstallHint />
      <MobileBottomNav hidden={immersive} />
    </div>
  );
}
