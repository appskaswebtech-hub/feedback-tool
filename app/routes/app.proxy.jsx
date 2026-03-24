import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// CORS headers - defined once, used everywhere
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
  "Access-Control-Max-Age": "86400",
};

// Handle OPTIONS preflight requests (CRITICAL for CORS)
export async function OPTIONS() {
  console.log("✅ OPTIONS request received");
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * Handle ALL GET requests with query parameters
 * Multi-tenant version - requires 'shop' parameter
 * 
 * Query params:
 * - shop (REQUIRED): Shop domain for multi-tenancy
 * - shopDomain: Customer's shop domain (optional, for display)
 * - email: Customer email
 * - surveyTitle: Survey title
 * - orderId: Order ID
 * - answers: JSON string of answers
 */
export async function loader({ request }) {
  console.log("✅ GET request received in loader");

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop"); // REQUIRED for multi-tenancy
  const shopDomain = url.searchParams.get("shopDomain");
  const email = url.searchParams.get("email");
  const surveyTitle = url.searchParams.get("surveyTitle");
  const orderId = url.searchParams.get("orderId");
  const answersString = url.searchParams.get("answers");

  // Validate shop parameter (CRITICAL for multi-tenancy)
  if (!shop) {
    console.error("❌ Missing required 'shop' parameter");
    return new Response(
      JSON.stringify({
        message: "Failed",
        error: "Missing required 'shop' parameter for multi-tenancy",
        hint: "Include ?shop=mystore.myshopify.com in your request"
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        }
      }
    );
  }

  // If query params are present, process the data
  if (email && surveyTitle && orderId && answersString) {
    try {
      const answers = JSON.parse(answersString);
      console.log("Received data from query params:", { 
        shop, 
        shopDomain, 
        email, 
        surveyTitle, 
        orderId, 
        answers 
      });

      // Filter out null/undefined values and invalid answers
      const validAnswers = answers.filter(answer => 
        answer !== null && 
        answer !== undefined && 
        answer.questionTitle && 
        answer.questionTitle.trim() !== ''
      );
      
      console.log("Valid answers after filtering:", validAnswers);

      // Check if record already exists for THIS SHOP
      const existingRecord = await prisma.apiProxyData.findFirst({
        where: { 
          orderId: orderId,
          shop: shop, // Multi-tenant filter
        },
      });
      console.log("existingRecord=", existingRecord);

      // Validate that survey exists in THIS SHOP's database
      const survey = await prisma.survey.findFirst({
        where: {
          title: surveyTitle,
          shop: shop, // Multi-tenant filter
        },
        include: {
          questions: true,
        },
      });

      if (!survey) {
        console.log(`⚠️ Survey "${surveyTitle}" not found for shop: ${shop}`);
        return new Response(
          JSON.stringify({
            message: "Failed",
            error: `Survey "${surveyTitle}" not found for this shop`,
            shop: shop
          }),
          {
            status: 404,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            }
          }
        );
      }

      // Validate that all questions exist in THIS SHOP's survey
      for (const answer of validAnswers) {
        const question = survey.questions.find(q => q.text === answer.questionTitle);
        if (!question) {
          console.log(`⚠️ Question "${answer.questionTitle}" not found in shop's survey`);
          // Just log warning, don't throw error
        }
      }

      // Update or create the record with shop association
      if (existingRecord) {
        await prisma.apiProxyData.update({
          where: { id: existingRecord.id },
          data: {
            email: email,
            surveyTitle: surveyTitle,
            answers: JSON.stringify(validAnswers),
            shopDomain: shopDomain || existingRecord.shopDomain,
          },
        });
        console.log("✅ Updated existing record for orderId:", orderId, "shop:", shop);
      } else {
        await prisma.apiProxyData.create({
          data: {
            shop: shop, // CRITICAL: Associate with shop for multi-tenancy
            shopDomain: shopDomain,
            email: email,
            surveyTitle: surveyTitle,
            orderId: orderId,
            answers: JSON.stringify(validAnswers),
          },
        });
        console.log("✅ Created new record for orderId:", orderId, "shop:", shop);
      }

      return new Response(
        JSON.stringify({
          message: "Success",
          shop: shop,
          receivedData: { 
            shop,
            shopDomain, 
            email, 
            surveyTitle, 
            orderId, 
            answers: validAnswers,
            surveyFound: true,
            questionsValidated: true
          }
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          }
        }
      );

    } catch (error) {
      console.error("❌ Error:", error);
      return new Response(
        JSON.stringify({
          message: "Failed",
          shop: shop,
          error: error.message
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          }
        }
      );
    }
  }

  // If no params, just return a simple response with shop info
  return new Response(
    JSON.stringify({
      message: "Proxy endpoint is working",
      method: "GET",
      shop: shop,
      multiTenant: true,
      hint: "Include query parameters: shop, email, surveyTitle, orderId, answers"
    }),
    {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      }
    }
  );
}

