// app/routes/app.shopplan.jsx

import { json }         from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma               from "../db.server";
import { PLANS, PLAN_KEYS } from "../config/plans";

// ─── Helper: format plan for response ─────────────────────────
function formatPlan(shopPlan) {
  const planKey  = shopPlan?.plan ?? "free";
  const planData = PLANS[planKey] ?? PLANS.free;

  return {
    name:             planKey,
    label:            planData.label,
    price:            planData.price,
    // ✅ Infinity → null (JSON can't serialize Infinity)
    surveyLimit:      planData.surveyLimit   === Infinity ? null : planData.surveyLimit,
    questionLimit:    planData.questionLimit === Infinity ? null : planData.questionLimit,
    subscriptionId:   shopPlan?.subscriptionId   ?? null,
    status:           shopPlan?.status           ?? "active",
    trialEndsAt:      shopPlan?.trialEndsAt      ?? null,
    billingStartedAt: shopPlan?.billingStartedAt ?? null,
    createdAt:        shopPlan?.createdAt        ?? null,
    updatedAt:        shopPlan?.updatedAt        ?? null,
  };
}

// ─────────────────────────────────────────────────────────────
// LOADER  (GET)
//
//  PUBLIC — from checkout extension:
//    GET /app/shopplan?shop=mystore.myshopify.com
//    → reads ShopPlan directly from DB, no auth needed
//
//  ADMIN — from app pages:
//    GET /app/shopplan              → get plan from DB
//    GET /app/shopplan?action=sync  → sync from Shopify API then save
//    GET /app/shopplan?action=canAdd→ check if shop can add survey
// ─────────────────────────────────────────────────────────────
export const loader = async ({ request }) => {
  const url       = new URL(request.url);
  const shopParam = url.searchParams.get("shop");
  const action    = url.searchParams.get("action");

  // ── PUBLIC: checkout extension ────────────────────────────
  if (shopParam) {
    try {
      // ✅ Direct DB query on ShopPlan model
      const shopPlan = await prisma.shopPlan.findUnique({
        where: { shop: shopParam },
      });

      // If no record exists, default to free plan
      const plan = formatPlan(shopPlan);

      return json(
        { ok: true, shop: shopParam, plan },
        {
          headers: {
            "Access-Control-Allow-Origin":  "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        }
      );

    } catch (err) {
      console.error("[app.shopplan] public loader error:", err);
      return json(
        {
          ok:   false,
          error: "Failed to fetch plan.",
          plan: formatPlan(null), // safe default → free
        },
        {
          status: 500,
          headers: { "Access-Control-Allow-Origin": "*" },
        }
      );
    }
  }

  // ── ADMIN: authenticated ──────────────────────────────────
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  try {

    // ── Sync from Shopify API → update ShopPlan in DB ───────
    if (action === "sync") {
      const response = await admin.graphql(
        `#graphql
        query GetActiveSubscription {
          currentAppInstallation {
            activeSubscriptions {
              id
              name
              status
              lineItems {
                id
                plan {
                  pricingDetails {
                    __typename
                  }
                }
              }
            }
          }
        }`
      );

      const responseData  = await response.json();
      const subscriptions =
        responseData.data?.currentAppInstallation?.activeSubscriptions ?? [];

      const active = subscriptions.find(
        (sub) =>
          sub.status === "ACTIVE" &&
          PLAN_KEYS.includes(sub.name.toLowerCase())
      );

      const planKey = active ? active.name.toLowerCase() : "free";

      // ✅ Upsert directly into ShopPlan
      const saved = await prisma.shopPlan.upsert({
        where:  { shop },
        update: {
          plan:           planKey,
          subscriptionId: active?.id ?? null,
          status:         "active",
          updatedAt:      new Date(),
        },
        create: {
          shop,
          plan:           planKey,
          subscriptionId: active?.id ?? null,
          status:         "active",
        },
      });

      return json({ ok: true, action: "sync", shop, plan: formatPlan(saved) });
    }

    // ── canAdd: check if shop can add a survey ───────────────
    if (action === "canAdd") {
      // ✅ Read ShopPlan directly
      const shopPlan = await prisma.shopPlan.findUnique({
        where: { shop },
      });

      const planKey      = shopPlan?.plan ?? "free";
      const planData     = PLANS[planKey] ?? PLANS.free;
      const surveyLimit  = planData.surveyLimit;

      const surveyCount  = await prisma.survey.count({ where: { shop } });

      const canAdd = surveyLimit === Infinity || surveyCount < surveyLimit;

      return json({
        ok:        true,
        action:    "canAdd",
        shop,
        canAdd,
        current:   surveyCount,
        limit:     surveyLimit === Infinity ? null : surveyLimit,
        planName:  planKey,
        planLabel: planData.label,
      });
    }

    // ── Default: get plan from DB ────────────────────────────
    // ✅ Direct ShopPlan query
    const shopPlan = await prisma.shopPlan.findUnique({
      where: { shop },
    });

    return json({
      ok:     true,
      action: "get",
      shop,
      plan:   formatPlan(shopPlan),
    });

  } catch (err) {
    console.error("[app.shopplan] admin loader error:", err);
    return json(
      { ok: false, error: "Internal server error.", action },
      { status: 500 }
    );
  }
};

// ─────────────────────────────────────────────────────────────
// OPTIONS — CORS preflight for checkout extension
// ─────────────────────────────────────────────────────────────
export const options = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
};

// ─────────────────────────────────────────────────────────────
// ACTION  (POST — admin only)
//
//  POST { action: "update", plan, subscriptionId }
//  POST { action: "sync" }
//  POST { action: "cancel" }
// ─────────────────────────────────────────────────────────────
export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  let body;
  try {
    body = await request.json();
  } catch {
    return json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const { action } = body;

  if (!action) {
    return json(
      { ok: false, error: "Missing required field: action." },
      { status: 400 }
    );
  }

  try {

    // ── Update plan after billing approval ──────────────────
    if (action === "update") {
      const { plan: planKey, subscriptionId } = body;

      if (!planKey) {
        return json(
          { ok: false, error: "Missing required field: plan." },
          { status: 400 }
        );
      }

      if (!PLAN_KEYS.includes(planKey)) {
        return json(
          {
            ok:    false,
            error: `Invalid plan "${planKey}". Allowed: ${PLAN_KEYS.join(" | ")}`,
          },
          { status: 400 }
        );
      }

      // ✅ Upsert directly into ShopPlan
      const saved = await prisma.shopPlan.upsert({
        where:  { shop },
        update: {
          plan:             planKey,
          subscriptionId:   subscriptionId ?? null,
          status:           "active",
          billingStartedAt: planKey !== "free" ? new Date() : null,
          updatedAt:        new Date(),
        },
        create: {
          shop,
          plan:             planKey,
          subscriptionId:   subscriptionId ?? null,
          status:           "active",
          billingStartedAt: planKey !== "free" ? new Date() : null,
        },
      });

      return json({
        ok:     true,
        action: "update",
        shop,
        plan:   formatPlan(saved),
      });
    }

    // ── Force sync from Shopify API ─────────────────────────
    if (action === "sync") {
      const response = await admin.graphql(
        `#graphql
        query GetActiveSubscription {
          currentAppInstallation {
            activeSubscriptions {
              id
              name
              status
              lineItems {
                id
                plan {
                  pricingDetails {
                    __typename
                  }
                }
              }
            }
          }
        }`
      );

      const responseData  = await response.json();
      const subscriptions =
        responseData.data?.currentAppInstallation?.activeSubscriptions ?? [];

      const active = subscriptions.find(
        (sub) =>
          sub.status === "ACTIVE" &&
          PLAN_KEYS.includes(sub.name.toLowerCase())
      );

      const planKey = active ? active.name.toLowerCase() : "free";

      // ✅ Upsert directly into ShopPlan
      const saved = await prisma.shopPlan.upsert({
        where:  { shop },
        update: {
          plan:           planKey,
          subscriptionId: active?.id ?? null,
          status:         "active",
          updatedAt:      new Date(),
        },
        create: {
          shop,
          plan:           planKey,
          subscriptionId: active?.id ?? null,
          status:         "active",
        },
      });

      return json({
        ok:     true,
        action: "sync",
        shop,
        plan:   formatPlan(saved),
      });
    }

    // ── Cancel plan → downgrade to free ────────────────────
    if (action === "cancel") {
      // ✅ Upsert directly into ShopPlan
      const saved = await prisma.shopPlan.upsert({
        where:  { shop },
        update: {
          plan:            "free",
          subscriptionId:  null,
          status:          "cancelled",
          billingStartedAt: null,
          updatedAt:       new Date(),
        },
        create: {
          shop,
          plan:   "free",
          status: "cancelled",
        },
      });

      return json({
        ok:     true,
        action: "cancel",
        shop,
        plan:   formatPlan(saved),
      });
    }

    // ── Unknown action ──────────────────────────────────────
    return json(
      {
        ok:    false,
        error: `Unknown action "${action}". Allowed: update | sync | cancel`,
      },
      { status: 400 }
    );

  } catch (err) {
    console.error("[app.shopplan] action error:", err);
    return json(
      { ok: false, error: "Internal server error." },
      { status: 500 }
    );
  }
};
