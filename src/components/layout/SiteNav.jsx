import React, { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { Search, UserRound, LogOut, ChevronDown, Settings, KeyRound, Cloud, RefreshCw } from "lucide-react";
import { AISettingsButton } from "@/components/AISettingsPanel";

const links = [
  { label: "首页", to: "/" },
  { label: "我的影片", to: "/local-study" },
  { label: "语料库", to: "/collection" },
];

export default function SiteNav() {
  const [accountOpen, setAccountOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const accountRef = useRef(null);
  const { user, logout, cloudSyncStatus } = useAuth();
  const navigate = useNavigate();
  const cloudState = cloudSyncStatus?.status || "offline";

  const switchAccount = async () => {
    setAccountOpen(false);
    await logout();
    navigate("/login");
  };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 28);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onPointerDown = (event) => {
      if (!accountRef.current?.contains(event.target)) setAccountOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setAccountOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <header className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${scrolled ? "glass border-b border-white/10" : "bg-transparent"}`} style={{ paddingTop: "env(safe-area-inset-top)" }}>
      {!scrolled && <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-background/85 via-background/45 to-transparent" />}
      <div className="relative mx-auto max-w-7xl px-4 lg:px-8">
        <div className="flex h-16 items-center justify-between md:h-16">
          <Link to="/" className="flex min-w-0 items-center order-1">
            <span className="font-display text-base font-bold tracking-tight leading-none text-foreground md:text-lg">
              Lingo<span className="text-mint"> Club</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-7 md:flex order-2">
            {links.map((l) => (
              <Link key={l.to} to={l.to} className="text-[13px] font-medium tracking-wide text-muted-foreground transition-colors hover:text-foreground">
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-3 md:flex order-3">
            <button className="text-muted-foreground transition-colors hover:text-mint" aria-label="搜索">
              <Search size={18} />
            </button>
          </div>

          <div className="relative order-3" ref={accountRef}>
            <button
              type="button"
              aria-label="账户菜单"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen((open) => !open)}
              className="inline-flex h-9 max-w-44 items-center gap-1.5 rounded-full border border-white/10 bg-background/55 px-2.5 text-xs text-foreground/80 backdrop-blur transition-colors hover:border-mint/40 hover:text-foreground"
            >
              {user?.picture ? <img src={user.picture} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" /> : <UserRound size={15} className="shrink-0 text-mint" />}
              <span className="max-w-28 truncate">{user?.email || "账户"}</span>
              <ChevronDown size={13} className={`shrink-0 transition-transform ${accountOpen ? "rotate-180" : ""}`} />
            </button>
            {accountOpen && (
              <div className="absolute right-0 top-11 z-[70] w-64 max-w-[calc(100vw-1.5rem)] rounded-xl border border-white/10 bg-background-soft/95 p-2 shadow-xl shadow-black/35 backdrop-blur-xl">
                {user ? (
                  <>
                    <div className="flex min-w-0 items-center gap-2.5 px-3 py-2">
                      {user?.picture ? <img src={user.picture} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" /> : <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-mint/10 text-mint"><UserRound size={17} /></span>}
                      <div className="min-w-0"><p className="truncate text-sm font-medium text-foreground">{user?.full_name || user?.name || "访客"}</p><p className="truncate text-xs text-muted-foreground">{user?.email || "未登录"}</p></div>
                    </div>
                    <div className="my-1 border-t border-white/10" />
                    <AccountLink to="/profile" onClick={() => setAccountOpen(false)} icon={Settings}>设置</AccountLink>
                    <AISettingsButton className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-foreground/85 transition-colors hover:bg-white/5" onClick={() => setAccountOpen(false)}><KeyRound size={15} />API 服务</AISettingsButton>
                    <div className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm text-foreground/80" aria-live="polite">
                      <Cloud size={15} /> 学习数据同步 <span className="ml-auto text-xs text-muted-foreground">{cloudState === "synced" ? "已同步" : cloudState === "syncing" ? "同步中" : cloudState === "error" ? "稍后重试" : "离线"}</span>
                    </div>
                    <div className="my-1 border-t border-white/10" />
                    <button type="button" onClick={user ? switchAccount : () => { setAccountOpen(false); navigate("/login"); }} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-foreground/85 transition-colors hover:bg-white/5"><RefreshCw size={15} />切换账号</button>
                    {user ? <button type="button" onClick={() => { setAccountOpen(false); logout(); }} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-foreground/85 transition-colors hover:bg-white/5"><LogOut size={15} />退出登录</button> : <AccountLink to="/login" onClick={() => setAccountOpen(false)} icon={LogOut}>邮箱登录</AccountLink>}
                  </>
                ) : (
                  <Link to="/login" onClick={() => setAccountOpen(false)} className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm text-foreground/85 transition-colors hover:bg-white/5">
                    <UserRound size={15} /> 邮箱登录
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function AccountLink({ to, onClick, icon: Icon, children }) {
  return <Link to={to} onClick={onClick} className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm text-foreground/85 transition-colors hover:bg-white/5"><Icon size={15} />{children}</Link>;
}
