import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ─── CORS headers ─────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ─── Language → survey `language` field map ───────────────────
const LANG_TO_SURVEY = {
  en: "default",
  fr: "french",
  es: "spanish",
  it: "italian",
  de: "german",   // ← ADD
};

const VALID_LANGS = Object.keys(LANG_TO_SURVEY); // ["en","fr","es","it"]

const LANG_LABELS = {
  en: "English",
  fr: "French",
  es: "Spanish",
  it: "Italian",
  de: "German",   // ← ADD
};
// ─── Shared lookup logic ──────────────────────────────────────
/**
 * Finds the survey for a given shop + language code.
 * Falls back to isFrenchVersion for backward-compat (French only).
 */
async function findSurvey(shop, lang) {
  const surveyLang = LANG_TO_SURVEY[lang]; // e.g. "spanish"

  // Primary lookup — by new `language` field
  let survey = await prisma.survey.findFirst({
    where: { shop, language: surveyLang },
    select: {
      id:              true,
      title:           true,
      language:        true,
      isFrenchVersion: true,
      shop:            true,
      createdAt:       true,
    },
    orderBy: { createdAt: "desc" },
  });

  // Backward-compat fallback for French (old rows may not have `language` set)
  if (!survey && lang === "fr") {
    survey = await prisma.survey.findFirst({
      where: { shop, isFrenchVersion: true },
      select: {
        id:              true,
        title:           true,
        language:        true,
        isFrenchVersion: true,
        shop:            true,
        createdAt:       true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  return survey;
}

// ─── JSON response helper ─────────────────────────────────────
const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

// ─── OPTIONS preflight ────────────────────────────────────────
export const OPTIONS = async () =>
  new Response(null, { status: 204, headers: corsHeaders });

// ─── GET handler ──────────────────────────────────────────────
/**
 * Returns survey title based on shop and language code.
 *
 * Query params:
 *   shop (REQUIRED) — e.g. mystore.myshopify.com
 *   lang (optional) — "en" | "fr" | "es" | "it"  (default: "en")
 *
 * Example: /app/survey?shop=mystore.myshopify.com&lang=es
 */
export const loader = async ({ request }) => {
  try {
    const url  = new URL(request.url);
    const shop = url.searchParams.get("shop");
    const lang = (url.searchParams.get("lang") || "en").toLowerCase();

    // ── Validate shop ─────────────────────────────────────────
    if (!shop) {
      return jsonResponse({
        error:   "Missing required 'shop' parameter",
        message: "Please provide shop parameter for multi-tenancy",
        hint:    "Include ?shop=mystore.myshopify.com in your request",
      }, 400);
    }

    // ── Validate language ─────────────────────────────────────
    if (!VALID_LANGS.includes(lang)) {
      return jsonResponse({
        error:          `Invalid language code "${lang}". Use one of: ${VALID_LANGS.join(", ")}`,
        shop,
        validLanguages: VALID_LANGS,
      }, 400);
    }

    // ── Find survey ───────────────────────────────────────────
    const survey = await findSurvey(shop, lang);

    if (!survey) {
      // Try falling back to the default (English) survey
      const fallback = await prisma.survey.findFirst({
        where: { shop, language: "default" },
        select: { id: true, title: true, language: true, isFrenchVersion: true, shop: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      });

      if (fallback) {
        console.warn(`[survey-title] No ${LANG_LABELS[lang]} survey found for ${shop}, using default`);
        return jsonResponse({
          surveyId:        fallback.id,
          surveyTitle:     fallback.title,
          language:        "en",
          surveyLanguage:  fallback.language,
          isFrenchVersion: fallback.isFrenchVersion,
          shop:            fallback.shop,
          createdAt:       fallback.createdAt,
          fallback:        true,   // lets the client know this is a fallback
        });
      }

      return jsonResponse({
        error:   `No ${LANG_LABELS[lang]} survey found`,
        message: `No survey found for shop: ${shop} with language: ${lang}`,
        shop,
        language:       lang,
        surveyLanguage: LANG_TO_SURVEY[lang],
        hint:           `Create a survey with language "${LANG_TO_SURVEY[lang]}" for this shop`,
      }, 404);
    }

    return jsonResponse({
      surveyId:        survey.id,
      surveyTitle:     survey.title,
      language:        lang,
      surveyLanguage:  survey.language,
      isFrenchVersion: survey.isFrenchVersion,
      shop:            survey.shop,
      createdAt:       survey.createdAt,
    });

  } catch (error) {
    console.error("[survey-title] GET error:", error);
    return jsonResponse({ error: "Internal server error", details: error.message }, 500);
  }
};

// ─── POST handler ─────────────────────────────────────────────
/**
 * Alternative POST method.
 *
 * Body:
 * {
 *   "shop": "mystore.myshopify.com",   // REQUIRED
 *   "lang": "es"                        // optional, default: "en"
 * }
 */
export const action = async ({ request }) => {
  try {
    const data        = await request.json();
    const { shop }    = data;
    const lang        = (data.lang || "en").toLowerCase();

    console.log("[survey-title] POST received:", { shop, lang });

    // ── Validate shop ─────────────────────────────────────────
    if (!shop) {
      return jsonResponse({
        error:   "Missing required 'shop' parameter",
        message: "Please provide 'shop' in the request body",
      }, 400);
    }

    // ── Validate language ─────────────────────────────────────
    if (!VALID_LANGS.includes(lang)) {
      return jsonResponse({
        error:          `Invalid language code "${lang}". Use one of: ${VALID_LANGS.join(", ")}`,
        shop,
        validLanguages: VALID_LANGS,
      }, 400);
    }

    // ── Find survey ───────────────────────────────────────────
    const survey = await findSurvey(shop, lang);

    if (!survey) {
      // Fallback to default survey
      const fallback = await prisma.survey.findFirst({
        where: { shop, language: "default" },
        select: { id: true, title: true, language: true, isFrenchVersion: true, shop: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      });

      if (fallback) {
        console.warn(`[survey-title] No ${LANG_LABELS[lang]} survey found for ${shop}, using default`);
        return jsonResponse({
          surveyId:        fallback.id,
          surveyTitle:     fallback.title,
          language:        "en",
          surveyLanguage:  fallback.language,
          isFrenchVersion: fallback.isFrenchVersion,
          shop:            fallback.shop,
          createdAt:       fallback.createdAt,
          fallback:        true,
        });
      }

      return jsonResponse({
        error:          `No ${LANG_LABELS[lang]} survey found`,
        message:        `No survey found for shop: ${shop} with language: ${lang}`,
        shop,
        language:       lang,
        surveyLanguage: LANG_TO_SURVEY[lang],
        hint:           `Create a survey with language "${LANG_TO_SURVEY[lang]}" for this shop`,
      }, 404);
    }

    return jsonResponse({
      surveyId:        survey.id,
      surveyTitle:     survey.title,
      language:        lang,
      surveyLanguage:  survey.language,
      isFrenchVersion: survey.isFrenchVersion,
      shop:            survey.shop,
      createdAt:       survey.createdAt,
    });

  } catch (error) {
    console.error("[survey-title] POST error:", error);
    return jsonResponse({ error: "Internal server error", details: error.message }, 500);
  }
};
