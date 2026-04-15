// app/routes/app.billing-return.jsx
//
// Shopify redirects here after the merchant approves (or cancels) billing.
// This is where we ACTUALLY update the ShopPlan table — only after confirmation.

import { json }      from "@remix-run/node";
import { useEffect } from "react";
import { useNavigate, useLoaderData, useSearchParams } from "@remix-run/react";
import { Page, Spinner, BlockStack, Text, Banner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { PLANS }        from "../config/plans";
import { updateShopPlan } from "../utils/planUtils";
import { getT, LANG_KEY_TO_ISO } from "../utils/translations";

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
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    const response = await admin.graphql(ACTIVE_SUBSCRIPTION_QUERY);
    const data     = await response.json();

    const activeSubscriptions =
      data?.data?.currentAppInstallation?.activeSubscriptions ?? [];

    const activeSub = activeSubscriptions.find(
      (sub) => sub.status === "ACTIVE"
    );

    if (activeSub) {
      const planKey  = activeSub.name.toLowerCase();
      const planMeta = PLANS[planKey];

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
  const [searchParams] = useSearchParams();

  // ── Language from URL ──────────────────────────────────────
  const uiLanguage = searchParams.get("lang") || "default";
  const uiLangIso  = LANG_KEY_TO_ISO[uiLanguage] ?? "en";
  const t          = getT(uiLangIso);

  const billingUrl = uiLanguage === "default"
    ? "/app/billing"
    : `/app/billing?lang=${uiLanguage}`;

  useEffect(() => {
    const timer = setTimeout(() => navigate(billingUrl), 5000);
    return () => clearTimeout(timer);
  }, [navigate, billingUrl]);

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
            <Banner tone="success" title={t("billing_return_success")}>
              <Text>
                {t("billing_return_now_on", { plan: plan.label ?? plan.name })}
              </Text>
            </Banner>
          ) : (
            <Banner tone="warning" title={t("billing_return_fail")}>
              <Text>
                {t("billing_return_fail_desc")}
              </Text>
            </Banner>
          )}
          <Spinner size="large" />
          <Text tone="subdued" variant="bodySm">
            {t("billing_return_redirect")}
          </Text>
        </BlockStack>
      </div>
    </Page>
  );
}
