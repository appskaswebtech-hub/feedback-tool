// app/routes/api.suggest-questions.jsx

import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ── Plan limits ───────────────────────────────────────────────
const PLAN_QUESTION_COUNT = {
  free:     1,
  pro:      5,
  advanced: 8,
};

// ── Language config ───────────────────────────────────────────
const LANGUAGE_CONFIG = {
  en: {
    label:       "English",
    flag:        "🇬🇧",
    surveyField: "default",
    yesNo:       ["Yes", "No"],
    prompt:      "Generate the questions in English.",
    fallbackOptions: ["Excellent", "Good", "Average", "Poor"],
    fallbackQuestion: "How would you rate your experience?",
  },
  fr: {
    label:       "French",
    flag:        "🇫🇷",
    surveyField: "french",
    yesNo:       ["Oui", "Non"],
    prompt:      "Generate the questions in French (français). All question text and all options must be in French.",
    fallbackOptions: ["Excellent", "Bien", "Moyen", "Mauvais"],
    fallbackQuestion: "Comment évalueriez-vous votre expérience ?",
  },
  es: {
    label:       "Spanish",
    flag:        "🇪🇸",
    surveyField: "spanish",
    yesNo:       ["Sí", "No"],
    prompt:      "Generate the questions in Spanish (español). All question text and all options must be in Spanish.",
    fallbackOptions: ["Excelente", "Bueno", "Regular", "Malo"],
    fallbackQuestion: "¿Cómo calificaría su experiencia?",
  },
  it: {
    label:       "Italian",
    flag:        "🇮🇹",
    surveyField: "italian",
    yesNo:       ["Sì", "No"],
    prompt:      "Generate the questions in Italian (italiano). All question text and all options must be in Italian.",
    fallbackOptions: ["Eccellente", "Buono", "Nella media", "Scarso"],
    fallbackQuestion: "Come valuterebbe la sua esperienza?",
  },
};

