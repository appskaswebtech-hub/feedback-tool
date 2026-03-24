import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Handle OPTIONS preflight request
export const OPTIONS = async () => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
};

/**
 * GET request handler - Returns survey title based on shop and language code
 * Multi-tenant version
 * 
 * Query params:
 * - shop (REQUIRED): Shop domain for multi-tenancy
 * - lang (optional): Language code 'en' or 'fr' (default: 'en')
 * 
 * Usage: /api/proxy/survey-title?shop=mystore.myshopify.com&lang=fr
 */
export const loader = async ({ request }) => {
  try {
    // Get parameters from URL
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");
    const lang = url.searchParams.get("lang") || "en"; // Default to English

    // Validate shop parameter (REQUIRED for multi-tenancy)
    if (!shop) {
      return new Response(
        JSON.stringify({
          error: "Missing required 'shop' parameter",
          message: "Please provide shop parameter for multi-tenancy",
          hint: "Include ?shop=mystore.myshopify.com in your request"
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }

    // Validate language code
    if (!["en", "fr"].includes(lang)) {
      return new Response(
        JSON.stringify({ 
          error: "Invalid language code. Use 'en' or 'fr'",
          shop: shop
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }

    // Determine if we should fetch French version
    const isFrenchVersion = lang === "fr";

    // Fetch the survey based on shop and language (multi-tenancy)
    const survey = await prisma.survey.findFirst({
      where: {
        shop: shop, // Filter by shop for multi-tenancy
        isFrenchVersion: isFrenchVersion,
      },
      select: {
        id: true,
        title: true,
        isFrenchVersion: true,
        shop: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc', // Get the most recent survey if multiple exist
      },
    });

    if (!survey) {
      return new Response(
        JSON.stringify({
          error: `No ${lang === "fr" ? "French" : "English"} survey found`,
          message: `No survey found for shop: ${shop} with language: ${lang}`,
          shop: shop,
          language: lang,
          hint: `Please create a survey with ${lang === "fr" ? "French version enabled" : "French version disabled"} for this shop`
        }),
        {
          status: 404,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }

    return new Response(
      JSON.stringify({
        surveyId: survey.id,
        surveyTitle: survey.title,
        language: lang,
        isFrenchVersion: survey.isFrenchVersion,
        shop: survey.shop,
        createdAt: survey.createdAt
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  } catch (error) {
    console.error("Error fetching survey title:", error);
    return new Response(
      JSON.stringify({ 
        error: "Internal server error", 
        details: error.message 
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }
};

/**
 * POST request handler - Alternative method with JSON body
 * 
 * Expected body:
 * {
 *   "shop": "mystore.myshopify.com",  // REQUIRED
 *   "lang": "fr"  // optional, default: "en"
 * }
 */
export const action = async ({ request }) => {
  try {
    const data = await request.json();
    const { shop, lang = "en" } = data;

    console.log("POST request received:", { shop, lang });

    // Validate shop parameter (REQUIRED for multi-tenancy)
    if (!shop) {
      return new Response(
        JSON.stringify({
          error: "Missing required 'shop' parameter",
          message: "Please provide 'shop' in the request body"
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }

    // Validate language code
    if (!["en", "fr"].includes(lang)) {
      return new Response(
        JSON.stringify({ 
          error: "Invalid language code. Use 'en' or 'fr'",
          shop: shop
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }

    // Determine if we should fetch French version
    const isFrenchVersion = lang === "fr";

    // Fetch the survey based on shop and language (multi-tenancy)
    const survey = await prisma.survey.findFirst({
      where: {
        shop: shop, // Filter by shop for multi-tenancy
        isFrenchVersion: isFrenchVersion,
      },
      select: {
        id: true,
        title: true,
        isFrenchVersion: true,
        shop: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!survey) {
      return new Response(
        JSON.stringify({
          error: `No ${lang === "fr" ? "French" : "English"} survey found`,
          message: `No survey found for shop: ${shop} with language: ${lang}`,
          shop: shop,
          language: lang,
          hint: `Please create a survey with ${lang === "fr" ? "French version enabled" : "French version disabled"} for this shop`
        }),
        {
          status: 404,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }

    return new Response(
      JSON.stringify({
        surveyId: survey.id,
        surveyTitle: survey.title,
        language: lang,
        isFrenchVersion: survey.isFrenchVersion,
        shop: survey.shop,
        createdAt: survey.createdAt
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  } catch (error) {
    console.error("Error fetching survey title (POST):", error);
    return new Response(
      JSON.stringify({ 
        error: "Internal server error", 
        details: error.message 
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }
};
