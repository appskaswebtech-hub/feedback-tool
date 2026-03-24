import { json }      from "@remix-run/node";
import { useEffect } from "react";
import { useNavigate, useLoaderData } from "@remix-run/react";
import { Page, Spinner, BlockStack, Text, Banner } from "@shopify/polaris";
import { authenticate }        from "../shopify.server";
import { syncPlanFromShopify } from "../utils/planUtils";

export const loader = async ({ request }) => {
  // ✅ authenticate.admin() uses ?shop= param to find session
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    const plan = await syncPlanFromShopify(admin, shop);
    console.log(`[billing-return] Plan synced for ${shop}:`, plan.name);
    return json({ ok: true, plan });
  } catch (err) {
    console.error("[billing-return] error:", err);
    return json({ ok: false, plan: null });
  }
};

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
