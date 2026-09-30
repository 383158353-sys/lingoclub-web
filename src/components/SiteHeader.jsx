import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X, Compass, BookMarked, RotateCw, PenLine, User, Search } from 'lucide-react';
import HeritageMark from './HeritageMark';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';

const NAV = [
  { to: '/browse', label: '影视社区', icon: Compass },
  { to: '/collection', label: '我的收藏', icon: BookMarked },
  { to: '/review', label: '复习', icon: RotateCw },
  { to: '/creator', label: '创作者', icon: PenLine },
];

export default function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState(null);
  const loc = useLocation();

  useEffect(() => { setOpen(false); }, [loc.pathname]);

  useEffect(() => {
    let mounted = true;
    base44.auth.me().then(u => mounted && setUser(u)).catch(() => {});
    return () => { mounted = false; };
  }, [loc.pathname]);

  return (
    <header className="sticky top-0 z-50 glass-panel border-b border-border/60">
      <div className="mx-auto max-w-7xl px-5 sm:px-8 h-16 flex items-center gap-6">
        <HeritageMark />
        <nav className="hidden md:flex items-center gap-1 ml-6">
          {NAV.map(item => {
            const active = loc.pathname === item.to ||
              (item.to !== '/' && loc.pathname.startsWith(item.to));
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`relative px-3.5 py-2 text-sm tracking-wide rounded-md transition-colors
                  ${active ? 'text-primary' : 'text-foreground/70 hover:text-foreground'}`}
              >
                <span className="flex items-center gap-1.5">
                  <item.icon size={15} className="opacity-70" />
                  {item.label}
                </span>
                {active && <span className="absolute left-3 right-3 -bottom-px h-px copper-rule" />}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <Link to="/browse" className="hidden sm:flex items-center gap-2 text-sm text-foreground/55 hover:text-foreground px-3">
            <Search size={15} /> 搜索
          </Link>
          {user ? (
            <Link to="/profile">
              <div className="w-9 h-9 rounded-full bg-secondary border border-border overflow-hidden grid place-items-center text-primary font-display text-sm">
                {user.full_name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || '·'}
              </div>
            </Link>
          ) : (
            <Link to="/profile">
              <Button variant="outline" size="sm" className="border-primary/40 text-primary hover:bg-primary/10">
                <User size={14} className="mr-1.5" /> 进入
              </Button>
            </Link>
          )}
          <button
            className="md:hidden p-2 text-foreground/70 hover:text-foreground"
            onClick={() => setOpen(o => !o)}
            aria-label="menu"
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="md:hidden border-t border-border/60 bg-background/95 px-6 py-4">
          {NAV.map(item => (
            <Link key={item.to} to={item.to}
              className="flex items-center gap-3 py-3 text-foreground/80 hover:text-primary">
              <item.icon size={16} /> {item.label}
            </Link>
          ))}
        </div>
      )}
    </header>
  );
}