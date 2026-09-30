import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserPlus, Mail, Lock, Loader2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import { safeReturnTo } from "@/lib/authReturnTo";
import { useAuth } from "@/lib/AuthContext";

export default function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { signUp } = useAuth();
  const returnTo = safeReturnTo();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    if (password.length < 6) { setError("密码至少需要 6 位"); return; }
    if (password !== confirmPassword) { setError("两次输入的密码不一致"); return; }
    setLoading(true);
    try {
      const result = await signUp(email, password);
      if (!result?.session) {
        setError("注册成功，但当前项目要求邮箱确认后才能登录，请检查 Supabase Email 设置。");
        setLoading(false);
        return;
      }
      window.location.href = returnTo;
    } catch (err) {
      setError(err?.message || "注册失败，请稍后重试");
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      icon={UserPlus}
      title="创建你的账号"
      subtitle="注册后可在多台设备同步学习数据"
      footer={<><span>已有账号？ </span><Link to={`/login?returnTo=${encodeURIComponent(returnTo)}`} className="text-primary font-medium hover:underline">登录</Link></>}
    >
      {error && <div className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">邮箱</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input id="email" type="email" autoComplete="email" autoFocus placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} className="h-12 pl-10" required />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">密码</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input id="password" type="password" autoComplete="new-password" placeholder="至少 6 位" value={password} onChange={(event) => setPassword(event.target.value)} className="h-12 pl-10" required />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">确认密码</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input id="confirm" type="password" autoComplete="new-password" placeholder="再次输入密码" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="h-12 pl-10" required />
          </div>
        </div>
        <Button type="submit" className="h-12 w-full font-medium" disabled={loading}>
          {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />创建中…</> : "创建账号"}
        </Button>
      </form>
    </AuthLayout>
  );
}
