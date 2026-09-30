// Base44 Payments fulfillment webhook — base44/functions/payments-webhook/entry.ts
//
// Provided by the platform. Do NOT rewrite the plumbing (JWT verification, envelope parsing,
// purchase resolution, idempotency). Only edit the region marked
// `// ===== APP-SPECIFIC =====` to define what "grant access" means for this app.
//
// It receives Wix `ORDER_APPROVED` events (and optional subscription lifecycle events),
// verifies the RS256 JWT, resolves the buyer's pending Purchase by checkout id, and marks
// it paid exactly once. It pairs with `create-checkout`, which MUST persist
// `checkoutSession.id` on the Purchase — Wix has no custom-metadata field, so the checkout
// id is the ONLY correlation key back to this app's user.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.31";
import { importSPKI, jwtVerify } from "npm:jose@5.9.6";
import { creditsForProduct, PREMIUM_PRODUCT_ID, PREMIUM_DAYS, PREMIUM_GIFT_CREDITS } from "../../shared/products.ts";

// Wix event types (verbatim from Wix docs).
const ORDER_APPROVED = "wix.ecom.v1.order_approved";
const SUBSCRIPTION_CANCELED = "wix.ecom.subscription_contracts.v1.subscription_contract_canceled";
const SUBSCRIPTION_EXPIRED = "wix.ecom.subscription_contracts.v1.subscription_contract_expired";

// Unwrap Wix's triple-nested envelope: the request body is a JWT whose verified
// payload has a `data` JSON string; that parses to an envelope with `eventType` and
// another `data` JSON string; that parses to the event data holding the order.
function parseWixEnvelope(payload: Record<string, unknown>): { eventType: string; eventData: any } {
  const outer = typeof payload.data === "string" ? JSON.parse(payload.data) : payload.data;
  // eventType lives on the parsed envelope; newer DomainEvent envelopes may also carry it as a
  // top-level JWT claim — fall back to that so the event isn't misrouted to the ignore branch.
  const eventType: string = outer?.eventType ?? (payload.eventType as string) ?? "";
  const eventData = typeof outer?.data === "string" ? JSON.parse(outer.data) : outer?.data;
  return { eventType, eventData };
}

// For order_approved, the order is at eventData.order (per Wix Payments docs:
// `eventData.order.checkoutId === checkoutSession.id`).
function extractOrder(eventData: any): any | null {
  return eventData?.order ?? eventData?.actionEvent?.body?.order ?? null;
}

// The buyer's email, as entered on Wix's hosted checkout page. This is the ONLY identity for an
// anonymous buyer (one who wasn't signed in when create-checkout ran, so appUserId is null). Wix
// exposes it in a few places depending on the flow; check the common ones.
function extractBuyerEmail(order: any): string | null {
  return (
    order?.buyerInfo?.email ??
    order?.billingInfo?.contactDetails?.email ??
    order?.billingInfo?.email ??
    null
  );
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    // Read per request, never at module scope: the key is stored when the webhook is registered, so
    // a warm isolate that captured it at startup would stay keyless and 500 every ORDER_APPROVED.
    const WEBHOOK_PUBLIC_KEY = Deno.env.get("WIX_CHECKOUT_WEBHOOK_PUBLIC_KEY");
    if (!WEBHOOK_PUBLIC_KEY) {
      // Never process an unverifiable event. Missing key = misconfiguration, not a retry case.
      console.error("payments-webhook: WIX_CHECKOUT_WEBHOOK_PUBLIC_KEY is not set");
      return new Response("Webhook not configured", { status: 500 });
    }

    // The raw body IS the JWT (Wix signs the whole payload, RS256).
    const token = await req.text();

    let payload: Record<string, unknown>;
    try {
      const key = await importSPKI(WEBHOOK_PUBLIC_KEY, "RS256");
      const verified = await jwtVerify(token, key);
      payload = verified.payload as Record<string, unknown>;
    } catch (err) {
      // Signature invalid / malformed. Reject — do NOT grant anything.
      console.error("payments-webhook: JWT verification failed", err);
      return new Response("Invalid signature", { status: 401 });
    }

    const { eventType, eventData } = parseWixEnvelope(payload);
    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole; // No end user is authenticated on a webhook call.

    if (eventType === ORDER_APPROVED) {
      return await handleOrderApproved(db, eventData);
    }

    if (eventType === SUBSCRIPTION_CANCELED || eventType === SUBSCRIPTION_EXPIRED) {
      return await handleSubscriptionEnded(db, eventData);
    }

    // Unknown/irrelevant event — acknowledge so Wix stops retrying.
    console.log(`payments-webhook: ignoring event ${eventType}`);
    return new Response("OK", { status: 200 });
  } catch (err) {
    // Unexpected failure: 500 tells Wix to retry later (the handler is idempotent, so a
    // retry after a partial failure is safe).
    console.error("payments-webhook: unhandled error", err);
    return new Response("Internal error", { status: 500 });
  }
});

