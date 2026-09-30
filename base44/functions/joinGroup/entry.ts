// 加入小组的结算逻辑 —— 严禁前端本地处理金额，所有积分增减都走本函数。
// 流程：
//   1. 读取当前用户（必须登录）与目标小组。
//   2. 若用户高级会员仍在期 → 免费加入（tier=premium）。
//   3. 否则若小组需积分：余额不足返回 402 + 充值引导信息；足则原子扣减（$inc）。
//   4. 否则免费加入（tier=free）。
//   5. 复用或新建订阅记录（用户 RLS，保证出现在「个人订阅」），积分/会员状态写入 tier。

import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "请先登录后加入小组", code: "UNAUTHORIZED" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const movieId = String(body.movie_id ?? "");
    if (!movieId) return Response.json({ error: "缺少小组" }, { status: 400 });

    const movie = await base44.asServiceRole.entities.Movie.get(movieId).catch(() => null);
    if (!movie) return Response.json({ error: "小组不存在" }, { status: 404 });

    // 读取积分与会员状态：走服务角色，因为余额字段用户不可自读自改。
    const me = await base44.asServiceRole.entities.User.get(user.id).catch(() => null);
    const credits = Number(me?.credits ?? 0);
    const premiumExpiresAt = me?.premium_expires_at ? new Date(me.premium_expires_at) : null;
    const isPremium = !!premiumExpiresAt && premiumExpiresAt.getTime() > Date.now();
    const priceCredits = Number(movie.price_credits ?? 0);

    let tier = "free";
    let charged = 0;

    if (isPremium) {
      tier = "premium";
    } else if (priceCredits > 0) {
      if (credits < priceCredits) {
        return Response.json({
          error: "积分不足，请前往充值",
          code: "INSUFFICIENT_CREDITS",
          required: priceCredits,
          balance: credits,
          movie_title: movie.title,
        }, { status: 402 });
      }
      // 原子扣减：同一并发重复请求最多多扣一次，对本场景影响极小；
      // 同时避免「读到旧余额再写回」的丢失更新问题。
      await base44.asServiceRole.entities.User.updateMany(
        { id: user.id },
        { $inc: { credits: -priceCredits } }
      );
      tier = "credits";
      charged = priceCredits;
    }

    // 订阅记录走用户 RLS：created_by_id 落到当前用户，「个人订阅」可见。
    const existing = await base44.entities.Subscription.filter({ movie_id: movieId }, null, 10).catch(() => []);
    const prior = (existing || [])[0];
    const nowIso = new Date().toISOString();
    const order = Math.floor(Date.now() / 1000);
    if (prior) {
      await base44.entities.Subscription.update(prior.id, {
        status: "active",
        tier,
        start_date: nowIso,
        order: Math.max(prior.order ?? 0, order),
      });
    } else {
      await base44.entities.Subscription.create({
        movie_id: movieId,
        movie_title: movie.title || "",
        tier,
        status: "active",
        start_date: nowIso,
        order,
      });
    }

    return Response.json({
      ok: true,
      tier,
      charged,
      remaining: credits - charged,
      movie_title: movie.title,
    });
  } catch (err) {
    console.error("joinGroup error", err);
    return Response.json({ error: err?.message || "加入失败" }, { status: 500 });
  }
}