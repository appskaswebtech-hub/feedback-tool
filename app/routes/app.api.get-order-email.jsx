import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  try {
    const { admin } = await authenticate.public.appProxy(request);

    // Get query parameters from URL
    const url = new URL(request.url);
    const orderId = url.searchParams.get('orderId');
    const token = url.searchParams.get('token');

    if (!orderId) {
      return json({ error: "Order ID is required" }, { status: 400 });
    }

    const response = await admin.graphql(
      `#graphql
        query getOrder($id: ID!) {
          order(id: $id) {
            email
            customer {
              email
            }
          }
        }
      `,
      {
        variables: {
          id: `gid://shopify/Order/${orderId}`,
        },
      }
    );

    const data = await response.json();
    const email = data.data.order?.email || data.data.order?.customer?.email;

    return json({ orderId });
  } catch (error) {
    console.error("Error fetching order:", error);
    return json({ error: error.message }, { status: 500 });
  }
}
