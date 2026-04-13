// app/routes/app.billing.jsx

import { json, redirect }    from "@remix-run/node";
import {
  useLoaderData,
  Form,
  useActionData,
  useNavigate,
  useNavigation,
} from "@remix-run/react";
import { useState, useEffect } from "react";
import {
  Page,
  Button,
  BlockStack,
  Text,
  Box,
  InlineStack,
  InlineGrid,
  Banner,
  Badge,
  List,
} from "@shopify/polaris";
import { authenticate }      from "../shopify.server";
import { PLANS, PLAN_KEYS }  from "../config/plans";
import {
  getShopPlanFromDB,
  updateShopPlan,
} from "../utils/planUtils";

// ─── UI Plan definitions ───────────────────────────────────────
const PLANS_UI = [
  {
    key:      "free",
    color:    "#f6f6f7",
    popular:  false,
    features: [
      "1 Survey",
      "Basic question types",
      "Email notifications",
      "Standard support",
    ],
  },
  {
    key:      "pro",
    color:    "#f0f7ff",
    popular:  true,
    features: [
      "Up to 5 Surveys",
      "All question types",
      "Priority support",
      "Analytics & Charts",
    ],
  },
  {
    key:      "advanced",
    color:    "#f3f0ff",
    popular:  false,
    features: [
      "Unlimited Surveys",
      "All question types",
      "Priority support",
      "Export responses",
    ],
  },
].map((ui) => ({ ...ui, ...PLANS[ui.key] }));

// ─── LOADER ───────────────────────────────────────────────────
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const plan = await getShopPlanFromDB(session.shop);
  return json({ currentPlan: plan.name });
};

// ─── ACTION ───────────────────────────────────────────────────
export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop     = session.shop;
  const formData = await request.formData();
  const planKey  = formData.get("plan");

  if (planKey === "free") {
    await updateShopPlan(shop, "free", null);
    return redirect("/app");
  }

  if (!PLAN_KEYS.includes(planKey)) {
    return json({ error: `Invalid plan: "${planKey}"` }, { status: 400 });
  }

  const selectedPlan = PLANS[planKey];

  try {
    const response = await admin.graphql(
      `#graphql
      mutation AppSubscriptionCreate(
        $name:      String!,
        $lineItems: [AppSubscriptionLineItemInput!]!,
        $returnUrl: URL!,
        $trialDays: Int,
        $test:      Boolean
      ) {
        appSubscriptionCreate(
          name:      $name,
          returnUrl: $returnUrl,
          lineItems: $lineItems,
          trialDays: $trialDays,
          test:      $test
        ) {
          userErrors {
            field
            message
          }
          appSubscription {
            id
          }
          confirmationUrl
        }
      }`,
      {
        variables: {
          name: planKey,

          // ✅ Uses Shopify Admin URL — tunnel URL is irrelevant here
          returnUrl: `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}/app/billing-return`,

          trialDays: 0,
          test:      true, // ← set false in production
          lineItems: [
            {
              plan: {
                appRecurringPricingDetails: {
                  price: {
                    amount:       selectedPlan.price,
                    currencyCode: "USD",
                  },
                  interval: "EVERY_30_DAYS",
                },
              },
            },
          ],
        },
      }
    );

    const responseData = await response.json();
    const { confirmationUrl, userErrors } =
      responseData.data?.appSubscriptionCreate ?? {};

    if (userErrors?.length > 0) {
      console.error("[app.billing] userErrors:", userErrors);
      return json(
        { error: userErrors.map((e) => e.message).join(", ") },
        { status: 400 }
      );
    }

    if (!confirmationUrl) {
      return json(
        { error: "No confirmation URL returned from Shopify." },
        { status: 500 }
      );
    }

    // ✅ DO NOT update DB here — wait for payment confirmation
    // DB is updated in app.billing-return.jsx after Shopify redirects back
    return json({ confirmationUrl });

  } catch (err) {
    console.error("[app.billing] action error:", err);
    return json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
};