/**
 * Handle POST requests (alternative to GET with query params)
 * Multi-tenant version
 * 
 * Expected body:
 * {
 *   "shop": "mystore.myshopify.com",  // REQUIRED
 *   "shopDomain": "mystore.myshopify.com",
 *   "email": "customer@example.com",
 *   "surveyTitle": "Customer Survey",
 *   "orderId": "12345",
 *   "answers": [...]
 * }
 */
export async function action({ request }) {
  console.log("✅ POST request received in action");

  try {
    const data = await request.json();
    const { shop, shopDomain, email, surveyTitle, orderId, answers } = data;

    console.log("Received POST data:", data);

    // Validate shop parameter (CRITICAL for multi-tenancy)
    if (!shop) {
      console.error("❌ Missing required 'shop' parameter");
      return new Response(
        JSON.stringify({
          message: "Failed",
          error: "Missing required 'shop' parameter for multi-tenancy",
          hint: "Include 'shop' in your request body"
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          }
        }
      );
    }

    // Validate required fields
    if (!email || !surveyTitle || !orderId || !answers) {
      return new Response(
        JSON.stringify({
          message: "Failed",
          error: "Missing required fields: email, surveyTitle, orderId, or answers"
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          }
        }
      );
    }

    // Filter out null/undefined values and invalid answers
    const validAnswers = answers.filter(answer => 
      answer !== null && 
      answer !== undefined && 
      answer.questionTitle && 
      answer.questionTitle.trim() !== ''
    );
    
    console.log("Valid answers after filtering:", validAnswers);

    // Check if record already exists for THIS SHOP
    const existingRecord = await prisma.apiProxyData.findFirst({
      where: { 
        orderId: orderId,
        shop: shop, // Multi-tenant filter
      },
    });

    // Validate that survey exists in THIS SHOP's database
    const survey = await prisma.survey.findFirst({
      where: {
        title: surveyTitle,
        shop: shop, // Multi-tenant filter
      },
      include: {
        questions: true,
      },
    });

    if (!survey) {
      console.log(`⚠️ Survey "${surveyTitle}" not found for shop: ${shop}`);
      return new Response(
        JSON.stringify({
          message: "Failed",
          error: `Survey "${surveyTitle}" not found for this shop`,
          shop: shop
        }),
        {
          status: 404,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          }
        }
      );
    }

    // Update or create the record with shop association
    if (existingRecord) {
      await prisma.apiProxyData.update({
        where: { id: existingRecord.id },
        data: {
          email: email,
          surveyTitle: surveyTitle,
          answers: JSON.stringify(validAnswers),
          shopDomain: shopDomain || existingRecord.shopDomain,
        },
      });
      console.log("✅ Updated existing record for orderId:", orderId, "shop:", shop);
    } else {
      await prisma.apiProxyData.create({
        data: {
          shop: shop, // CRITICAL: Associate with shop for multi-tenancy
          shopDomain: shopDomain,
          email: email,
          surveyTitle: surveyTitle,
          orderId: orderId,
          answers: JSON.stringify(validAnswers),
        },
      });
      console.log("✅ Created new record for orderId:", orderId, "shop:", shop);
    }

    return new Response(
      JSON.stringify({
        message: "Success",
        shop: shop,
        receivedData: { 
          shop,
          shopDomain, 
          email, 
          surveyTitle, 
          orderId, 
          answers: validAnswers,
          surveyFound: true
        }
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        }
      }
    );

  } catch (error) {
    console.error("❌ Error in POST:", error);
    return new Response(
      JSON.stringify({
        message: "Failed",
        error: error.message
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        }
      }
    );
  }
}
