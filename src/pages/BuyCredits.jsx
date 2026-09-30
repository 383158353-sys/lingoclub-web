import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Image } from "@/components/ui/image";
import { Wallet, Crown, Check, ArrowRight, Sparkles, ChevronLeft, X, QrCode } from "lucide-react";

// 客服人工续费模式：
// 本页不发起新的在线支付，点「购买」只弹窗展示微信客服二维码 + 转账说明。
// 由你在后台（/admin/users）手动给用户开通积分或会员。
// 把下面换成你自己的微信客服二维码图片 URL（在后台文件库上传后复制链接）。
// 留空时会显示占位框，方便你先上线再替换。
const CUSTOMER_SERVICE_QR_URL = "https://media.base44.com/images/public/6a73619e5499baa21f415b49/8561e419a__20260806185441_16_43.jpg";

const TIERS = [
  { id: "credits_100", credits: 100, price: 10, label: "尝鲜", bonus: 0 },
  { id: "credits_330", credits: 330, price: 30, label: "常用", bonus: 30 },
  { id: "credits_580", credits: 580, price: 50, label: "超值", bonus: 80, best: true },
  { id: "credits_1300", credits: 1300, price: 100, label: "学霸", bonus: 300 },
];

export default function BuyCredits() {
  const [me, setMe] = useState(null);
  const [qr, setQr] = useState(null); // { name, price }

  useEffect(() => {
    base44.auth.me().then(setMe).catch(() => setMe(null));
  }, []);

  const credits = Number(me?.credits ?? 0);
  const premiumExp = me?.premium_expires_at ? new Date(me.premium_expires_at) : null;
  const isPremium = !!premiumExp && premiumExp.getTime() > Date.now();

  // 不再发起在线支付，统一弹客服二维码。
  const buy = (productId) => {
    const t = TIERS.find((x) => x.id === productId);
    setQr(t ? { name: `${t.credits} 积分套餐`, price: t.price } : { name: "高级会员 · 月付", price: 29.8 });
  };

  return (
    <div className="mx-auto max-w-5xl px-5 lg:px-8 pt-28 pb-20">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-copper">
        <ChevronLeft size={15} /> 返回
      </Link>

      <header className="mt-6">
        <p className="text-[11px] uppercase tracking-luxe text-copper/80">积分 · 会员</p>
        <h1 className="mt-1 font-display text-4xl text-foreground md:text-5xl">充值与高级会员</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          积分用于加入心仪的影视学习小组，¥1 = 10 积分；开通高级会员后全部小组免费加入。
        </p>
      </header>

      {/* 余额 + 会员状态 */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-border/60 bg-card p-5">
          <p className="flex items-center gap-2 text-xs uppercase tracking-luxe text-muted-foreground"><Wallet size={13} className="text-copper" /> 我的积分</p>
          <p className="mt-2 font-display text-4xl text-copper">{credits.toLocaleString()}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">新用户注册赠送 100 积分</p>
        </div>
        <div className={`rounded-2xl border p-5 ${isPremium ? "border-copper/50 bg-copper/10" : "border-border/60 bg-card"}`}>
          <p className="flex items-center gap-2 text-xs uppercase tracking-luxe text-muted-foreground"><Crown size={13} className="text-copper" /> 高级会员</p>
          {isPremium ? (
            <>
              <p className="mt-2 font-display text-2xl text-foreground">已开通</p>
              <p className="mt-1 text-[11px] text-copper">有效期至 {premiumExp.toLocaleDateString("zh-CN")} · 全部小组免费加入</p>
            </>
          ) : (
            <>
              <p className="mt-2 font-display text-2xl text-foreground">未开通</p>
              <p className="mt-1 text-[11px] text-muted-foreground">¥29.8 / 月，开通后任意小组免费加入</p>
            </>
          )}
        </div>
      </div>

      {/* 积分套餐 */}
      <h2 className="mt-12 font-display text-xl text-foreground">积分套餐</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TIERS.map((t) => (
          <div key={t.id} className={`relative flex flex-col rounded-2xl border bg-card p-5 ${t.best ? "border-copper/50" : "border-border/60"}`}>
            {t.best && (
              <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-copper px-2.5 py-0.5 text-[10px] font-medium text-copper-foreground">最超值</span>
            )}
            <p className="text-[11px] uppercase tracking-luxe text-muted-foreground">{t.label}</p>
            <p className="mt-2 font-display text-3xl text-foreground">{t.credits}</p>
            <p className="text-xs text-copper">积分{t.bonus > 0 && <span className="text-foreground/60"> · 含赠送 {t.bonus}</span>}</p>
            <p className="mt-3 font-display text-2xl text-foreground">¥{t.price}</p>
            <button
              type="button"
              onClick={() => buy(t.id)}
              className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-full bg-copper px-4 py-2 text-sm font-medium text-copper-foreground transition-transform hover:scale-[1.02]"
            >
              <Sparkles size={14} /> 购买
            </button>
          </div>
        ))}
      </div>

      {/* 高级会员 */}
      <h2 className="mt-12 font-display text-xl text-foreground">高级会员</h2>
      <div className="mt-4 rounded-2xl border border-copper/40 bg-gradient-to-br from-copper/10 to-transparent p-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <p className="flex items-center gap-2 font-display text-2xl text-foreground"><Crown size={20} className="text-copper" /> 高级会员 · 月付</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">¥29.8 / 月，开通后可加入站内任意影视学习小组，不再消耗积分。</p>
            <ul className="mt-3 space-y-1.5 text-sm text-foreground/90">
              <li className="flex items-center gap-2"><Check size={14} className="text-copper" /> 全部小组免费加入</li>
              <li className="flex items-center gap-2"><Check size={14} className="text-copper" /> 不再为每个小组单独消耗积分</li>
              <li className="flex items-center gap-2"><Check size={14} className="text-copper" /> 购买即赠 200 积分</li>
              <li className="flex items-center gap-2"><Check size={14} className="text-copper" /> 可随时取消，取消后到期前仍可使用</li>
            </ul>
          </div>
          <div className="shrink-0 text-center md:text-right">
            <p className="font-display text-4xl text-foreground">¥29.8<span className="text-base font-body text-muted-foreground">/月</span></p>
            <button
              type="button"
              onClick={() => buy("premium_monthly")}
              disabled={isPremium}
              className="mt-3 inline-flex items-center justify-center gap-2 rounded-full bg-copper px-6 py-3 text-sm font-medium text-copper-foreground transition-transform hover:scale-[1.02] disabled:opacity-50"
            >
              {isPremium ? <Check size={16} /> : <Crown size={16} />}
              {isPremium ? "已开通" : "开通高级会员"} <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </div>

      <p className="mt-8 text-[11px] leading-relaxed text-muted-foreground">
        购买由客服人工处理：点击购买后扫码添加客服微信 → 转账并备注注册邮箱 → 客服将在后台手动为您开通，开通后刷新本页即可查看积分与会员。
      </p>

      {qr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="relative w-full max-w-sm rounded-2xl border border-copper/40 bg-card p-7 text-center">
            <button type="button" onClick={() => setQr(null)} className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"><X size={18} /></button>
            <p className="flex items-center justify-center gap-2 text-[11px] uppercase tracking-luxe text-copper/80"><QrCode size={13} /> 联系客服开通</p>
            <p className="mt-2 font-display text-xl text-foreground">{qr.name}</p>
            <p className="mt-1 text-copper">¥{qr.price}</p>

            <div className="mt-5 flex items-center justify-center">
              {CUSTOMER_SERVICE_QR_URL ? (
                <div className="h-52 w-52 overflow-hidden rounded-xl border border-border/60 bg-white p-2">
                  <Image src={CUSTOMER_SERVICE_QR_URL} alt="客服微信二维码" fittingType="fit" className="h-full w-full" />
                </div>
              ) : (
                <div className="flex h-52 w-52 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border/70 text-center">
                  <QrCode size={40} className="text-muted-foreground/50" />
                  <p className="px-6 text-[11px] leading-relaxed text-muted-foreground">客服微信二维码<br/>(待替换)</p>
                </div>
              )}
            </div>

            <ol className="mt-5 space-y-1.5 text-left text-xs leading-relaxed text-muted-foreground">
              <li>1. 微信扫码添加客服</li>
              <li>2. 转账 <span className="text-foreground">¥{qr.price}</span>，备注你的注册邮箱</li>
              <li>3. 客服在后台开通后，刷新本页即可看到积分 / 会员</li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}