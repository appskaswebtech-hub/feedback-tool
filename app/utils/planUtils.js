// app/utils/planUtils.js

import prisma from "../db.server";
import { PLANS, DEFAULT_PLAN, PLAN_KEYS } from "../config/plans";

// ─────────────────────────────────────────────────────────────
// Get plan from DB — fast, no Shopify API call
// ─────────────────────────────────────────────────────────────
export async function getShopPlanFromDB(shop) {
  try {
    const shopPlan = await prisma.shopPlan.findUnique({
      where: { shop },
    });

    const planKey  = shopPlan?.plan ?? "free";
    const planData = PLANS[planKey] ?? DEFAULT_PLAN;

    return {
      ...planData,
      dbId:            shopPlan?.id            ?? null,
      subscriptionId:  shopPlan?.subscriptionId ?? null,
      status:          shopPlan?.status         ?? "active",
      trialEndsAt:     shopPlan?.trialEndsAt    ?? null,
      billingStartedAt:shopPlan?.billingStartedAt?? null,
    };
  } catch (err) {
    console.error("[planUtils] getShopPlanFromDB error:", err);
    return DEFAULT_PLAN;
  }
}

// ─────────────────────────────────────────────────────────────
// Sync plan from Shopify Billing API → save to DB
// ─────────────────────────────────────────────────────────────
export async function syncPlanFromShopify(admin, shop) {
  try {
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

    const saved = await prisma.shopPlan.upsert({
      where:  { shop },
      update: {
        plan:            planKey,
        subscriptionId:  active?.id ?? null,
        status:          "active",
        updatedAt:       new Date(),
      },
      create: {
        shop,
        plan:            planKey,
        subscriptionId:  active?.id ?? null,
        status:          "active",
      },
    });

    return {
      ...PLANS[planKey],
      subscriptionId:  saved.subscriptionId,
      status:          saved.status,
      trialEndsAt:     saved.trialEndsAt,
      billingStartedAt:saved.billingStartedAt,
    };
  } catch (err) {
    console.error("[planUtils] syncPlanFromShopify error:", err);
    return DEFAULT_PLAN;
  }
}

// ─────────────────────────────────────────────────────────────
// Save / update plan in DB after billing approval
// ─────────────────────────────────────────────────────────────
export async function updateShopPlan(shop, planKey, subscriptionId = null) {
  try {
    if (!PLAN_KEYS.includes(planKey)) {
      throw new Error(`Invalid plan key: ${planKey}`);
    }

    const saved = await prisma.shopPlan.upsert({
      where:  { shop },
      update: {
        plan:             planKey,
        subscriptionId:   subscriptionId,
        status:           "active",
        billingStartedAt: planKey !== "free" ? new Date() : null,
        updatedAt:        new Date(),
      },
      create: {
        shop,
        plan:             planKey,
        subscriptionId:   subscriptionId,
        status:           "active",
        billingStartedAt: planKey !== "free" ? new Date() : null,
      },
    });

    return {
      ...PLANS[planKey],
      subscriptionId:  saved.subscriptionId,
      status:          saved.status,
      billingStartedAt:saved.billingStartedAt,
    };
  } catch (err) {
    console.error("[planUtils] updateShopPlan error:", err);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────
// Cancel plan → downgrade to free
// ─────────────────────────────────────────────────────────────
export async function cancelShopPlan(shop) {
  try {
    const saved = await prisma.shopPlan.upsert({
      where:  { shop },
      update: {
        plan:            "free",
        subscriptionId:  null,
        status:          "cancelled",
        billingStartedAt:null,
        updatedAt:       new Date(),
      },
      create: {
        shop,
        plan:   "free",
        status: "cancelled",
      },
    });

    return { ...PLANS.free, status: saved.status };
  } catch (err) {
    console.error("[planUtils] cancelShopPlan error:", err);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────
// Check if shop can add a new survey
// ─────────────────────────────────────────────────────────────
export async function canAddSurvey(shop) {
  try {
    const plan  = await getShopPlanFromDB(shop);
    const count = await prisma.survey.count({ where: { shop } });
    const canAdd = plan.surveyLimit === Infinity || count < plan.surveyLimit;

    return {
      canAdd,
      current:     count,
      limit:       plan.surveyLimit,
      planName:    plan.name,
      planLabel:   plan.label,
    };
  } catch (err) {
    console.error("[planUtils] canAddSurvey error:", err);
    return {
      canAdd:    false, 
      current:   0,
      limit:     1,
      planName:  "free",
      planLabel: "Free",
    };
  }
}
