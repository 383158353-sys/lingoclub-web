import { Outlet } from 'react-router-dom';
import SiteHeader from './SiteHeader';

export default function Layout() {
  return (
    <div className="min-h-screen bg-background text-foreground cine-grain">
      <SiteHeader />
      <main className="min-h-[calc(100vh-4rem)]">
        <Outlet />
      </main>
      <footer className="border-t border-border/40 mt-16">
        <div className="mx-auto max-w-7xl px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-foreground/40 text-sm">
          <p className="font-display tracking-[0.18em]">CINE<span className="text-primary">FLUENCY</span></p>
          <p className="text-xs">在你喜欢的故事里，学会一门语言 · MVP</p>
        </div>
      </footer>
    </div>
  );
}