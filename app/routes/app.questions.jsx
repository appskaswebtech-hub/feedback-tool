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
 * GET request handler - Fetch surveys based on shop
 * Query params: ?shop=mystore.myshopify.com
 */
export const loader = async ({ request }) => {
  try {
    // Get shop from URL query parameters
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");

    // Validate shop parameter
    if (!shop) {
      return new Response(
        JSON.stringify({ 
          error: "Missing shop parameter",
          message: "Please provide shop parameter in the URL"
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

    // Fetch surveys filtered by shop (multi-tenancy)
    const surveys = await prisma.survey.findMany({
      where: {
        shop: shop, // Filter by shop
      },
      include: {
        questions: {
          include: {
            answers: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // If no surveys found for this shop
    if (surveys.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: "No surveys found",
          message: `No surveys found for shop: ${shop}`,
          shop: shop
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
        surveys,
        shop: shop,
        count: surveys.length
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
    console.error("Error fetching surveys:", error);
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
 * POST request handler - Fetch surveys based on shop from request body
 * Expected body: { shop: "mystore.myshopify.com", isFrench: true/false }
 */
export const action = async ({ request }) => {
  try {
    const data = await request.json();
    console.log("Received data:", data);

    const { shop, isFrench } = data;

    // Validate shop parameter
    if (!shop) {
      return new Response(
        JSON.stringify({ 
          error: "Missing shop parameter",
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

    // Build query filter
    const whereClause = {
      shop: shop, // Filter by shop (multi-tenancy)
    };

    // Add French filter if specified
    if (isFrench !== undefined) {
      whereClause.isFrenchVersion = isFrench;
    }

    // Fetch surveys filtered by shop and optionally by language
    const surveys = await prisma.survey.findMany({
      where: whereClause,
      include: {
        questions: {
          include: {
            answers: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // If no surveys found
    if (surveys.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: "No surveys found",
          message: isFrench !== undefined 
            ? `No ${isFrench ? 'French' : 'English'} surveys found for shop: ${shop}`
            : `No surveys found for shop: ${shop}`,
          shop: shop,
          isFrench: isFrench
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
        surveys,
        shop: shop,
        isFrench: isFrench,
        count: surveys.length
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
    console.error("Error processing request:", error);
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