// ─── COMPONENT ────────────────────────────────────────────────
export default function BillingPage() {
  const { currentPlan } = useLoaderData();
  const actionData      = useActionData();
  const navigate        = useNavigate();
  const navigation      = useNavigation();
  const [submittingPlan, setSubmittingPlan] = useState(null);

  const isSubmitting = navigation.state === "submitting";

  // ✅ Escape Shopify iframe → open billing confirmation page
  useEffect(() => {
    if (actionData?.confirmationUrl) {
      open(actionData.confirmationUrl, "_top");
    }
  }, [actionData]);

  return (
    <Page
      title="Choose Your Plan"
      subtitle="Upgrade anytime to unlock more surveys and features"
      backAction={{
        content: "Back",
        onAction: () => navigate("/app"),
      }}
    >
      <BlockStack gap="500">
        <InlineStack align="end">
          <div style={{ minWidth: 200 }}>
            <Select
              label=""
              labelHidden
              options={[
                { label: "🌐 Default (English)", value: "default" },
                { label: "🇫🇷 French", value: "french" },
                { label: "🇪🇸 Spanish", value: "spanish" },
                { label: "🇮🇹 Italian", value: "italian" },
                { label: "🇩🇪 German", value: "german" },
              ]}
              value={uiLanguage}
              onChange={(value) => {
                setSearchParams((prev) => {
                  if (value === "default") prev.delete("lang");
                  else prev.set("lang", value);
                  return prev;
                });
              }}
            />
          </div>
        </InlineStack>

        {/* Error Banner */}
        {actionData?.error && (
          <Banner title="Billing Error" tone="critical">
            <Text>{actionData.error}</Text>
          </Banner>
        )}

        {/* Redirecting Banner */}
        {actionData?.confirmationUrl && (
          <Banner title="Redirecting to Shopify billing..." tone="info">
            <Text>
              Please wait while we redirect you to confirm your subscription.
            </Text>
          </Banner>
        )}

        {/* Current Plan Banner */}
        <Banner
          title={`You are currently on the ${currentPlan.toUpperCase()} plan`}
          tone="info"
        >
          <Text>
            Upgrade below to unlock more surveys and premium features.
          </Text>
        </Banner>

        {/* Pricing Cards */}
        <InlineGrid columns={{ xs: 1, sm: 1, md: 3 }} gap="400">
          {PLANS_UI.map((plan) => {
            const isCurrent = currentPlan === plan.key;

            return (
              <div
                key={plan.key}
                style={{
                  borderRadius: "12px",
                  border: isCurrent
                    ? "2px solid #008060"
                    : plan.popular
                    ? "2px solid #005bd3"
                    : "1px solid #e1e3e5",
                  background:    "#ffffff",
                  boxShadow:     plan.popular
                    ? "0 4px 20px rgba(0,91,211,0.12)"
                    : "0 1px 4px rgba(0,0,0,0.06)",
                  display:       "flex",
                  flexDirection: "column",
                  overflow:      "hidden",
                }}
              >
                {/* Card Header */}
                <div
                  style={{
                    background:   plan.color,
                    padding:      "20px 24px 16px",
                    borderBottom: "1px solid #e1e3e5",
                  }}
                >
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingLg" fontWeight="bold">
                      {plan.label}
                    </Text>
                    <InlineStack gap="200">
                      {plan.popular && (
                        <Badge tone="info">Most Popular</Badge>
                      )}
                      {isCurrent && (
                        <Badge tone="success">Current</Badge>
                      )}
                    </InlineStack>
                  </InlineStack>

                  <Box paddingBlockStart="200">
                    <Text variant="heading2xl" fontWeight="bold">
                      {plan.price === 0 ? "Free" : `$${plan.price}`}
                    </Text>
                    {plan.price > 0 && (
                      <Text variant="bodySm" tone="subdued">
                        per month
                      </Text>
                    )}
                  </Box>
                </div>

                {/* Features */}
                <div style={{ padding: "20px 24px", flexGrow: 1 }}>
                  <BlockStack gap="200">
                    <Text variant="bodyMd" fontWeight="semibold">
                      What's included:
                    </Text>
                    <List type="bullet">
                      {plan.features.map((f, i) => (
                        <List.Item key={i}>{f}</List.Item>
                      ))}
                    </List>
                  </BlockStack>
                </div>

                {/* CTA */}
                <div
                  style={{
                    padding:   "16px 24px",
                    borderTop: "1px solid #e1e3e5",
                  }}
                >
                  {isCurrent ? (
                    <Button fullWidth disabled>
                      ✓ Current Plan
                    </Button>
                  ) : (
                    <Form method="post">
                      <input type="hidden" name="plan" value={plan.key} />
                      <Button
                        fullWidth
                        variant={plan.price > 0 ? "primary" : "secondary"}
                        submit
                        loading={
                          (isSubmitting && submittingPlan === plan.key) ||
                          !!actionData?.confirmationUrl
                        }
                        onClick={() => setSubmittingPlan(plan.key)}
                      >
                        {plan.price === 0
                          ? "Use Free Plan"
                          : `Upgrade to ${plan.label}`}
                      </Button>
                    </Form>
                  )}
                </div>
              </div>
            );
          })}
        </InlineGrid>

        {/* Footer */}
        <Box paddingBlockEnd="400">
          <Text alignment="center" tone="subdued" variant="bodySm">
            Cancel anytime from your Shopify admin. Billed in USD.
          </Text>
        </Box>

      </BlockStack>
    </Page>
  );
}
