import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { localMovies } from "@/lib/localStudyMeta";
import { Image } from "@/components/ui/image";
import MovieCard from "@/components/movie/MovieCard";
import {
  Captions,
  ArrowRight, Quote, Users, Clapperboard,
  Sparkles, TrendingUp, Chrome, Zap } from
"lucide-react";
import PwaInstallSection from "@/components/layout/PwaInstallSection";

const FEATURES = [
{ icon: Clapperboard, title: "场景化学习", titleEn: "Scene-based Learning", desc: "从真实电影场景中学地道英语。", descEn: "Learn natural English from real movie scenes." },
{ icon: Users, title: "全球社区", titleEn: "Global Community", desc: "与全球学习者一起练习、分享、成长。", descEn: "Practice, share, and grow with learners worldwide." },
{ icon: Sparkles, title: "AI 驱动工具", titleEn: "AI-Powered Tools", desc: "智能反馈与个性化学习路径。", descEn: "Smart feedback and personalized learning just for you." },
{ icon: TrendingUp, title: "进度追踪", titleEn: "Track Your Progress", desc: "连续打卡、收集徽章、庆祝每一步。", descEn: "Build streaks, earn badges, and celebrate every step." }];


export default function Home() {
  const [movies, setMovies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let active = true;
    const loadMovies = () => localMovies.listMetadata().
      then((items) => {
        if (!active) return;
        setMovies((items || []).slice(0, 12).map((movie) => ({
          ...movie,
          title: movie.name,
          title_en: movie.original_title || movie.name,
          backdrop_url: movie.poster_url,
          tagline: "继续本地影片学习",
          creator_name: "我的影片",
        })));
      }).
      catch(() => { if (active) setMovies([]); }).
      finally(() => { if (active) setLoading(false); });
    void loadMovies();
    window.addEventListener("lingoclub:cloud-state-hydrated", loadMovies);
    return () => {
      active = false;
      window.removeEventListener("lingoclub:cloud-state-hydrated", loadMovies);
    };
  }, []);

  const hero = movies[active];

  // Auto-cycle through public groups' recommendation images
  const next = useCallback(() => {
    setActive((i) => movies.length > 0 ? (i + 1) % movies.length : 0);
  }, [movies.length]);

  useEffect(() => {
    if (movies.length <= 1) return;
    const timer = setInterval(next, 6000);
    return () => clearInterval(timer);
  }, [next, movies.length]);

  return (
    <div className="relative min-w-0 w-full max-w-full overflow-x-clip md:overflow-x-visible">
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0">
          {loading ?
          <div className="h-full w-full animate-pulse bg-background-elev" /> :
          hero ?
          <Image
            key={hero.id}
            src={hero.backdrop_url || hero.poster_url}
            alt={hero.title}
            fittingType="fill"
            loading="eager"
            fetchPriority="high"
            focalPointY={0.4}
            className="h-full w-full animate-ken-burns object-cover" /> :


          <div className="h-full w-full bg-gradient-to-br from-background-soft via-background to-background-elev" />
          }
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-background/30" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-background/60" />
          <div className="grain" />
        </div>

        <div className="relative mx-auto flex min-h-[calc(100svh-4rem)] max-w-7xl flex-col justify-end px-4 pb-10 pt-28 sm:px-5 md:min-h-[92vh] md:pt-32 lg:px-8">
          {hero ?
          <>
              <div className="mb-4 flex flex-wrap items-center gap-2 fade-up md:mb-6 md:gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-mint/50 bg-mint/10 px-3 py-0.5 uppercase tracking-luxe text-mint md:px-3.5 md:py-1 text-[6px] md:text-[6px]">
                  <Captions size={11} /> LINGO CLUB · Learn English Through Film
                </span>
              </div>

              <h1
              key={hero.id}
              className="max-w-3xl font-display text-2xl font-bold leading-[1.15] tracking-tight text-foreground fade-up sm:text-4xl md:text-6xl">
              
                在真实的场景中<br />去学习一门语言
              </h1>

              <p className="mt-1.5 font-display font-semibold tracking-tight text-mint/90 fade-up md:mt-2.5 text-xs md:text-xs">
                Powerful Stories. Stronger English.
              </p>

              <p className="mt-3 max-w-xl leading-relaxed text-muted-foreground fade-up md:mt-4 text-[9px] md:text-[9px]">
                通过经典影视台词，深度解析与互动练习，让你的英语真正"听见"。
                Learn English through iconic movies and TV shows — discover expressions, culture, and ideas that stay with you.
              </p>

              <div className="mt-5 flex items-center gap-2.5 fade-up md:mt-8 md:gap-4">
                <Link
                  to="/local-study"
                  className="flex min-h-11 flex-1 items-center justify-center rounded-full bg-mint px-3 py-2.5 text-sm font-semibold text-background transition-transform hover:scale-[1.03] md:min-h-0 md:flex-none md:px-7 md:py-3.5 md:text-sm"
                >
                  开始学习
                </Link>
                <Link
                  to="/collection"
                  className="flex min-h-11 flex-1 items-center justify-center rounded-full border border-white/20 px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-mint/60 hover:text-mint md:min-h-0 md:flex-none md:px-6 md:py-3.5 md:text-sm"
                >
                  复习单词
                </Link>
              </div>

              <p className="mt-4 flex items-center gap-1.5 text-muted-foreground/80 fade-up md:mt-6 md:gap-2 text-[8px] md:text-[8px]">
                <Users size={13} className="text-mint md:size-3.5" /> 已有 12,345+ 影迷加入学习 · 12K+ learners joined
              </p>

              {/* Active group recommendation info — auto-updates from public groups */}
              {hero &&
            <div className="mt-6 max-w-md rounded-2xl border border-white/10 bg-background/70 p-4 backdrop-blur-md fade-up md:mt-10 md:p-5">
                  <Quote size={18} className="text-mint" />
                  <p className="mt-2 font-display leading-snug text-foreground/95 text-xs">
                    {hero.tagline || hero.title}
                  </p>
                  <p className="mt-2 text-muted-foreground text-[8px]">
                    — {hero.title_en || hero.title} · {hero.creator_name || "Lingo Club"}
                  </p>
                </div>
            }

              {/* Carousel of public groups' recommendation images */}
              <div className="mt-6 -mx-5 md:mt-10 lg:-mx-8">
                <div className="flex items-center gap-3 overflow-x-auto scrollbar-none px-5 pb-3 lg:px-8">
                  {movies.map((m, i) => {
                  const isActive = i === active;
                  const t = m.backdrop_url || m.poster_url;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setActive(i)}
                      className={`group relative h-[84px] w-[148px] shrink-0 overflow-hidden rounded-lg border transition-all ${
                      isActive ? "border-mint/80 ring-2 ring-mint/30 scale-[1.04]" : "border-white/10 opacity-65 hover:opacity-100"}`
                      }
                      title={m.title}>
                      
                        <img src={t} alt={m.title} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                        <div className="absolute inset-0 bg-gradient-to-t from-background/90 to-transparent" />
                        <div className="absolute inset-x-0 bottom-0 px-2 pb-1.5">
                          <p className="truncate text-[11px] font-medium text-foreground/90">{m.title}</p>
                        </div>
                      </button>);

                })}
                </div>
              </div>
            </> :

          <div className="pb-16">
              <div className="mb-4 flex flex-wrap items-center gap-2 fade-up md:mb-6 md:gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-mint/50 bg-mint/10 px-3 py-0.5 text-[10px] uppercase tracking-luxe text-mint md:px-3.5 md:py-1 md:text-[11px]">
                  <Captions size={11} /> LINGO CLUB · Learn English Through Film
                </span>
              </div>
              <h1 className="max-w-3xl font-display text-2xl font-bold leading-[1.15] tracking-tight text-foreground sm:text-4xl md:text-6xl">
                在真实的场景中<br />去学习一门语言
              </h1>
              <p className="mt-1.5 font-display text-sm font-semibold tracking-tight text-mint/90 md:mt-2.5 md:text-xl">
                Powerful Stories. Stronger English.
              </p>
              <p className="mt-3 max-w-xl text-xs leading-relaxed text-muted-foreground md:mt-4 md:text-base">
                通过经典影视台词，深度解析与互动练习，让你的英语真正"听见"。
              </p>
              <div className="mt-5 flex items-center gap-2.5 md:mt-8 md:gap-4">
                <Link
                  to="/local-study"
                  className="flex min-h-11 flex-1 items-center justify-center rounded-full bg-mint px-3 py-2.5 text-sm font-semibold text-background transition-transform hover:scale-[1.03] md:min-h-0 md:flex-none md:px-7 md:py-3.5 md:text-sm"
                >
                  开始学习
                </Link>
                <Link
                  to="/collection"
                  className="flex min-h-11 flex-1 items-center justify-center rounded-full border border-white/20 px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-mint/60 hover:text-mint md:min-h-0 md:flex-none md:px-6 md:py-3.5 md:text-sm"
                >
                  复习单词
                </Link>
              </div>
              <p className="mt-4 text-xs text-muted-foreground md:mt-6 md:text-sm">
                还没有本地影片，导入 YouTube 视频开始学习吧。
              </p>
            </div>
          }
        </div>
      </section>

      {/* EXTENSION BANNER */}
      <section className="border-t border-white/5 bg-background-soft/40">
        <div className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-mint/50 bg-mint/10 px-3.5 py-1 text-[11px] uppercase tracking-luxe text-mint fade-up">
                <Zap size={12} /> 一键导入 · One-Click Import
              </span>
              <h2 className="mt-4 font-display text-2xl font-bold leading-tight text-foreground fade-up md:text-3xl">
                在 YouTube / B站 看视频时<br />一键导入开始学习
              </h2>
              <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted-foreground fade-up md:text-base">
                安装浏览器扩展后，在任意 YouTube 或 B站 视频页面点击「导入学习」按钮，视频和字幕会自动导入到本站，立即开始逐句精读——无需手动复制链接、无需导入台词。
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3 fade-up">
                <Link
                  to="/extension"
                  className="group inline-flex items-center gap-2 rounded-full bg-mint px-6 py-2.5 text-sm font-semibold text-background transition-transform hover:scale-[1.03]">
                  
                  <Chrome size={16} /> 获取一键导入书签
                  <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" />
                </Link>
              </div>

              <div className="mt-8 flex items-center gap-6 text-xs text-muted-foreground/80 fade-up">
                <span className="flex items-center gap-1.5"><span className="text-mint">①</span> 显示书签栏</span>
                <span className="flex items-center gap-1.5"><span className="text-mint">②</span> 拖入按钮</span>
                <span className="flex items-center gap-1.5"><span className="text-mint">③</span> 点击导入学习</span>
              </div>
            </div>

            <div className="relative">
              <div className="rounded-2xl border border-white/10 bg-card p-6 fade-up">
                <div className="flex items-center gap-2 border-b border-white/5 pb-3">
                  <div className="flex gap-1.5">
                    <span className="h-3 w-3 rounded-full bg-red-400/70" />
                    <span className="h-3 w-3 rounded-full bg-yellow-400/70" />
                    <span className="h-3 w-3 rounded-full bg-green-400/70" />
                  </div>
                  <span className="ml-2 text-xs text-muted-foreground">youtube.com/watch</span>
                </div>
                <div className="mt-4 space-y-3">
                  <div className="aspect-video w-full rounded-lg bg-gradient-to-br from-background-elev to-background-soft" />
                  <div className="flex items-center justify-between">
                    <div className="h-3 w-2/3 rounded bg-background-elev" />
                    <div className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-mint to-copper px-3 py-1.5 text-xs font-bold text-background">
                      <Zap size={12} /> 导入学习
                    </div>
                  </div>
                  <div className="space-y-1.5 pt-1">
                    {["00:12  You're going to give me a call.", "00:15  Welcome back to the channel.", "00:18  Today we're going to talk about..."].map((line, i) =>
                    <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono text-mint/70">{line.split("  ")[0]}</span>
                      <span>{line.split("  ")[1]}</span>
                    </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="absolute -bottom-3 -right-3 flex items-center gap-2 rounded-full bg-mint px-4 py-2 text-xs font-bold text-background shadow-lg shadow-mint/30">
                <ArrowRight size={14} /> 自动提取字幕
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="border-t border-white/5 bg-background-soft/40">
        <div className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
          <div className="text-center">
            <p className="mb-3 text-[10px] uppercase tracking-luxe text-mint">A Community That Moves You Forward</p>
            <h2 className="font-display text-xl font-bold leading-tight text-foreground md:text-3xl">
              一个让你不断前行的社区
            </h2>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) =>
            <Feature key={f.title} {...f} />
            )}
          </div>
        </div>
      </section>

      {/* EXPLORE & LEARN carousel */}
      <section className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
        <div className="flex items-end justify-between">
          <SectionHead kicker="Explore & Learn" title="Learn from the best stories" />
          <Link to="/local-study" className="hidden shrink-0 items-center gap-1.5 text-sm font-medium text-mint hover:underline sm:inline-flex">
            查看全部 · View All <ArrowRight size={15} />
          </Link>
        </div>
        {loading ?
        <div className="mt-8 flex gap-4 overflow-hidden">
            {Array.from({ length: 6 }).map((_, i) =>
          <div key={i} className="aspect-[2/3] w-[44%] shrink-0 animate-pulse rounded-xl bg-background-elev sm:w-[30%] lg:w-[15%]" />
          )}
          </div> :
        movies.length > 0 ?
        <div className="mt-8 flex gap-4 overflow-x-auto scrollbar-none pb-3">
            {movies.map((m, i) =>
          <div key={m.id} className="w-[44%] shrink-0 sm:w-[30%] lg:w-[15%]">
                <MovieCard movie={m} index={i} to="/local-study" />
              </div>
          )}
          </div> :

        <div className="mt-8 rounded-xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">
            还没有本地影片，去导入一个 YouTube 视频吧。
          </div>
        }
      </section>

      {/* SAMPLE QUOTE */}
      <section className="mx-auto max-w-4xl px-5 py-16 lg:px-8">
        <div className="rounded-2xl border border-mint/25 bg-card p-8 lg:p-12">
          <Quote size={26} className="text-mint" />
          <p className="mt-4 font-display text-xl leading-relaxed text-foreground/95 md:text-2xl">
            "What's up?" 不是问<span className="text-mint">"发生了什么"</span>，而是美国日常一句轻松的问候。
          </p>
          <p className="mt-3 text-sm text-muted-foreground">— 在《老友记》里理解它的语气，胜过任何一本教材。</p>
          <Link to="/local-study" className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-mint hover:underline">
            进入《老友记》小组 <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      {/* COMMUNITY CTA */}
      <section className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-6 rounded-2xl border border-white/10 bg-card p-8 md:flex-row md:p-12">
          <div className="flex items-start gap-4">
            <div className="flex -space-x-3">
              {["A", "B", "C", "D"].map((l, i) =>
              <span key={i} className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-background bg-background-elev text-xs font-semibold text-mint">{l}</span>
              )}
            </div>
            <div>
              <h3 className="font-display text-xl font-bold text-foreground md:text-2xl">加入影迷社区 · Join the Community</h3>
              <p className="mt-1 text-sm text-muted-foreground">与全球学习者一起讨论、分享、成长 · 12K+ 成员</p>
            </div>
          </div>
          <Link to="/local-study" className="group inline-flex items-center gap-2 rounded-full bg-mint px-7 py-3.5 text-sm font-semibold text-background transition-transform hover:scale-[1.03]">
            进入社区 <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </section>

      {/* PWA 安装教程 */}
      <PwaInstallSection />
    </div>);

}

function SectionHead({ kicker, title }) {
  return (
    <div className="max-w-2xl">
      <p className="mb-3 text-[10px] uppercase tracking-luxe text-mint">{kicker}</p>
      <h2 className="font-display text-xl font-bold leading-tight text-foreground md:text-3xl">{title}</h2>
    </div>);

}

function Feature({ icon: Icon, title, titleEn, desc, descEn }) {
  return (
    <div className="group rounded-xl border border-white/10 bg-card p-6 transition-colors hover:border-mint/40">
      <div className="flex h-11 w-11 items-center justify-center rounded-full border border-mint/40 bg-mint/10 text-mint">
        <Icon size={20} />
      </div>
      <h3 className="mt-5 font-display text-base font-semibold text-foreground md:text-lg">{title}</h3>
      <p className="text-[11px] uppercase tracking-wide text-mint/70">{titleEn}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{desc}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground/70">{descEn}</p>
    </div>);

}
