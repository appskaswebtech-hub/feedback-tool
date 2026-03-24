// app/utils/getActivePlan.js
import { PLANS } from "../config/plans";

export async function getActivePlan(admin) {
  try {
    const response = await admin.graphql(
      `#graphql
      query GetRecurringApplicationCharges {
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

    // ✅ Docs use: const json = await response.json(); return json.data;
    const json = await response.json();
    const subscriptions =
      json.data?.currentAppInstallation?.activeSubscriptions ?? [];

    const active = subscriptions.find(
      (sub) =>
        sub.status === "ACTIVE" &&
        PLANS[sub.name.toLowerCase()]
    );

    return active ? PLANS[active.name.toLowerCase()] : PLANS.free;

  } catch (err) {
    console.error("getActivePlan error:", err);
    return PLANS.free;
  }
}
