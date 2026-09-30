import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { CheckCircle2, Loader2 } from "lucide-react";

// 支付完成返回页。积分 / 会员由 webhook 异步发放，这里轻量轮询余额刷新状态。
export default function ThankYou() {
  const [me, setMe] = useState(null);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const u = await base44.auth.me();
        if (!stop) setMe(u);
      } catch { /* 未登录也无妨 */ }
    };
    tick();
    // webhook 到账可能略晚，轮询几次刷新余额 / 会员状态。
    const t = setInterval(tick, 3000);
    const cleanup = setTimeout(() => clearInterval(t), 15000);
    return () => { stop = true; clearInterval(t); clearTimeout(cleanup); };
  }, []);

  const credits = Number(me?.credits ?? 0);
  const isPremium = me?.premium_expires_at && new Date(me.premium_expires_at) > new Date();

  return (
    <div className="mx-auto max-w-xl px-5 pt-32 pb-20 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-copper/40 bg-copper/10">
        <CheckCircle2 size={30} className="text-copper" />
      </div>
      <h1 className="mt-6 font-display text-3xl text-foreground">支付成功</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        我们正在确认你的支付 并发放积分 / 开通会员，请稍候片刻…
      </p>

      <div className="mt-8 grid grid-cols-2 gap-4 text-left">
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <p className="text-[11px] uppercase tracking-luxe text-muted-foreground">我的积分</p>
          <p className="mt-1 font-display text-2xl text-copper">{credits.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <p className="text-[11px] uppercase tracking-luxe text-muted-foreground">高级会员</p>
          <p className="mt-1 font-display text-2xl text-foreground">{isPremium ? "已开通" : "—"}</p>
        </div>
      </div>

      {!isPremium && credits === 0 && (
        <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 size={12} className="animate-spin" /> 到账中，可稍后刷新查看</p>
      )}

      <div className="mt-8 flex justify-center gap-3">
        <Link to="/buy-credits" className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground">返回积分页</Link>
        <Link to="/communities" className="inline-flex items-center gap-1.5 rounded-full bg-copper px-5 py-2 text-sm font-medium text-copper-foreground">去逛逛小组</Link>
      </div>
    </div>
  );
}