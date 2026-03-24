import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  console.log("🎯 Webhook received at:", new Date().toISOString());

  try {
    // Authenticate and verify HMAC signature
    // This will automatically throw an error if HMAC is invalid
    const { topic, shop, payload } = await authenticate.webhook(request);

    console.log("✅ HMAC verification passed");
    console.log(`✅ Topic: ${topic}`);
    console.log(`✅ Shop: ${shop}`);
    console.log(`✅ Payload:`, payload);

    // Handle each webhook topic
    switch (topic) {
      case "CUSTOMERS_DATA_REQUEST":
        console.log("📋 Processing customer data request");
        // TODO: If you store customer data, gather and send it to store owner
        await handleCustomerDataRequest(payload, shop);
        break;

      case "CUSTOMERS_REDACT":
        console.log("🗑️ Processing customer redaction");
        // TODO: Delete customer data from your database
        await handleCustomerRedact(payload, shop);
        break;

      case "SHOP_REDACT":
        console.log("🗑️ Processing shop redaction");
        // TODO: Delete all shop data from your database
        await handleShopRedact(payload, shop);
        break;

      default:
        console.log(`⚠️ Unhandled webhook topic: ${topic}`);
    }

    // Always return 200 OK for successfully processed webhooks
    return new Response("Webhook processed successfully", { 
      status: 200,
      headers: { "Content-Type": "text/plain" }
    });

  } catch (error) {
    // Log the full error for debugging
    console.error("❌ Webhook error:", error);
    console.error("Error details:", {
      message: error.message,
      name: error.name,
      stack: error.stack
    });

    // Check if it's an authentication/HMAC error
    // Return 401 for invalid HMAC signatures
    if (
      error.message?.toLowerCase().includes("hmac") ||
      error.message?.toLowerCase().includes("unauthorized") ||
      error.message?.toLowerCase().includes("authentication") ||
      error.message?.toLowerCase().includes("invalid") ||
      error.status === 401
    ) {
      console.log("❌ Returning 401 - HMAC verification failed");
      return new Response("Unauthorized - Invalid HMAC signature", { 
        status: 401,
        headers: { "Content-Type": "text/plain" }
      });
    }

    // For other errors, return 500
    console.log("❌ Returning 500 - Internal server error");
    return new Response("Internal Server Error", { 
      status: 500,
      headers: { "Content-Type": "text/plain" }
    });
  }
};

// Handler functions
async function handleCustomerDataRequest(payload, shop) {
  // If you don't store customer data, just log it
  console.log(`No customer data stored for shop: ${shop}`);
  
  // If you DO store customer data, implement this:
  // const customerData = await db.getCustomerData(payload.customer.id);
  // await sendDataToStoreOwner(shop, customerData);
}

async function handleCustomerRedact(payload, shop) {
  // If you don't store customer data, just log it
  console.log(`No customer data to redact for shop: ${shop}`);
  
  // If you DO store customer data, implement this:
  // await db.deleteCustomerData(payload.customer.id);
  // await db.deleteOrderData(payload.orders_to_redact);
}

async function handleShopRedact(payload, shop) {
  // Delete all shop data (triggered 48 hours after uninstall)
  console.log(`Shop data redaction requested for: ${shop}`);
  
  // Implement your data deletion logic:
  // await db.deleteShopData(payload.shop_id);
  // await db.deleteAllSessions(shop);
}