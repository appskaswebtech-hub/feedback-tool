// app/routes/app.billing-return.jsx
//
// Shopify redirects here after the merchant approves (or cancels) billing.
// This is where we ACTUALLY update the ShopPlan table — only after confirmation.

import { json }      from "@remix-run/node";
import { useEffect } from "react";
import { useNavigate, useLoaderData } from "@remix-run/react";
import { Page, Spinner, BlockStack, Text, Banner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { PLANS }        from "../config/plans";
import { updateShopPlan } from "../utils/planUtils";

// ─── GraphQL: fetch the current active subscription from Shopify ───
const ACTIVE_SUBSCRIPTION_QUERY = `#graphql
  query {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
      }
    }
  }
`;

// ─── LOADER ───────────────────────────────────────────────────────
export const loader = async ({ request }) => {
  // authenticate.admin() uses the ?shop= param Shopify appends to the returnUrl
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    // 1. Query Shopify for the active subscription
    const response = await admin.graphql(ACTIVE_SUBSCRIPTION_QUERY);
    const data     = await response.json();

    const activeSubscriptions =
      data?.data?.currentAppInstallation?.activeSubscriptions ?? [];

    // 2. Find the first ACTIVE subscription
    const activeSub = activeSubscriptions.find(
      (sub) => sub.status === "ACTIVE"
    );

    if (activeSub) {
      // activeSub.name is the planKey passed as `name` in AppSubscriptionCreate
      // e.g. "pro" or "advanced"
      const planKey  = activeSub.name.toLowerCase();
      const planMeta = PLANS[planKey];

      // 3. ✅ Update ShopPlan table NOW — after payment is confirmed
      await updateShopPlan(shop, planKey, activeSub.id);

      console.log(`[billing-return] ✅ Plan updated → ${planKey} for ${shop}`);

      return json({
        ok:   true,
        plan: {
          name:  planKey,
          label: planMeta?.label ?? planKey,
        },
      });
    }

    // No active subscription — merchant cancelled or declined payment
    console.warn(
      `[billing-return] ⚠️ No ACTIVE subscription found for ${shop}. Resetting to free.`
    );
    await updateShopPlan(shop, "free", null);

    return json({ ok: false, plan: null });

  } catch (err) {
    console.error("[billing-return] error:", err);
    return json({ ok: false, plan: null });
  }
};

// ─── COMPONENT ────────────────────────────────────────────────────
export default function BillingReturnPage() {
  const { ok, plan } = useLoaderData();
  const navigate     = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => navigate("/app/billing"), 5000);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <Page>
      <div
        style={{
          display:        "flex",
          flexDirection:  "column",
          alignItems:     "center",
          justifyContent: "center",
          minHeight:      "60vh",
          gap:            "24px",
        }}
      >
        <BlockStack gap="400" inlineAlign="center">
          {ok && plan ? (
            <Banner tone="success" title="Plan activated successfully!">
              <Text>
                You are now on the <strong>{plan.label ?? plan.name}</strong> plan.
                Redirecting you back to the app...
              </Text>
            </Banner>
          ) : (
            <Banner tone="warning" title="Could not confirm plan.">
              <Text>
                Redirecting you back. Please check your plan status in the app.
              </Text>
            </Banner>
          )}
          <Spinner size="large" />
          <Text tone="subdued" variant="bodySm">
            Redirecting in 5 seconds...
          </Text>
        </BlockStack>
      </div>
    </Page>
  );
}
