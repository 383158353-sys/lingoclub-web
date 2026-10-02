import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Cloud, Loader2, LogOut, RefreshCw, Save, UserRound } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { vocabRepository } from "@/lib/vocabRepository";
import AISettingsPanel from "@/components/AISettingsPanel";

const syncLabel = { synced: "已同步", syncing: "同步中", offline: "离线", error: "同步失败" };

export default function Profile() {
  const { user, isLoadingAuth, cloudSyncStatus, updateDisplayName, logout } = useAuth();
  const [name, setName] = useState(user?.full_name || "");
  const [savedName, setSavedName] = useState("");
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const navigate = useNavigate();

  useEffect(() => { setName(user?.full_name || ""); setSavedName(user?.full_name || ""); }, [user?.id, user?.full_name]);
  useEffect(() => { let alive = true; vocabRepository.list().then((items) => { if (alive) setCount(items.length); }).catch(() => {}); return () => { alive = false; }; }, [user?.id]);

  const saveName = async (event) => {
    event.preventDefault(); setBusy(true); setMessage("");
    try { const updated = await updateDisplayName(name); setName(updated.full_name); setSavedName(updated.full_name); setMessage("显示名称已更新"); }
    catch (error) { setMessage(error?.message || "保存失败"); }
    finally { setBusy(false); }
  };
  const switchAccount = async () => { await logout(); navigate("/login"); };
  const syncNow = () => window.dispatchEvent(new CustomEvent("lingoclub:local-state-changed"));

  if (isLoadingAuth) return <div className="mx-auto max-w-3xl px-5 pt-28 text-center text-muted-foreground">正在加载账号…</div>;
  if (!user) return <div className="mx-auto max-w-3xl px-5 pt-28 pb-20"><h1 className="font-display text-3xl">账户设置</h1><p className="mt-3 text-sm text-muted-foreground">登录后可管理显示名称、AI 服务和学习数据同步。</p><button onClick={() => navigate("/login?returnTo=%2Fprofile")} className="mt-5 rounded-full bg-mint px-5 py-2.5 text-sm font-medium text-background">登录 / 注册</button></div>;

  const initial = (user.full_name || user.email || "U").trim().slice(0, 1).toUpperCase();
  const lastSyncedAt = cloudSyncStatus?.lastSyncedAt ? new Date(cloudSyncStatus.lastSyncedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "尚无记录";
  return <main className="mx-auto max-w-3xl px-4 pt-24 pb-24 sm:px-6 md:pt-28">
    <h1 className="font-display text-2xl text-foreground sm:text-3xl">账户设置</h1>
    <section className="mt-6 flex items-center gap-4 rounded-xl border border-border/70 bg-card p-4">
      {user.picture ? <img src={user.picture} alt="" className="h-14 w-14 rounded-full object-cover" /> : <span className="grid h-14 w-14 place-items-center rounded-full bg-mint/10 text-lg text-mint">{initial}</span>}
      <div className="min-w-0"><p className="truncate font-medium">{user.full_name || user.email}</p><p className="truncate text-sm text-muted-foreground">{user.email}</p></div>
    </section>
    <form onSubmit={saveName} className="mt-4 rounded-xl border border-border/70 bg-card p-4">
      <label className="block space-y-2 text-sm"><span className="font-medium">显示名称</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} className="w-full rounded-lg border border-border bg-background px-3 py-2.5" /></label>
      <button disabled={busy || !name.trim() || name.trim() === savedName} className="mt-3 inline-flex items-center gap-2 rounded-full bg-mint px-4 py-2 text-sm font-medium text-background disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}保存名称</button>
      {message && <span role="status" className="ml-3 text-xs text-muted-foreground">{message}</span>}
    </form>
    <div className="mt-4"><AISettingsPanel /></div>
    <section className="mt-4 rounded-xl border border-border/70 bg-card p-4">
      <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Cloud size={17} className="text-mint" /><h2 className="font-medium">学习数据同步</h2></div><span className="rounded-full bg-background-elev px-2.5 py-1 text-xs">{syncLabel[cloudSyncStatus?.status] || "离线"}</span></div>
      <p className="mt-2 text-sm text-muted-foreground">上次同步 {lastSyncedAt}{cloudSyncStatus?.lastError ? ` · ${cloudSyncStatus.lastError}` : ""}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">同步词库、复习进度、影片资料、字幕与设置。本地视频不会上传。</p>
      <p className="mt-1 text-xs text-muted-foreground">词库共 {count} 条</p>
      <button type="button" onClick={syncNow} className="mt-3 inline-flex items-center gap-2 rounded-full border border-border px-3 py-2 text-sm"><RefreshCw size={14} />立即同步</button>
    </section>
    <section className="mt-4 flex flex-wrap gap-2 rounded-xl border border-border/70 bg-card p-4">
      <button type="button" onClick={switchAccount} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm"><UserRound size={14} />切换账号</button>
      <button type="button" onClick={() => logout(true, "/login")} className="inline-flex items-center gap-2 rounded-full border border-destructive/40 px-4 py-2 text-sm text-destructive"><LogOut size={14} />退出登录</button>
    </section>
  </main>;
}
