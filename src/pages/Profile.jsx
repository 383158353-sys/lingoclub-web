import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Flame, Bookmark, Brain, ArrowRight, Clock, LogOut, RefreshCw, ShieldCheck, CloudUpload, Loader2 } from "lucide-react";
import { guestVocab } from "@/lib/guestVocab";
import { useAuth } from "@/lib/AuthContext";

export default function Profile() {
  const { user, authStatus, logout, navigateToLogin } = useAuth();
  const [vocab, setVocab] = useState([]);
  const [subs, setSubs] = useState([]);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [pendingGuest, setPendingGuest] = useState(0);

  const handleLogout = async (redirectPath = "/login") => {
    setBusy(true);
    try {
      await logout(true, redirectPath);
    } catch {
      window.location.href = redirectPath;
    } finally {
      setBusy(false);
    }
  };

  // 把游客期本地收藏一次性迁移到云端 Vocabulary，完成后清空本地。
  const migrateGuest = async () => {
    const local = guestVocab.listSync();
    if (local.length === 0) return;
    setMigrating(true);
    try {
      const payloads = local.map(({ id, created_date, ...rest }) => rest);
      await base44.entities.Vocabulary.bulkCreate(payloads);
      guestVocab.clear();
      setPendingGuest(0);
      const v = await base44.entities.Vocabulary.list(null, 200);
      setVocab(v || []);
    } catch (e) {
      // 失败时保留本地数据，等用户重试
    } finally {
      setMigrating(false);
    }
  };

  useEffect(() => {
    if (authStatus === "loading") return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      if (authStatus === "authenticated" && user) {
        try {
          const [v, s, n] = await Promise.all([
            base44.entities.Vocabulary.list(null, 200),
            base44.entities.Subscription.filter({ status: "active" }, "-created_date", 50),
            base44.entities.Note.list("-created_date", 20),
          ]);
          if (!cancelled) {
            setVocab(v || []);
            setSubs(s || []);
            setNotes(n || []);
            setPendingGuest(guestVocab.count());
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      } else {
        // 游客：读本地收藏展示统计
        if (!cancelled) {
          setVocab(guestVocab.listSync());
          setSubs([]);
          setNotes([]);
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [authStatus, user]);

  if (loading) return <div className="pt-28 pb-20 text-center text-muted-foreground">加载个人主页…</div>;

  if (!user) {
    // 游客主页：展示本地收藏，引导登录后同步到云端
    return (
      <div className="mx-auto max-w-3xl px-5 pt-28 pb-20">
        <div className="text-center">
          <p className="text-[11px] uppercase tracking-luxe text-copper/80">游客模式</p>
          <h1 className="mt-2 font-display text-3xl text-foreground md:text-4xl">本地学习记录</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">未登录时收藏的表达保存在本设备。登录后可一键同步到云端，跨设备继续学习。</p>
          <button onClick={() => navigateToLogin("/profile")} className="mt-6 rounded-full bg-copper px-6 py-3 text-sm font-medium text-copper-foreground">登录 / 注册</button>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          <Stat icon={Bookmark} value={vocab.length} label="本地收藏" />
          <Stat icon={Brain} value={vocab.filter((c) => c.mastery_level === "mastered").length} label="已掌握" />
          <Stat icon={Flame} value={streakDays(vocab)} label="学习天数" />
        </div>

        <section className="mt-10">
          <h2 className="font-display text-lg text-foreground">最近收藏</h2>
          {vocab.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
              还没收藏任何表达。去剧集里点句子旁的「收藏」即可。
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {vocab.slice(-6).reverse().map((c) => (
                <li key={c.id} className="rounded-xl border border-border/60 bg-card p-4">
                  <p className="text-sm text-foreground/90">{c.expression_en}</p>
                  {c.meaning_zh && <p className="mt-0.5 text-xs text-muted-foreground">{c.meaning_zh}</p>}
                  {c.source_movie_title && <p className="mt-1 text-[11px] text-muted-foreground/70">— {c.source_movie_title} {c.timestamp && <span className="font-mono text-copper/70">{c.timestamp}</span>}</p>}
                </li>
              ))}
            </ul>
          )}
          <Link to="/collection" className="mt-4 inline-flex items-center gap-1.5 text-sm text-copper hover:underline">
            查看全部与复习 <ArrowRight size={14} />
          </Link>
        </section>
      </div>
    );
  }

  {/* 已登录且本地还有未同步收藏：提示一键迁移到云端 */}
  {pendingGuest > 0 && (
    <div className="mt-10 flex flex-col items-start gap-3 rounded-xl border border-copper/40 bg-copper/8 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-display text-base text-foreground">你有 {pendingGuest} 条本地收藏待同步</p>
        <p className="mt-1 text-xs text-muted-foreground">登录前在本设备收藏的表达还未上传到云端，点击同步以跨设备访问。</p>
      </div>
      <button
        onClick={migrateGuest}
        disabled={migrating}
        className="inline-flex items-center gap-2 rounded-full bg-copper px-5 py-2.5 text-sm font-medium text-copper-foreground transition-transform hover:scale-[1.02] disabled:opacity-60"
      >
        {migrating ? <Loader2 size={14} className="animate-spin" /> : <CloudUpload size={14} />} 同步到云端
      </button>
    </div>
  )}

  const initial = (user.full_name || user.email || "U").trim().slice(0, 1).toUpperCase();
  const mastered = vocab.filter((c) => c.mastery_level === "mastered").length;
  const days = streakDays(vocab);

  return (
    <div className="mx-auto max-w-7xl px-5 lg:px-8 pt-28 pb-20">
      <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
        <Avatar className="h-20 w-20 border-2 border-copper/40">
          <AvatarFallback className="bg-background-elev text-2xl text-copper">{initial}</AvatarFallback>
        </Avatar>
        <div>
          <p className="text-[11px] uppercase tracking-luxe text-copper/80">Member since {new Date(user.created_date || Date.now()).getFullYear()}</p>
          <h1 className="mt-1 font-display text-3xl text-foreground md:text-4xl">{user.full_name || user.email}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{user.email}</p>
        </div>
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-4">
        <Stat icon={Flame} value={days} label="学习天数" />
        <Stat icon={Bookmark} value={vocab.length} label="收藏表达" />
        <Stat icon={Brain} value={mastered} label="已掌握" />
        <Stat icon={Clock} value={subs.length} label="订阅社区" />
      </div>

      <div className="mt-12 grid gap-10 lg:grid-cols-2">
        <section>
          <h2 className="font-display text-lg text-foreground">我的影视社区</h2>
          {subs.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
              还没加入社区。<Link to="/communities" className="text-copper hover:underline">去影苑逛逛 →</Link>
            </div>
          ) : (
            <ul className="mt-4 space-y-3">
              {subs.map((s, i) => (
                <li key={s.id} className="flex items-center justify-between rounded-xl border border-border/60 bg-card p-4">
                  <div>
                    <p className="text-sm text-foreground/90">{s.movie_title}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{s.tier === "free" ? "免费社区" : `${s.tier === "monthly" ? "月订阅" : "年订阅"}`} · {new Date(s.created_date).toLocaleDateString("zh-CN")}</p>
                  </div>
                  {s.movie_id && <Link to={`/movie/${s.movie_id}`} className="inline-flex items-center gap-1 text-xs text-copper hover:underline">进入 <ArrowRight size={12} /></Link>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="font-display text-lg text-foreground">最近收藏</h2>
          {vocab.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">收藏还在路上。</div>
          ) : (
            <ul className="mt-4 space-y-2">
              {vocab.slice(0, 6).map((c) => (
                <li key={c.id} className="rounded-xl border border-border/60 bg-card p-4">
                  <p className="text-sm text-foreground/90">{c.expression_en}</p>
                  {c.meaning_zh && <p className="mt-0.5 text-xs text-muted-foreground">{c.meaning_zh}</p>}
                  {c.source_movie_title && <p className="mt-1 text-[11px] text-muted-foreground/70">— {c.source_movie_title} {c.timestamp && <span className="font-mono text-copper/70">{c.timestamp}</span>}</p>}
                </li>
              ))}
            </ul>
          )}
          <Link to="/collection" className="mt-4 inline-flex items-center gap-1.5 text-sm text-copper hover:underline">
            查看全部收藏与复习 <ArrowRight size={14} />
          </Link>
        </section>
      </div>

      {/* 账号管理 */}
      <section className="mt-12">
        <h2 className="font-display text-lg text-foreground">账号管理</h2>
        <div className="mt-4 rounded-xl border border-border/60 bg-card p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-copper/30 bg-copper/10 text-copper">
                <ShieldCheck size={18} />
              </span>
              <div>
                <p className="text-sm text-foreground/90">{user.email}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {user.role === "admin" ? "管理员账号" : "普通用户"} · 注册于 {new Date(user.created_date || Date.now()).toLocaleDateString("zh-CN")}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => handleLogout("/login")}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm text-foreground transition-colors hover:border-copper/40 hover:text-copper disabled:opacity-60"
              >
                <RefreshCw size={14} /> 切换账号
              </button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    disabled={busy}
                    className="inline-flex items-center gap-2 rounded-full border border-destructive/40 px-5 py-2.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-60"
                  >
                    <LogOut size={14} /> 退出登录
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>确认退出登录？</AlertDialogTitle>
                    <AlertDialogDescription>退出后需要重新登录才能继续学习和收藏。</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleLogout("/login")}>确认退出</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function streakDays(vocab) {
  const days = new Set();
  vocab.forEach((c) => {
    if (c.created_date) days.add((c.created_date).slice(0, 10));
    if (c.last_reviewed_date) days.add(c.last_reviewed_date.slice(0, 10));
  });
  let s = 0; let d = new Date();
  while (days.has(d.toISOString().slice(0, 10))) { s++; d.setDate(d.getDate() - 1); }
  return s;
}

function Stat({ icon: Icon, value, label }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-5">
      <Icon size={16} className="text-copper" />
      <p className="mt-2 font-display text-2xl text-foreground">{value}</p>
      <p className="mt-0.5 text-[11px] uppercase tracking-luxe text-muted-foreground">{label}</p>
    </div>
  );
}
