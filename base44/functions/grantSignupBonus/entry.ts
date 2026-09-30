// 新用户注册赠送 100 积分。由 app_user_auth(signup) 工作流触发。
// 幂等：用 User.signup_bonus_granted 标记保证只发放一次，重复登录/重复触发不会重复发放。
// 仅服务角色可写 User.credits，前端无任何入口可改余额。

import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";

const SIGNUP_BONUS = 100;

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const userId = String(body.user_id ?? "");
    if (!userId) return Response.json({ error: "missing user_id" }, { status: 400 });

    // 认证调用方：仅允许已登录用户为自己的账号申请注册积分，
    // 阻止未认证或伪造 user_id 的请求（工作流触发时平台会携带注册用户上下文）。
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (caller.id !== userId) return Response.json({ error: "forbidden: can only grant for self" }, { status: 403 });

    const user = await db.entities.User.get(userId).catch(() => null);
    if (!user) return Response.json({ error: "user not found" }, { status: 404 });

    if (user.signup_bonus_granted) {
      return Response.json({ ok: true, granted: false, reason: "already", credits: Number(user.credits ?? 0) });
    }

    const newCredits = Number(user.credits ?? 0) + SIGNUP_BONUS;
    await db.entities.User.update(userId, {
      credits: newCredits,
      signup_bonus_granted: true,
    });
    console.log("grantSignupBonus: granted", { userId, newCredits });
    return Response.json({ ok: true, granted: true, credits: newCredits });
  } catch (err) {
    console.error("grantSignupBonus error", err);
    return Response.json({ error: err?.message || "grant failed" }, { status: 500 });
  }
}