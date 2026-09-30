import React, { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { BookOpen, Captions, Clapperboard, Plus, Youtube } from "lucide-react";

const importLinks = [
  { label: "YouTube 视频", icon: Youtube, to: "/local-study?import=youtube" },
  { label: "本地视频", icon: Clapperboard, to: "/local-study?import=local" },
];

export default function MobileBottomNav({ hidden = false }) {
  const [importOpen, setImportOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setImportOpen(false), [location.pathname, location.search]);

  if (hidden) return null;

  const learnActive = location.pathname === "/" || location.pathname === "/local-study" || location.pathname === "/quick-study";
  const collectionActive = location.pathname === "/collection";

  return (
    <>
      {importOpen && (
        <button
          type="button"
          aria-label="关闭导入菜单"
          onClick={() => setImportOpen(false)}
          className="fixed inset-0 z-[58] bg-black/35 md:hidden"
        />
      )}
      <nav
        aria-label="主要导航"
        className="fixed inset-x-0 bottom-0 z-[60] border-t border-white/10 bg-background/90 px-3 pt-2 backdrop-blur-2xl md:hidden"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 8px)" }}
      >
        {importOpen && (
          <div className="absolute bottom-[calc(100%_+_12px)] left-1/2 z-[61] w-[min(22rem,calc(100vw_-_2rem))] -translate-x-1/2 rounded-2xl border border-white/10 bg-background-soft/95 p-2 shadow-2xl shadow-black/45 backdrop-blur-2xl">
            <p className="px-3 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">选择导入方式</p>
            {importLinks.map(({ label, icon: Icon, to }) => (
              <Link
                key={to}
                to={to}
                onClick={() => setImportOpen(false)}
                className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium text-foreground/90 transition-colors hover:bg-white/5 active:bg-white/10"
              >
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-mint/10 text-mint"><Icon size={16} /></span>
                {label}
              </Link>
            ))}
          </div>
        )}

        <div className="mx-auto grid h-[3.75rem] max-w-lg grid-cols-3 items-center">
          <NavLink
            to="/local-study"
            aria-label="学习"
            className={`flex h-full flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors ${learnActive ? "text-mint" : "text-muted-foreground"}`}
          >
            <BookOpen size={19} strokeWidth={1.8} />
            <span>学习</span>
          </NavLink>

          <button
            type="button"
            aria-label="导入视频"
            aria-expanded={importOpen}
            onClick={() => setImportOpen((open) => !open)}
            className={`mx-auto flex h-full flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${importOpen ? "text-mint" : "text-foreground/85"}`}
          >
            <span className="-mt-4 grid h-12 w-12 place-items-center rounded-[1.1rem] border border-mint/45 bg-mint text-background shadow-lg shadow-mint/20 transition-transform active:translate-y-0.5">
              {importOpen ? <Plus size={23} className="rotate-45" /> : <Plus size={24} />}
            </span>
            <span className="-mt-0.5">导入视频</span>
          </button>

          <NavLink
            to="/collection"
            aria-label="语料库"
            className={`flex h-full flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors ${collectionActive ? "text-mint" : "text-muted-foreground"}`}
          >
            <Captions size={19} strokeWidth={1.8} />
            <span>语料库</span>
          </NavLink>
        </div>
      </nav>
    </>
  );
}