async function handleOrderApproved(db: any, eventData: any): Promise<Response> {
  const order = extractOrder(eventData);
  const checkoutId: string | undefined = order?.checkoutId;
  const orderId: string | undefined = order?.id;
  // Subscription id (if any) — persisted below so SUBSCRIPTION_CANCELED/EXPIRED can later
  // resolve this purchase by subscriptionId and revoke access.
  const subscriptionId: string | undefined = (order?.lineItems ?? [])
    .map((li: any) => li?.subscriptionInfo?.id)
    .find((id: any) => !!id);

  if (!checkoutId) {
    // Nothing to correlate on. Acknowledge to stop retries; log for investigation.
    console.error("payments-webhook: ORDER_APPROVED missing order.checkoutId", { orderId });
    return new Response("OK", { status: 200 });
  }

  // Resolve the pending purchase created by `create-checkout` (join key: checkoutSessionId).
  const matches = await db.entities.Base44Purchase.filter({ checkoutSessionId: checkoutId });
  const purchase = matches?.[0];

  if (!purchase) {
    // The pending Base44Purchase is written by create-checkout before the buyer pays, so a miss
    // here is a transient race (entity not yet visible) — return 500 so Wix retries, rather
    // than ACKing a paid order we can't fulfill. (Wix stops after its retry window.)
    console.warn("payments-webhook: no Base44Purchase for checkoutId yet, asking Wix to retry", { checkoutId, orderId });
    return new Response("Purchase not found yet", { status: 500 });
  }

  // IDEMPOTENCY + terminal states: Wix delivers ORDER_APPROVED more than once, and may deliver
  // a stale approval after a cancellation. Skip if already "paid" (prevents double-grant) or
  // "canceled" (a late approval must not resurrect a revoked subscription).
  if (purchase.status === "paid" || purchase.status === "canceled") {
    console.log("payments-webhook: purchase already terminal, skipping", { checkoutId, status: purchase.status });
    return new Response("OK", { status: 200 });
  }

  // The buyer's email: from create-checkout if they were signed in, otherwise from the Wix order
  // (the only identity an anonymous buyer has). Persisted below and used by the grant block.
  const buyerEmail: string | null = purchase.buyerEmail ?? extractBuyerEmail(order);

  // ===== APP-SPECIFIC =====
  // 发放：积分套餐 += credits；高级会员写入 premium_expires_at。
  // 目标用户优先用 create-checkout 记录的 appUserId（登录用户），否则按结账页邮箱匹配站内用户；
  // 仅对已有站内用户发放，匿名且无匹配则记日志（需联系支持补发）。
  let targetUserId = purchase.appUserId ?? null;
  if (!targetUserId && buyerEmail) {
    try {
      const byEmail = await db.entities.User.filter({ email: buyerEmail });
      targetUserId = byEmail?.[0]?.id ?? null;
    } catch (e) {
      console.warn("payments-webhook: 按邮箱查找用户失败", e);
    }
  }
  if (targetUserId) {
    const pid = purchase.productId;
    if (pid === PREMIUM_PRODUCT_ID) {
      // 开通高级会员 31 天，并赠送 200 积分（购买月会员福利）；$set+$inc 合并一次原子写入。
      const exp = new Date(Date.now() + PREMIUM_DAYS * 24 * 60 * 60 * 1000).toISOString();
      await db.entities.User.updateMany(
        { id: targetUserId },
        { $set: { premium_expires_at: exp }, $inc: { credits: PREMIUM_GIFT_CREDITS } }
      );
      console.log("payments-webhook: 已开通高级会员并赠送积分", { targetUserId, exp, gift: PREMIUM_GIFT_CREDITS });
    } else {
      const add = creditsForProduct(pid);
      if (add > 0) {
        // 原子自增；顶部 status=paid 短路已挡住顺序重复，并发重复最多多发一次（可接受）。
        await db.entities.User.updateMany({ id: targetUserId }, { $inc: { credits: add } });
        console.log("payments-webhook: 已发放积分", { targetUserId, add });
      } else {
        console.warn("payments-webhook: 未知商品，未发放", { pid });
      }
    }
  } else {
    console.warn("payments-webhook: 无发放目标（匿名买家且无匹配站内用户）", { checkoutId, buyerEmail });
  }
  // ===== END APP-SPECIFIC =====

  // Mark paid LAST, so "paid" always implies the grant above completed. The idempotency
  // check at the top short-circuits on this status, so it must only be set after fulfillment.
  // subscriptionId is stored here so SUBSCRIPTION_CANCELED/EXPIRED can resolve this purchase.
  await db.entities.Base44Purchase.update(purchase.id, {
    status: "paid",
    orderId: orderId ?? purchase.orderId ?? null,
    subscriptionId: subscriptionId ?? purchase.subscriptionId ?? null,
    // Persist the buyer email (backfilled from the Wix order for anonymous buyers) so the record
    // always shows who paid, even when create-checkout had no signed-in user.
    buyerEmail: buyerEmail ?? purchase.buyerEmail ?? null,
    paidAt: new Date().toISOString(),
  });

  console.log("payments-webhook: fulfilled purchase", { purchaseId: purchase.id, checkoutId, orderId });
  return new Response("OK", { status: 200 });
}

