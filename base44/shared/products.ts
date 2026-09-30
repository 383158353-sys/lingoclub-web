// 服务端积分 / 高级会员商品目录。
// 由 create-checkout（解析价格）与 payments-webhook（发放积分 / 开通会员）共享。
// 永远不要信任前端传入的金额 —— 此目录是唯一权威来源。
// 改动套餐后两端同步生效，无需分别维护两份价格表。

export type ProductKind = "credits" | "premium";

export interface ProductDef {
  name: string;          // 结账页与 Base44Purchase 上展示的商品名
  price: string;         // 单价（货币主单位，与商户账户币种一致）
  currency: string;      // 商户账户币种
  kind: ProductKind;
  credits?: number;      // kind === "credits" 时发放的积分数
  subscription?: { frequency: "MONTH" | "YEAR" | "WEEK" | "DAY" }; // kind === "premium" 时为订阅
}

export const PRODUCTS: Record<string, ProductDef> = {
  credits_100: { name: "100 积分", price: "10", currency: "CNY", kind: "credits", credits: 100 },
  credits_330: { name: "330 积分（含赠送 30）", price: "30", currency: "CNY", kind: "credits", credits: 330 },
  credits_580: { name: "580 积分（含赠送 80）", price: "50", currency: "CNY", kind: "credits", credits: 580 },
  credits_1300: { name: "1300 积分（含赠送 300）", price: "100", currency: "CNY", kind: "credits", credits: 1300 },
  premium_monthly: {
    name: "高级会员 · 月付",
    price: "29.8",
    currency: "CNY",
    kind: "premium",
    subscription: { frequency: "MONTH" },
  },
};

export const PREMIUM_PRODUCT_ID = "premium_monthly";

// 每次会员支付开通的时长（覆盖一个月计费周期，留一天余量应对续费时差）。
export const PREMIUM_DAYS = 31;

// 购买月会员额外赠送的积分数。
export const PREMIUM_GIFT_CREDITS = 200;

export function getProduct(id: string): ProductDef | null {
  return PRODUCTS[id] ?? null;
}

export function creditsForProduct(id: string): number {
  const p = PRODUCTS[id];
  return p && p.kind === "credits" ? (p.credits ?? 0) : 0;
}