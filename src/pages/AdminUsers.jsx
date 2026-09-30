import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import { ChevronLeft, Search, Loader2, Save, Crown, X, Plus, Wallet, Trash2 } from "lucide-react";

// 管理员后台：手动为用户开通积分或高级会员。
// 仅 admin 可见；用 base44 内建的「管理员可改其他用户」权限，无需新后端函数。
const pad = (n) => String(n).padStart(2, "0");
const toLocalInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const PAST = new Date(2000, 0, 1).toISOString(); // 用过去时间表示「已清空会员」

export default function AdminUsers() {
  const { toast } = useToast();
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState(null); // { user, credits, premiumLocal }
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const m = await base44.auth.me().catch(() => null);
        setMe(m);
        if (m?.role === "admin") {
          const list = await base44.entities.User.list("-created_date", 100);
          setUsers(list || []);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="pt-28 pb-20 text-center text-muted-foreground">加载用户…</div>;
  if (!me || me.role !== "admin") return <div className="pt-28 pb-20 text-center text-muted-foreground">无权限访问。</div>;

  const filtered = users.filter((u) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (u.email || "").toLowerCase().includes(s) || (u.full_name || "").toLowerCase().includes(s);
  });

  const openEdit = (u) => {
    const exp = u.premium_expires_at ? new Date(u.premium_expires_at) : null;
    const valid = exp && exp.getTime() > Date.now();
    setEdit({
      user: u,
      credits: String(Number(u.credits ?? 0)),
      premiumLocal: valid ? toLocalInput(exp) : "",
    });
  };

  const addCredits = (n) => setEdit((s) => ({ ...s, credits: String((Number(s.credits) || 0) + n) }));

  const grantMonth = () => {
    const base = edit.user.premium_expires_at && new Date(edit.user.premium_expires_at) > new Date()
      ? new Date(edit.user.premium_expires_at)
      : new Date();
    base.setDate(base.getDate() + 31);
    setEdit((s) => ({ ...s, premiumLocal: toLocalInput(base) }));
  };

  const clearPremium = () => setEdit((s) => ({ ...s, premiumLocal: "" }));

  const save = async () => {
    setSaving(true);
    try {
      const patch = { credits: Number(edit.credits) || 0 };
      patch.premium_expires_at = edit.premiumLocal ? new Date(edit.premiumLocal).toISOString() : PAST;
      const updated = await base44.entities.User.update(edit.user.id, patch);
      setUsers((list) => list.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)));
      toast({ title: "已更新用户权益" });
      setEdit(null);
    } catch (e) {
      toast({ title: "更新失败", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-5 lg:px-8 pt-28 pb-20">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-copper">
        <ChevronLeft size={15} /> 返回首页
      </Link>

      <header className="mt-6">
        <p className="text-[11px] uppercase tracking-luxe text-copper/80">管理后台</p>
        <h1 className="mt-1 font-display text-3xl text-foreground">用户权益管理</h1>
        <p className="mt-2 text-sm text-muted-foreground">手动为用户开通积分或高级会员。共 {users.length} 位用户。</p>
      </header>

      <div className="mt-6 flex items-center gap-2 rounded-xl border border-border/60 bg-card px-3 py-2">
        <Search size={16} className="text-muted-foreground" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索邮箱或昵称" className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none" />
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-border/60">
        <table className="w-full text-sm">
          <thead className="bg-background-elev/60 text-left text-[11px] uppercase tracking-luxe text-muted-foreground">
            <tr>
              <th className="px-4 py-3">用户</th>
              <th className="px-4 py-3">积分</th>
              <th className="px-4 py-3">会员到期</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {filtered.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">无匹配用户</td></tr>
            )}
            {filtered.map((u) => {
              const exp = u.premium_expires_at ? new Date(u.premium_expires_at) : null;
              const isPrem = exp && exp.getTime() > Date.now();
              return (
                <tr key={u.id} className="hover:bg-background-elev/30">
                  <td className="px-4 py-3">
                    <p className="text-foreground">{u.full_name || "—"}</p>
                    <p className="text-[11px] text-muted-foreground">{u.email || "—"}{u.role === "admin" && " · 管理员"}</p>
                  </td>
                  <td className="px-4 py-3"><span className="inline-flex items-center gap-1 text-copper"><Wallet size={12} />{Number(u.credits ?? 0)}</span></td>
                  <td className="px-4 py-3">
                    {isPrem ? <span className="inline-flex items-center gap-1 text-copper"><Crown size={12} />{exp.toLocaleDateString("zh-CN")}</span> : <span className="text-muted-foreground">未开通</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={() => openEdit(u)} className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs text-foreground transition-colors hover:border-copper/40 hover:text-copper">修改</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-6">
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <p className="truncate font-display text-lg text-foreground">{edit.user.full_name || "用户"}</p>
                <p className="truncate text-xs text-muted-foreground">{edit.user.email}</p>
              </div>
              <button type="button" onClick={() => setEdit(null)} className="shrink-0 text-muted-foreground hover:text-foreground"><X size={18} /></button>
            </div>

            <label className="mt-5 block">
              <span className="text-[11px] uppercase tracking-luxe text-muted-foreground">积分余额</span>
              <input type="number" value={edit.credits} onChange={(e) => setEdit((s) => ({ ...s, credits: e.target.value }))} className="mt-1.5 w-full rounded-lg border border-border bg-background-elev/50 px-3 py-2 text-sm text-[#3a2a1a] focus:border-copper/50 focus:outline-none" />
              <div className="mt-2 flex flex-wrap gap-2">
                {[100, 330, 580].map((n) => (
                  <button key={n} type="button" onClick={() => addCredits(n)} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-copper/40 hover:text-copper"><Plus size={10} />{n}</button>
                ))}
              </div>
            </label>

            <label className="mt-4 block">
              <span className="text-[11px] uppercase tracking-luxe text-muted-foreground">会员到期时间</span>
              <input type="datetime-local" value={edit.premiumLocal} onChange={(e) => setEdit((s) => ({ ...s, premiumLocal: e.target.value }))} className="mt-1.5 w-full rounded-lg border border-border bg-background-elev/50 px-3 py-2 text-sm text-[#3a2a1a] focus:border-copper/50 focus:outline-none" />
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={grantMonth} className="inline-flex items-center gap-1 rounded-full border border-copper/40 bg-copper/10 px-3 py-1.5 text-xs text-copper"><Crown size={11} /> 开通 / 延长 1 个月</button>
              <button type="button" onClick={clearPremium} className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-red-400/40 hover:text-red-200"><Trash2 size={11} /> 清除会员</button>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setEdit(null)} className="rounded-full border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground">取消</button>
              <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-full bg-copper px-5 py-2 text-sm font-medium text-copper-foreground disabled:opacity-50">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} 保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}