const VALID_LANGS = Object.keys(LANGUAGE_CONFIG);

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // ── Read requested language from POST body ─────────────────
  // Frontend sends: { lang: "es" }  (optional, defaults to "en")
  let requestedLang = "en";
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.lang && VALID_LANGS.includes(body.lang)) {
      requestedLang = body.lang;
    }
  } catch (_) { /* no body → default to en */ }

  const langConfig = LANGUAGE_CONFIG[requestedLang];

  // ── Fetch plan from DB ─────────────────────────────────────
  let planName      = "free";
  let questionCount = PLAN_QUESTION_COUNT.free;

  try {
    const shopPlan = await prisma.shopPlan.findUnique({ where: { shop } });
    if (shopPlan && shopPlan.status === "active") {
      planName      = shopPlan.plan || "free";
      questionCount = PLAN_QUESTION_COUNT[planName] ?? 1;
    }
  } catch (e) {
    console.error("Failed to fetch shop plan:", e);
  }

  // ── Fetch store info from Shopify ──────────────────────────
  let storeName        = "Online Store";
  let storeDescription = "";
  let productTypes     = "general products";

  try {
    const response = await admin.graphql(`
      query {
        shop {
          name
          description
          productTypes(first: 10) {
            edges { node }
          }
        }
      }
    `);
    const shopData   = await response.json();
    const shopInfo   = shopData.data.shop;
    storeName        = shopInfo.name || "Online Store";
    storeDescription = shopInfo.description || "";
    productTypes     = shopInfo.productTypes.edges
      .map((e) => e.node)
      .filter(Boolean)
      .join(", ") || "general products";
  } catch (e) {
    console.error("Failed to fetch shop info:", e);
  }

  console.log(
    `[suggest-questions] shop=${shop} lang=${requestedLang} ` +
    `(${langConfig.label}) plan=${planName} count=${questionCount}`
  );

  // ── Build the Ollama prompt ────────────────────────────────
  const prompt = `You are helping a Shopify store create a customer feedback survey.
Store Name: ${storeName}
Description: ${storeDescription}
Product Types: ${productTypes}

${langConfig.prompt}

Suggest exactly ${questionCount} customer feedback question(s) for this store.
Each question must have a "type" field from these 4 types only:
- "single"      = one answer from options (e.g. rating, satisfaction)
- "multiChoice" = customer can select multiple options
- "conditional" = Yes or No answer ONLY — options must be exactly ["${langConfig.yesNo[0]}", "${langConfig.yesNo[1]}"]
- "textBox"     = customer types a free text answer — options must be empty []

Rules:
1. ALL question text and ALL option text must be written in ${langConfig.label}.
2. For "conditional" type, options MUST be exactly ["${langConfig.yesNo[0]}", "${langConfig.yesNo[1]}"] — no other values.
3. For "textBox" type, options MUST be an empty array [].
4. For "single" and "multiChoice", provide 3-5 relevant options in ${langConfig.label}.
5. Return ONLY a valid JSON array. No explanation. No markdown. No extra text.

Example format:
[
  {"text": "...", "type": "single", "options": ["...", "...", "..."]},
  {"text": "...", "type": "conditional", "options": ["${langConfig.yesNo[0]}", "${langConfig.yesNo[1]}"]},
  {"text": "...", "type": "multiChoice", "options": ["...", "...", "..."]},
  {"text": "...", "type": "textBox", "options": []}
]`;

  // ── Call Ollama ────────────────────────────────────────────
  let ollamaResponse;
  try {
    ollamaResponse = await fetch("http://69.62.85.108:11434/api/generate", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model:  "llama3.2:1b",
        stream: false,
        prompt,
      }),
    });
  } catch (e) {
    console.error("Ollama connection error:", e);
    return json(
      { error: "Cannot connect to AI server. Please try again later." },
      { status: 503 }
    );
  }

  const ollamaData = await ollamaResponse.json();
  console.log(`[suggest-questions] Ollama raw (${requestedLang}):`, ollamaData.response);

  // ── Parse and validate response ────────────────────────────
  try {
    let raw = ollamaData.response.trim();

    // Fix common Ollama formatting issues
    raw = raw
      .replace(/[\u201C\u201D]/g, '"')  // smart double quotes
      .replace(/[\u2018\u2019]/g, "'")  // smart single quotes
      .replace(/""+/g, '"')             // multiple quotes
      .replace(/,\s*]/g, "]")           // trailing commas before ]
      .replace(/,\s*}/g, "}")           // trailing commas before }
      .replace(/"\s*"]/g, '"]')         // extra quote before ]
      .replace(/\n/g, " ")              // newlines
      .trim();

    // Try direct JSON parse first
    try {
      const questions = JSON.parse(raw);
      if (Array.isArray(questions) && questions.length > 0) {
        const validated = validateAndFixQuestions(questions, questionCount, langConfig);
        return json({
          questions:     validated,
          storeName,
          planName,
          questionCount,
          language:      requestedLang,
          languageLabel: langConfig.label,
          languageFlag:  langConfig.flag,
        });
      }
    } catch (_) { /* not valid JSON, try extracting */ }

    // Extract JSON array from surrounding text
    const jsonStart = raw.indexOf("[");
    const jsonEnd   = raw.lastIndexOf("]") + 1;

    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      let extracted = raw.slice(jsonStart, jsonEnd);
      extracted = extracted
        .replace(/""+/g, '"')
        .replace(/,\s*]/g, "]")
        .replace(/,\s*}/g, "}")
        .replace(/"\s*"]/g, '"]');

      const questions = JSON.parse(extracted);
      if (Array.isArray(questions) && questions.length > 0) {
        const validated = validateAndFixQuestions(questions, questionCount, langConfig);
        return json({
          questions:     validated,
          storeName,
          planName,
          questionCount,
          language:      requestedLang,
          languageLabel: langConfig.label,
          languageFlag:  langConfig.flag,
        });
      }
    }

    console.error("[suggest-questions] Could not parse response:", raw);
    return json(
      { error: "AI returned unexpected format. Please try again." },
      { status: 500 }
    );
  } catch (e) {
    console.error("[suggest-questions] Parse error:", e);
    return json(
      { error: "Failed to parse AI suggestions. Please try again." },
      { status: 500 }
    );
  }
};

// ── Validate and fix each question ────────────────────────────
function validateAndFixQuestions(questions, limit, langConfig) {
  const validTypes = ["single", "multiChoice", "conditional", "textBox"];

  return questions
    .slice(0, limit)
    .map((q) => {
      // Fix invalid type
      if (!validTypes.includes(q.type)) q.type = "single";

      // Enforce correct options per type
      if (q.type === "conditional") {
        // Always use the language-correct Yes/No
        q.options = [langConfig.yesNo[0], langConfig.yesNo[1]];
      } else if (q.type === "textBox") {
        q.options = [];
      } else {
        // single / multiChoice must have options
        if (!Array.isArray(q.options) || q.options.length === 0) {
          q.options = langConfig.fallbackOptions;
        }
      }

      return {
        text:    q.text || langConfig.fallbackQuestion,
        type:    q.type,
        options: q.options,
      };
    });
}
