// app/routes/app.billing.jsx

import { json, redirect }    from "@remix-run/node";
import {
  useLoaderData,
  Form,
  useActionData,
  useNavigate,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";
import { useState, useEffect, useCallback } from "react";
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
  Select,
} from "@shopify/polaris";
import { authenticate }      from "../shopify.server";
import { PLANS, PLAN_KEYS }  from "../config/plans";
import {
  getShopPlanFromDB,
  updateShopPlan,
} from "../utils/planUtils";
import { getT, LANG_KEY_TO_ISO } from "../utils/translations";

const LANGUAGES_DROPDOWN = [
  { label: "🌐  Default (English)", value: "default" },
  { label: "🇫🇷  French",           value: "french" },
  { label: "🇪🇸  Spanish",          value: "spanish" },
  { label: "🇮🇹  Italian",          value: "italian" },
  { label: "🇩🇪  German",           value: "german" },
];

// ─── UI Plan definitions ───────────────────────────────────────
const PLANS_UI = [
    {
      key: "free", color: "#f6f6f7", popular: false,
      featureKeys: [
        "billing_feat_1_survey",
        "billing_feat_basic_types",
        "billing_feat_email_notif",
        "billing_feat_standard_support",
      ],
    },
    {
      key: "pro", color: "#f0f7ff", popular: true,
      featureKeys: [
        "billing_feat_5_surveys",
        "billing_feat_all_types",
        "billing_feat_priority_support",
        "billing_feat_analytics",
      ],
    },
    {
      key: "advanced", color: "#f3f0ff", popular: false,
      featureKeys: [
        "billing_feat_unlimited",
        "billing_feat_all_types",
        "billing_feat_priority_support",
        "billing_feat_export",
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
  const returnLang = formData.get("returnLang") || "default";

  if (planKey === "free") {
    await updateShopPlan(shop, "free", null);
    const redirectUrl = returnLang !== "default" ? `/app?lang=${returnLang}` : "/app";
    return redirect(redirectUrl);
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
          returnUrl: `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}/app/billing-return`,
          trialDays: 0,
          test:      true,
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
  const [searchParams, setSearchParams]     = useSearchParams();

  // ── Language from URL ──────────────────────────────────────
  const uiLanguage = searchParams.get("lang") || "default";
  const uiLangIso  = LANG_KEY_TO_ISO[uiLanguage] ?? "en";
  const t          = getT(uiLangIso);

  const withLang = useCallback(
    (path) => {
      const sep = path.includes("?") ? "&" : "?";
      return uiLanguage === "default" ? path : `${path}${sep}lang=${uiLanguage}`;
    },
    [uiLanguage],
  );

  const handleLanguageChange = useCallback(
    (value) => {
      setSearchParams((prev) => {
        if (value === "default") prev.delete("lang");
        else prev.set("lang", value);
        return prev;
      });
    },
    [setSearchParams],
  );

  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.confirmationUrl) {
      open(actionData.confirmationUrl, "_top");
    }
  }, [actionData]);

  return (
    <Page
      title={t("billing_title")}
      subtitle={t("billing_subtitle")}
      backAction={{
        content: t("billing_back"),
        onAction: () => navigate(withLang("/app")),
      }}
    >
      <BlockStack gap="500">

        {/* Language Dropdown */}
        <InlineStack align="end">
          <div style={{ minWidth: 200 }}>
            <Select
              label=""
              labelHidden
              options={LANGUAGES_DROPDOWN}
              value={uiLanguage}
              onChange={handleLanguageChange}
            />
          </div>
        </InlineStack>

        {/* Error Banner */}
        {actionData?.error && (
          <Banner title={t("billing_error")} tone="critical">
            <Text>{actionData.error}</Text>
          </Banner>
        )}

        {/* Redirecting Banner */}
        {actionData?.confirmationUrl && (
          <Banner title={t("billing_redirecting")} tone="info">
            <Text>{t("billing_redirect_wait")}</Text>
          </Banner>
        )}

        {/* Current Plan Banner */}
        <Banner
          title={t("billing_current_plan", { plan: currentPlan.toUpperCase() })}
          tone="info"
        >
          <Text>{t("billing_upgrade_hint")}</Text>
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
                        <Badge tone="info">{t("billing_most_popular")}</Badge>
                      )}
                      {isCurrent && (
                        <Badge tone="success">{t("billing_current")}</Badge>
                      )}
                    </InlineStack>
                  </InlineStack>

                  <Box paddingBlockStart="200">
                    <Text variant="heading2xl" fontWeight="bold">
                      {plan.price === 0 ? t("billing_free") : `$${plan.price}`}
                    </Text>
                    {plan.price > 0 && (
                      <Text variant="bodySm" tone="subdued">
                        {t("billing_per_month")}
                      </Text>
                    )}
                  </Box>
                </div>

                {/* Features */}
                <div style={{ padding: "20px 24px", flexGrow: 1 }}>
                  <BlockStack gap="200">
                    <Text variant="bodyMd" fontWeight="semibold">
                      {t("billing_included")}
                    </Text>
                    <List type="bullet">
                      {plan.featureKeys.map((fKey, i) => (
                        <List.Item key={i}>{t(fKey)}</List.Item>
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
                      {t("billing_current_btn")}
                    </Button>
                  ) : (
                    <Form method="post">
                      <input type="hidden" name="plan" value={plan.key} />
                      <input type="hidden" name="returnLang" value={uiLanguage} />
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
                          ? t("billing_use_free")
                          : t("billing_upgrade_to", { plan: plan.label })}
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
            {t("billing_footer")}
          </Text>
        </Box>

      </BlockStack>
    </Page>
  );
}
