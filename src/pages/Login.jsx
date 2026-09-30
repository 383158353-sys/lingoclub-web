import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogIn, Mail, Lock, Loader2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import { safeReturnTo } from "@/lib/authReturnTo";
import { useAuth } from "@/lib/AuthContext";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { signInWithPassword } = useAuth();
  const returnTo = safeReturnTo();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signInWithPassword(email, password);
      window.location.href = returnTo;
    } catch (err) {
      setError(err?.message || "登录失败，请检查邮箱和密码");
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      icon={LogIn}
      title="登录 LingoClub"
      subtitle="不登录也能使用本地学习功能"
      footer={<><span>还没有账号？ </span><Link to={`/register?returnTo=${encodeURIComponent(returnTo)}`} className="text-primary font-medium hover:underline">注册</Link></>}
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
            <Input id="password" type="password" autoComplete="current-password" placeholder="••••••••" value={password} onChange={(event) => setPassword(event.target.value)} className="h-12 pl-10" required />
          </div>
        </div>
        <Button type="submit" className="h-12 w-full font-medium" disabled={loading}>
          {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />登录中…</> : "登录"}
        </Button>
      </form>
      <p className="mt-4 text-center text-xs text-muted-foreground">Google 登录将在邮箱登录与同步稳定后接入。</p>
    </AuthLayout>
  );
}