async function handleSubscriptionEnded(db: any, eventData: any): Promise<Response> {
  // Canceled = ended early; Expired = ran all billing cycles. Both revoke access.
  // Mirrors the order path (eventData.<entity>); keep a fallback since the subscription
  // contract webhook body isn't as tightly documented as order_approved.
  const contract = eventData?.subscriptionContract ?? eventData?.actionEvent?.body?.subscriptionContract ?? eventData?.entity ?? null;
  const subscriptionId: string | undefined = contract?.id;

  if (!subscriptionId) {
    console.error("payments-webhook: subscription event missing contract id");
    return new Response("OK", { status: 200 });
  }

  const matches = await db.entities.Base44Purchase.filter({ subscriptionId });
  const purchase = matches?.[0];
  if (!purchase) {
    // The subscriptionId is written on the Purchase by the ORDER_APPROVED handler. If a
    // cancel/expire arrives before (or racing) that approval, no Purchase matches yet —
    // return 500 so Wix retries until the approval has linked it, instead of losing the
    // revoke by acking a not-yet-linkable event.
    console.warn("payments-webhook: no Purchase for subscription yet, asking Wix to retry", { subscriptionId });
    return new Response("Purchase not linkable yet", { status: 500 });
  }

  if (purchase.status === "canceled") {
    return new Response("OK", { status: 200 }); // Idempotent.
  }

  // ===== APP-SPECIFIC =====
  // 撤销高级会员：清空 premium_expires_at，使其失去全站免费资格。
  // 仅对高级会员商品生效；积分套餐无订阅周期，不会进入此分支。
  if (purchase.productId === PREMIUM_PRODUCT_ID && purchase.appUserId) {
    await db.entities.User.update(purchase.appUserId, { premium_expires_at: null });
    console.log("payments-webhook: 已撤销高级会员", { userId: purchase.appUserId });
  } else if (purchase.appUserId) {
    console.log("payments-webhook: 订阅结束（非高级会员商品）", { productId: purchase.productId });
  }
  // ===== END APP-SPECIFIC =====

  // Mark canceled LAST, so "canceled" always implies access was actually revoked.
  await db.entities.Base44Purchase.update(purchase.id, {
    status: "canceled",
    canceledAt: new Date().toISOString(),
  });

  console.log("payments-webhook: revoked subscription", { purchaseId: purchase.id, subscriptionId });
  return new Response("OK", { status: 200 });
}