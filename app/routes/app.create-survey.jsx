// app/routes/app.create-survey.jsx

import { json, redirect } from "@remix-run/node";
import { useLoaderData, Form, useActionData, useNavigate, useNavigation, useSearchParams } from "@remix-run/react";
import { PrismaClient } from "@prisma/client";
import { useState, useCallback } from "react";
import {
  Page,
  Card,
  FormLayout,
  TextField,
  Button,
  BlockStack,
  Text,
  Box,
  InlineStack,
  InlineGrid,
  Modal,
  Banner,
  Badge,
  Tooltip,
  Divider,
  Icon,
  Spinner,
  Select,
} from "@shopify/polaris";
import {
  DeleteIcon,
  EditIcon,
  PlusCircleIcon,
  SaveIcon,
  QuestionCircleIcon,
  AlertCircleIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { getShopPlanFromDB } from "../utils/planUtils";
import { getT, LANG_KEY_TO_ISO } from "../utils/translations";

const prisma = new PrismaClient();

const QUESTION_LIMITS = { free: 1, pro: 5, advanced: Infinity };
const PLAN_LABELS     = { free: "Free", pro: "Pro", advanced: "Advanced" };

const LANGUAGES = {
  default: { label: "Default (English)", flag: "🌐", badge: "info",    isoCode: "en" },
  french:  { label: "French",            flag: "🇫🇷", badge: "magic",   isoCode: "fr" },
  spanish: { label: "Spanish",           flag: "🇪🇸", badge: "warning", isoCode: "es" },
  italian: { label: "Italian",           flag: "🇮🇹", badge: "success", isoCode: "it" },
  german:  { label: "German",            flag: "🇩🇪", badge: "info",    isoCode: "de" },
};

const LANGUAGE_DROPDOWN_OPTIONS = Object.entries(LANGUAGES).map(([value, { flag, label }]) => ({
  label: `${flag}  ${label}`,
  value,
}));

const CONDITIONAL_LABELS = {
  default: { yes: "Yes", no: "No"   },
  french:  { yes: "Oui", no: "Non"  },
  spanish: { yes: "Sí",  no: "No"   },
  italian: { yes: "Sì",  no: "No"   },
  german:  { yes: "Ja",  no: "Nein" },
};

const QUESTION_TYPES = {
  single:      { label: "Single Choice", emoji: "🔘", badge: "attention" },
  multiChoice: { label: "Multi Choice",  emoji: "☑️",  badge: "success"   },
  conditional: { label: "Conditional",   emoji: "🔀", badge: "warning"   },
  textBox:     { label: "Text Box",      emoji: "📝", badge: "info"      },
};

const getLang = (survey) =>
  survey.language ?? (survey.isFrenchVersion ? "french" : "default");

// ─── LOADER ───────────────────────────────────────────────────
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url    = new URL(request.url);
  const editId = url.searchParams.get("edit");

  const shopPlan = await getShopPlanFromDB(shop);
  const planName = shopPlan.name ?? "free";
  const rawLimit = QUESTION_LIMITS[planName] ?? 1;

  const surveys = await prisma.survey.findMany({
    where: { shop },
    include: { questions: { include: { answers: true } } },
  });

  const MAX_SURVEYS     = Object.keys(LANGUAGES).length;
  const hasReachedLimit = surveys.length >= MAX_SURVEYS;
  const usedLanguages   = surveys.map((s) => getLang(s));

  let editSurvey = null;
  if (editId) editSurvey = surveys.find((s) => s.id === parseInt(editId)) || null;

  if (hasReachedLimit && !editSurvey) return redirect("/app/");

  return json({
    surveys, hasReachedLimit, usedLanguages, shop, planName,
    questionLimit: rawLimit === Infinity ? null : rawLimit,
    maxSurveys: MAX_SURVEYS, editSurvey,
  });
};

// ─── ACTION ───────────────────────────────────────────────────
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData    = await request.formData();
  const surveyTitle = formData.get("quizTitle");
  const questions   = JSON.parse(formData.get("questions"));
  const surveyIdVal = formData.get("surveyId");
  const surveyId    = surveyIdVal && surveyIdVal !== "" ? parseInt(surveyIdVal) : null;
  const language    = formData.get("language") || "default";
  const returnLang  = formData.get("returnLang") || "default";

  const isFrenchVersion = language === "french";
  const condLabels = CONDITIONAL_LABELS[language] ?? CONDITIONAL_LABELS.default;

  const shopPlan      = await getShopPlanFromDB(shop);
  const planName      = shopPlan.name ?? "free";
  const questionLimit = QUESTION_LIMITS[planName] ?? 1;

  if (questionLimit !== Infinity && questions.length > questionLimit)
    return json({ error: `Your ${PLAN_LABELS[planName]} plan allows only ${questionLimit} question(s). You have ${questions.length}. Please upgrade.`, limitReached: true }, { status: 403 });

  if (!surveyTitle || surveyTitle.trim() === "")
    return json({ error: "Survey title is required." }, { status: 400 });

  if (!questions || questions.length === 0)
    return json({ error: "Survey must have at least one question." }, { status: 400 });

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q.text || q.text.trim() === "")
      return json({ error: `Question ${i + 1} must have text.` }, { status: 400 });
    if (q.isMultiChoice || (!q.isTextBox && !q.isConditional)) {
      if (!q.options || q.options.length === 0)
        return json({ error: `Question ${i + 1} must have at least one option.` }, { status: 400 });
      for (let j = 0; j < q.options.length; j++) {
        if (!q.options[j].text || q.options[j].text.trim() === "")
          return json({ error: `Question ${i + 1}, Option ${j + 1} must have text.` }, { status: 400 });
      }
    }
  }

  const conflictingSurvey = await prisma.survey.findFirst({
    where: { shop, language, NOT: surveyId ? { id: surveyId } : undefined },
  });
  if (conflictingSurvey) {
    const langLabel = LANGUAGES[language]?.label ?? language;
    return json({ error: `You already have a "${langLabel}" survey. Please delete it first.` }, { status: 400 });
  }

  try {
    if (!surveyId) {
      const surveyCount = await prisma.survey.count({ where: { shop } });
      if (surveyCount >= Object.keys(LANGUAGES).length)
        return json({ error: `Maximum survey limit reached (max ${Object.keys(LANGUAGES).length}).` }, { status: 400 });
    }

    const questionData = questions.map((q) => ({
      text:            q.text,
      isMultiChoice:   q.isConditional ? false : q.isTextBox ? false : q.isMultiChoice || false,
      isConditional:   q.isConditional ? (q.isMultiChoice ? false : q.isTextBox ? false : true) : false,
      isTextBox:       q.isConditional ? false : q.isMultiChoice ? false : q.isTextBox || false,
      isSingle:        !q.isConditional && !q.isTextBox && !q.isMultiChoice,
      conditionAnswer: null,
      answers: {
        create: q.isConditional
          ? [{ text: condLabels.yes, haveTextBox: false }, { text: condLabels.no, haveTextBox: false }]
          : q.isTextBox ? []
          : q.options.map((o) => ({ text: o.text, haveTextBox: o.haveTextBox || false })),
      },
    }));

    if (surveyId) {
      const existing = await prisma.survey.findFirst({ where: { id: surveyId, shop } });
      if (!existing) return json({ error: "Survey not found or access denied." }, { status: 403 });
      await prisma.answer.deleteMany({ where: { question: { surveyId } } });
      await prisma.question.deleteMany({ where: { surveyId } });
      await prisma.survey.update({ where: { id: surveyId }, data: { title: surveyTitle, shop, language, isFrenchVersion, questions: { create: questionData } } });
    } else {
      await prisma.survey.create({ data: { title: surveyTitle, shop, language, isFrenchVersion, questions: { create: questionData } } });
    }

    // Redirect back preserving the UI language
    const redirectUrl = returnLang && returnLang !== "default" ? `/app/?lang=${returnLang}` : "/app/";
    return redirect(redirectUrl);
  } catch (error) {
    console.error("Error saving survey:", error);
    return json({ error: "Failed to save survey." }, { status: 500 });
  }
};

// ─── COMPONENT ────────────────────────────────────────────────
export default function CreateSurvey() {
  const {
    surveys, hasReachedLimit, usedLanguages,
    shop, planName, questionLimit, maxSurveys, editSurvey,
  } = useLoaderData();
  const actionData = useActionData();
  const navigate   = useNavigate();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();

  const isEditing = !!editSurvey;

  // ── Read UI language from URL param ────────────────────────
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

  const handleUiLanguageChange = useCallback(
    (value) => {
      setSearchParams((prev) => {
        if (value === "default") prev.delete("lang");
        else prev.set("lang", value);
        return prev;
      });
    },
    [setSearchParams],
  );

  // ── Survey language (for the survey content itself) ────────
  const initialSurveyLang = isEditing ? getLang(editSurvey) : (() => {
    const firstFree = Object.keys(LANGUAGES).find((k) => !usedLanguages.includes(k));
    return firstFree ?? "default";
  })();

  const [surveyLanguage, setSurveyLanguage] = useState(initialSurveyLang);
  const condLabels = CONDITIONAL_LABELS[surveyLanguage] ?? CONDITIONAL_LABELS.default;

  const [surveyTitle, setSurveyTitle] = useState(isEditing ? editSurvey.title : "");
  const [questions, setQuestions]     = useState(() => {
    if (!isEditing) return [];
    return editSurvey.questions.map((q) => ({
      text: q.text,
      isConditional: q.isConditional || false,
      isMultiChoice: q.isMultiChoice || false,
      isTextBox:     q.isTextBox     || false,
      isSingle:      !q.isConditional && !q.isMultiChoice && !q.isTextBox,
      options: q.isTextBox ? [{ text: "" }] : q.answers.map((a) => ({ text: a.text, haveTextBox: a.haveTextBox || false })),
    }));
  });

  const [validationError, setValidationError]         = useState("");
  const [showValidationModal, setShowValidationModal] = useState(false);

  // AI states
  const [aiSuggestModalOpen, setAiSuggestModalOpen] = useState(false);
  const [aiSuggestions, setAiSuggestions]           = useState([]);
  const [aiLoading, setAiLoading]                   = useState(false);
  const [aiError, setAiError]                       = useState("");
  const [selectedSuggestions, setSelectedSuggestions] = useState([]);
  const [aiStoreName, setAiStoreName]               = useState("");
  const [aiPlanName, setAiPlanName]                 = useState("free");
  const [aiLanguageLabel, setAiLanguageLabel]       = useState("English");
  const [aiLanguageFlag, setAiLanguageFlag]         = useState("🌐");

  const isSubmitting     = navigation.state === "submitting" || navigation.state === "loading";
  const limitLabel       = questionLimit === null ? "∞" : questionLimit;
  const hasReachedQLimit = questionLimit !== null && questions.length >= questionLimit;

  const clearValidation = () => { setValidationError(""); setShowValidationModal(false); };

  const handleInputChange = (index, field, value) => {
    const updated = [...questions];
    updated[index][field] = value;
    const q = updated[index];
    updated[index].isSingle = !q.isConditional && !q.isTextBox && !q.isMultiChoice;
    setQuestions(updated); clearValidation();
  };

  const handleAddQuestion    = () => { if (hasReachedQLimit) return; setQuestions([...questions, { text: "", options: [{ text: "" }], isSingle: true }]); };
  const handleRemoveQuestion = (i) => setQuestions(questions.filter((_, idx) => idx !== i));
  const handleAddOption      = (qi) => { const u = [...questions]; u[qi].options.push({ text: "" }); setQuestions(u); };
  const handleRemoveOption   = (qi, oi) => { const u = [...questions]; u[qi].options = u[qi].options.filter((_, i) => i !== oi); setQuestions(u); };

  // AI Suggest
  const handleAISuggest = async () => {
    setAiLoading(true); setAiError(""); setAiSuggestions([]); setSelectedSuggestions([]);
    setAiStoreName(""); setAiSuggestModalOpen(true);
    setAiLanguageLabel(LANGUAGES[surveyLanguage]?.label ?? "English");
    setAiLanguageFlag(LANGUAGES[surveyLanguage]?.flag ?? "🌐");
    try {
      const res = await fetch("/api/suggest-questions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lang: LANGUAGES[surveyLanguage]?.isoCode ?? "en" }) });
      const data = await res.json();
      if (data.error) { setAiError(data.error); }
      else { setAiSuggestions(data.questions); setAiStoreName(data.storeName || ""); setAiPlanName(data.planName || "free"); setAiLanguageLabel(data.languageLabel || LANGUAGES[surveyLanguage]?.label || "English"); setAiLanguageFlag(data.languageFlag || LANGUAGES[surveyLanguage]?.flag || "🌐"); }
    } catch { setAiError("Failed to connect to AI."); }
    finally { setAiLoading(false); }
  };

  const handleToggleSuggestion = (idx) => setSelectedSuggestions((p) => p.includes(idx) ? p.filter((i) => i !== idx) : [...p, idx]);
  const handleSelectAll = () => setSelectedSuggestions(selectedSuggestions.length === aiSuggestions.length ? [] : aiSuggestions.map((_, i) => i));

  const handleAddSuggestedQuestions = () => {
    const cleaned = questions.filter((q) => q.text.trim() !== "" || q.options.some((o) => o.text.trim() !== ""));
    const toAdd = selectedSuggestions.map((idx) => {
      const s = aiSuggestions[idx]; const type = s.type || "single";
      return { text: s.text, isConditional: type === "conditional", isMultiChoice: type === "multiChoice", isTextBox: type === "textBox", isSingle: type === "single",
        options: type === "conditional" ? [{ text: condLabels.yes, haveTextBox: false }, { text: condLabels.no, haveTextBox: false }] : type === "textBox" ? [] : (s.options || []).map((o) => ({ text: typeof o === "string" ? o : o.text, haveTextBox: false })),
      };
    });
    const remaining = questionLimit === null ? toAdd.length : Math.max(0, questionLimit - cleaned.length);
    setQuestions([...cleaned, ...(questionLimit === null ? toAdd : toAdd.slice(0, remaining))]);
    setAiSuggestModalOpen(false); setSelectedSuggestions([]);
  };

  const getTypeInfo = (type) => QUESTION_TYPES[type] || QUESTION_TYPES.single;

  const validateForm = () => {
    const err = (msg) => { setValidationError(msg); setShowValidationModal(true); return false; };
    if (!surveyTitle || !surveyTitle.trim()) return err(t("survey_title_required"));
    if (questions.length === 0) return err(t("must_have_question"));
    if (questionLimit !== null && questions.length > questionLimit) return err(t("plan_allows_only", { plan: PLAN_LABELS[planName], limit: questionLimit }));
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.text || !q.text.trim()) return err(t("question_must_have_text", { n: i + 1 }));
      if (q.isTextBox || q.isConditional) continue;
      if (!q.options || q.options.length === 0) return err(t("question_must_have_option", { n: i + 1 }));
      const bad = q.options.findIndex((o) => !o.text || !o.text.trim());
      if (bad !== -1) return err(t("option_must_have_text", { q: i + 1, o: bad + 1 }));
    }
    return true;
  };

  const handleFormSubmit = (e) => { if (!validateForm()) { e.preventDefault(); return false; } clearValidation(); return true; };

  return (
    <Page
      fullWidth
      title={isEditing ? t("edit_survey_title") : t("create_survey_title")}
      backAction={{ content: t("back_to_dashboard"), onAction: () => navigate(withLang("/app/")) }}
    >
      <style>{`
        @keyframes slideIn { from { opacity:0; transform:translateY(-10px); } to { opacity:1; transform:translateY(0); } }
        .animate-slide-in { animation: slideIn 0.3s ease-out; }
        .ai-card { cursor:pointer; border-radius:8px; padding:14px 16px; transition:all 0.2s ease; border:1px solid #e1e3e5; background:#fff; }
        .ai-card:hover { border-color:#b5b5b5; }
        .ai-card.selected { border-color:#008060; background:#f0fdf4; }
        .lang-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:10px; }
        .lang-btn { padding:10px 12px; border-radius:8px; border:1px solid #e1e3e5; background:#fff; cursor:pointer; text-align:center; transition:all 0.18s ease; font-size:14px; }
        .lang-btn:hover { border-color:#b5b5b5; background:#f9f9f9; }
        .lang-btn.lang-selected { border-color:#008060; background:#f0fdf4; font-weight:600; }
        .lang-btn.lang-disabled { opacity:0.4; cursor:not-allowed; }
      `}</style>

      <BlockStack gap="500">

        {/* ── Top Bar with UI language dropdown ── */}
        <InlineStack align="space-between" blockAlign="center" wrap={false}>
          <Text variant="bodyMd" tone="subdued">
            {isEditing ? t("edit_survey_subtitle") : t("create_survey_subtitle")}
          </Text>
          <InlineStack gap="300" blockAlign="center">
            <div style={{ minWidth: 200 }}>
              <Select label="" labelHidden options={LANGUAGE_DROPDOWN_OPTIONS} value={uiLanguage} onChange={handleUiLanguageChange} />
            </div>
          </InlineStack>
        </InlineStack>

        {/* ── Plan Bar ── */}
        <Card padding="400">
          <InlineStack align="space-between" blockAlign="center" wrap={false}>
            <InlineStack gap="400" blockAlign="center">
              <Text variant="bodyMd">🏪 {t("store_label")}: <strong>{shop}</strong></Text>
              <Badge tone={planName === "advanced" ? "success" : planName === "pro" ? "info" : "subdued"}>
                {PLAN_LABELS[planName]} {t("plan_label")}
              </Badge>
              <Text variant="bodySm" tone="subdued">
                {questionLimit === null ? t("unlimited_questions") : `${questionLimit} ${t("questions_per_survey_label")}`}
              </Text>
            </InlineStack>
            <Button size="slim" onClick={() => navigate(withLang("/app/billing"))}>{t("manage_plan")}</Button>
          </InlineStack>
        </Card>

        {isSubmitting && (
          <Banner tone="info">
            <InlineStack gap="200" blockAlign="center">
              <Spinner size="small" />
              <Text variant="bodyMd" fontWeight="semibold">{isEditing ? t("updating_survey") : t("creating_survey")} {t("please_wait")}</Text>
            </InlineStack>
          </Banner>
        )}

        {actionData?.error && (
          <Banner tone={actionData.limitReached ? "warning" : "critical"} action={actionData.limitReached ? { content: t("upgrade_for_more"), onAction: () => navigate(withLang("/app/billing")) } : undefined}>
            <InlineStack gap="200" blockAlign="center">
              <Icon source={AlertCircleIcon} />
              <Text variant="bodyMd" fontWeight="semibold">{actionData.error}</Text>
            </InlineStack>
          </Banner>
        )}

        {validationError && (
          <Banner tone="critical" onDismiss={clearValidation}>
            <InlineStack gap="200" blockAlign="center">
              <Icon source={AlertCircleIcon} />
              <Text variant="bodyMd" fontWeight="semibold">{validationError}</Text>
            </InlineStack>
          </Banner>
        )}

        {/* ═══════════════════════════════════════════════════
            Survey Form
        ═══════════════════════════════════════════════════ */}
        <Form method="post" onSubmit={handleFormSubmit}>
          <Card padding="400">
            <BlockStack gap="500">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingLg" fontWeight="bold">
                  {isEditing ? `✏️ ${t("edit_survey_title")}` : `✨ ${t("create_survey_title")}`}
                </Text>
                <Button onClick={handleAISuggest} disabled={isSubmitting}>{t("ai_suggest_btn")}</Button>
              </InlineStack>
              <Divider />

              <FormLayout>
                {/* ── Survey Details ── */}
                <BlockStack gap="400">
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={EditIcon} />
                    <Text variant="headingMd" fontWeight="bold">{t("survey_details")}</Text>
                  </InlineStack>

                  <TextField
                    label={t("survey_title_label")}
                    value={surveyTitle}
                    onChange={(v) => { setSurveyTitle(v); clearValidation(); }}
                    name="quizTitle" id="quizTitle"
                    placeholder={t("survey_title_placeholder")}
                    requiredIndicator autoComplete="off"
                    helpText={t("survey_title_help")}
                    disabled={isSubmitting}
                  />

                  {/* ── Survey Language Selector ── */}
                  <Card padding="400">
                    <BlockStack gap="300">
                      <Text variant="headingSm" fontWeight="semibold">{t("survey_language")}</Text>
                      <Text variant="bodySm" tone="subdued">
                        {t("language_help")} {t("conditional_help")} <strong>{condLabels.yes} / {condLabels.no}</strong> {t("for_selected_lang")}
                      </Text>
                      <div className="lang-grid">
                        {Object.entries(LANGUAGES).map(([key, { flag, label }]) => {
                          const alreadyUsed = usedLanguages.includes(key) && !(isEditing && getLang(editSurvey) === key);
                          const isSelected = surveyLanguage === key;
                          const yesNo = CONDITIONAL_LABELS[key] ?? CONDITIONAL_LABELS.default;
                          return (
                            <button key={key} type="button"
                              className={["lang-btn", isSelected ? "lang-selected" : "", alreadyUsed ? "lang-disabled" : ""].join(" ")}
                              onClick={() => { if (!alreadyUsed) setSurveyLanguage(key); }}
                              disabled={alreadyUsed || isSubmitting}
                              title={alreadyUsed ? `Already have ${label} survey` : `${label} — ${yesNo.yes}/${yesNo.no}`}
                            >
                              {flag}  {label}{alreadyUsed ? " ✓" : ""}{isSelected && !alreadyUsed ? " ●" : ""}
                            </button>
                          );
                        })}
                      </div>
                      <InlineStack gap="200" blockAlign="center">
                        <Text variant="bodySm" tone="subdued">{t("selected_label")}</Text>
                        <Badge tone={LANGUAGES[surveyLanguage]?.badge ?? "info"}>{LANGUAGES[surveyLanguage]?.flag} {LANGUAGES[surveyLanguage]?.label}</Badge>
                        <Badge tone="warning">🔀 {t("conditional")}: {condLabels.yes} / {condLabels.no}</Badge>
                      </InlineStack>
                    </BlockStack>
                  </Card>

                  {!isEditing && (
                    <Text variant="bodySm" tone="subdued">
                      {usedLanguages.length === 0
                        ? t("first_survey_hint")
                        : usedLanguages.length < maxSurveys
                        ? `ℹ️ ${usedLanguages.length} / ${maxSurveys} ${t("available_hint")} ${Object.entries(LANGUAGES).filter(([k]) => !usedLanguages.includes(k)).map(([, { flag, label }]) => `${flag} ${label}`).join(", ")}`
                        : t("all_created_hint")}
                    </Text>
                  )}
                </BlockStack>

                {/* ── Questions ── */}
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Icon source={QuestionCircleIcon} />
                        <Text variant="headingMd" fontWeight="bold">{t("questions_heading")}</Text>
                        <Badge tone={hasReachedQLimit ? "critical" : "info"}>{questions.length} / {limitLabel}</Badge>
                      </InlineStack>
                      <Text variant="bodySm" tone="subdued">
                        {questionLimit === null ? t("unlimited_on_advanced") : t("plan_allows", { plan: PLAN_LABELS[planName], limit: questionLimit })}
                      </Text>
                    </BlockStack>
                    <Tooltip content={hasReachedQLimit ? t("upgrade_to_add_more") : t("add_new_question")}>
                      <Button onClick={handleAddQuestion} icon={PlusCircleIcon} variant="primary" disabled={isSubmitting || hasReachedQLimit}>
                        {t("add_question")}
                      </Button>
                    </Tooltip>
                  </InlineStack>

                  {hasReachedQLimit && questionLimit !== null && (
                    <Banner tone="warning" action={{ content: t("upgrade_for_more"), onAction: () => navigate(withLang("/app/billing")) }}>
                      <Text variant="bodyMd">{t("question_limit_reached", { limit: questionLimit, plan: PLAN_LABELS[planName] })}</Text>
                    </Banner>
                  )}
                  <Divider />
                </BlockStack>

                {/* ── Question Cards ── */}
                <BlockStack gap="400">
                  {questions.map((question, index) => (
                    <div key={index} className="animate-slide-in">
                      <Card padding="400">
                        <BlockStack gap="400">
                          <InlineStack align="space-between" blockAlign="start">
                            <InlineStack gap="300" blockAlign="center">
                              <Badge tone="success" size="large">Q{index + 1}</Badge>
                              <Text variant="headingSm" fontWeight="semibold">{t("question_label")} {index + 1}</Text>
                              {question.isSingle      && <Badge tone="attention">{t("single_label")}</Badge>}
                              {question.isConditional && <Badge tone="warning">{t("conditional_label")}</Badge>}
                              {question.isMultiChoice && <Badge tone="success">{t("multi_label")}</Badge>}
                              {question.isTextBox     && <Badge tone="info">{t("textbox_label")}</Badge>}
                            </InlineStack>
                            <Tooltip content={t("remove_question")}>
                              <Button onClick={() => handleRemoveQuestion(index)} icon={DeleteIcon} variant="plain" tone="critical" disabled={isSubmitting} />
                            </Tooltip>
                          </InlineStack>

                          {/* Type selector */}
                          <div style={{ border: "1px solid #e1e3e5", borderRadius: 8, padding: 12, background: "#fafbfb" }}>
                            <BlockStack gap="200">
                              <Text variant="bodySm" fontWeight="medium">{t("question_type")}</Text>
                              <InlineGrid columns={4} gap="300">
                                {[
                                  { key: "isSingle",      label: t("single_label"),      off: question.isMultiChoice || question.isTextBox || question.isConditional },
                                  { key: "isConditional", label: t("conditional_label"), off: question.isMultiChoice || question.isTextBox },
                                  { key: "isTextBox",     label: t("textbox_label"),     off: question.isMultiChoice || question.isConditional },
                                  { key: "isMultiChoice", label: t("multi_label"),       off: question.isConditional || question.isTextBox },
                                ].map(({ key, label, off }) => (
                                  <label key={key} style={{ display: "flex", gap: 6, alignItems: "center", cursor: off || isSubmitting ? "not-allowed" : "pointer", opacity: off ? 0.5 : 1, fontSize: 13 }}>
                                    <input type="checkbox" checked={!!question[key]} disabled={off || isSubmitting}
                                      onChange={(e) => {
                                        if (key === "isSingle") {
                                          const u = [...questions]; u[index] = { ...u[index], isSingle: e.target.checked, isConditional: false, isMultiChoice: false, isTextBox: false }; setQuestions(u);
                                        } else handleInputChange(index, key, e.target.checked);
                                      }}
                                    />
                                    {label}
                                  </label>
                                ))}
                              </InlineGrid>
                            </BlockStack>
                          </div>

                          <TextField label={t("question_text")} placeholder={t("question_placeholder")} value={question.text} onChange={(v) => { handleInputChange(index, "text", v); clearValidation(); }} autoComplete="off" multiline={2} requiredIndicator disabled={isSubmitting} />

                          {!question.isTextBox && (
                            <BlockStack gap="300">
                              <InlineStack align="space-between" blockAlign="center">
                                <Text variant="bodySm" fontWeight="medium">{t("answer_options")}</Text>
                                {!question.isConditional && (
                                  <Button onClick={() => handleAddOption(index)} icon={PlusCircleIcon} tone="success" size="slim" disabled={isSubmitting}>{t("add_option")}</Button>
                                )}
                              </InlineStack>
                              {question.isConditional ? (
                                <BlockStack gap="200">
                                  <div style={{ border: "1px solid #e1e3e5", borderRadius: 6, padding: "8px 12px", background: "#fafbfb" }}>
                                    <InlineStack gap="200" blockAlign="center">
                                      <span style={{ color: "#008060", fontWeight: 600 }}>✓</span>
                                      <TextField disabled value={condLabels.yes} helpText={t("yes_in_lang", { lang: LANGUAGES[surveyLanguage]?.label })} />
                                    </InlineStack>
                                  </div>
                                  <div style={{ border: "1px solid #e1e3e5", borderRadius: 6, padding: "8px 12px", background: "#fafbfb" }}>
                                    <InlineStack gap="200" blockAlign="center">
                                      <span style={{ color: "#d82c0d", fontWeight: 600 }}>✗</span>
                                      <TextField disabled value={condLabels.no} helpText={t("no_in_lang", { lang: LANGUAGES[surveyLanguage]?.label })} />
                                    </InlineStack>
                                  </div>
                                </BlockStack>
                              ) : (
                                <BlockStack gap="200">
                                  {question.options.map((option, oIdx) => (
                                    <div key={oIdx} style={{ border: "1px solid #e1e3e5", borderRadius: 6, padding: "8px 12px", background: "#fafbfb" }}>
                                      <InlineStack gap="200" blockAlign="center">
                                        <Text variant="bodySm" fontWeight="semibold" tone="subdued">{oIdx + 1}</Text>
                                        <Box width="100%">
                                          <TextField placeholder={`${t("option_placeholder")} ${oIdx + 1}`} value={option.text}
                                            onChange={(v) => { const u = [...questions]; u[index].options[oIdx].text = v; setQuestions(u); clearValidation(); }}
                                            autoComplete="off" requiredIndicator disabled={isSubmitting} />
                                        </Box>
                                        <Tooltip content={t("remove_option")}>
                                          <Button onClick={() => handleRemoveOption(index, oIdx)} icon={DeleteIcon} tone="critical" size="slim" disabled={isSubmitting} />
                                        </Tooltip>
                                      </InlineStack>
                                    </div>
                                  ))}
                                </BlockStack>
                              )}
                            </BlockStack>
                          )}

                          {question.isTextBox && (
                            <Banner tone="info"><Text variant="bodySm">{t("textbox_hint")}</Text></Banner>
                          )}
                        </BlockStack>
                      </Card>
                    </div>
                  ))}
                </BlockStack>

                {/* Hidden fields — include returnLang so redirect preserves UI language */}
                <input type="hidden" name="questions"       value={JSON.stringify(questions)} />
                <input type="hidden" name="surveyId"        value={isEditing ? editSurvey.id : ""} />
                <input type="hidden" name="language"        value={surveyLanguage} />
                <input type="hidden" name="isFrenchVersion" value={String(surveyLanguage === "french")} />
                <input type="hidden" name="returnLang"      value={uiLanguage} />

                <Box paddingBlockStart="400">
                  <Button submit icon={SaveIcon} variant="primary" size="large" fullWidth tone="success" loading={isSubmitting} disabled={isSubmitting}>
                    {isEditing ? t("update_survey") : t("save_survey")}
                  </Button>
                </Box>
              </FormLayout>
            </BlockStack>
          </Card>
        </Form>
      </BlockStack>

      {/* ── AI Modal ── */}
      <Modal
        open={aiSuggestModalOpen}
        onClose={() => { if (!aiLoading) { setAiSuggestModalOpen(false); setSelectedSuggestions([]); } }}
        title={`${t("ai_suggest_title")} — ${aiLanguageFlag} ${aiLanguageLabel}`}
        large
        primaryAction={{ content: selectedSuggestions.length > 0 ? t("add_questions_btn", { n: selectedSuggestions.length }) : t("select_questions_below"), onAction: handleAddSuggestedQuestions, disabled: selectedSuggestions.length === 0 || aiLoading }}
        secondaryActions={[{ content: t("cancel"), onAction: () => { setAiSuggestModalOpen(false); setSelectedSuggestions([]); }, disabled: aiLoading }]}
      >
        <Modal.Section>
          <BlockStack gap="500">
            {aiLoading && (
              <InlineStack gap="300" blockAlign="center">
                <Spinner size="small" />
                <BlockStack gap="100">
                  <Text variant="bodyMd" fontWeight="semibold">{t("ai_generating", { flag: aiLanguageFlag, lang: aiLanguageLabel })}</Text>
                  <Text variant="bodySm" tone="subdued">{t("ai_wait")}</Text>
                </BlockStack>
              </InlineStack>
            )}
            {aiError && !aiLoading && (
              <Banner tone="critical" action={{ content: t("try_again"), onAction: handleAISuggest }}>
                <Text variant="bodyMd">{aiError}</Text>
              </Banner>
            )}
            {!aiLoading && aiSuggestions.length > 0 && (
              <BlockStack gap="400">
                <Banner tone="success">
                  <Text variant="bodyMd" fontWeight="semibold">
                    {t("ai_generated", { flag: aiLanguageFlag, count: aiSuggestions.length, lang: aiLanguageLabel })}
                    {aiStoreName ? ` ${t("ai_for_store", { store: aiStoreName })}` : ` ${t("ai_for_your_store")}`}
                  </Text>
                </Banner>

                <InlineStack gap="300" wrap>
                  <Badge tone="attention">{t("single_choice_desc")}</Badge>
                  <Badge tone="success">{t("multi_choice_desc")}</Badge>
                  <Badge tone="warning">{t("conditional_desc", { yes: condLabels.yes, no: condLabels.no })}</Badge>
                  <Badge tone="info">{t("textbox_desc")}</Badge>
                </InlineStack>

                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="bodySm" fontWeight="bold">{t("selected_of", { sel: selectedSuggestions.length, total: aiSuggestions.length })}</Text>
                  <Button size="slim" variant="tertiary" onClick={handleSelectAll}>
                    {selectedSuggestions.length === aiSuggestions.length ? t("deselect_all") : t("select_all")}
                  </Button>
                </InlineStack>

                <BlockStack gap="300">
                  {aiSuggestions.map((suggestion, idx) => {
                    const isSel = selectedSuggestions.includes(idx);
                    const ti    = getTypeInfo(suggestion.type);
                    return (
                      <div key={idx} className={`ai-card ${isSel ? "selected" : ""}`} onClick={() => handleToggleSuggestion(idx)}>
                        <BlockStack gap="200">
                          <InlineStack gap="200" blockAlign="center">
                            <div style={{ width: 20, height: 20, borderRadius: "50%", backgroundColor: isSel ? "#008060" : "#e1e3e5", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: "bold", flexShrink: 0 }}>
                              {isSel ? "✓" : idx + 1}
                            </div>
                            <Badge tone={ti.badge}>{ti.emoji} {ti.label}</Badge>
                          </InlineStack>
                          <Text variant="bodyMd" fontWeight={isSel ? "semibold" : "regular"}>{suggestion.text}</Text>
                          {suggestion.type === "conditional" ? (
                            <InlineStack gap="200"><Badge tone="success">{condLabels.yes}</Badge><Badge tone="critical">{condLabels.no}</Badge></InlineStack>
                          ) : suggestion.type !== "textBox" && suggestion.options?.length > 0 ? (
                            <InlineStack gap="200" wrap>{suggestion.options.map((opt, oi) => <Badge key={oi} tone="subdued">{typeof opt === "string" ? opt : opt.text}</Badge>)}</InlineStack>
                          ) : suggestion.type === "textBox" ? (
                            <Text variant="bodySm" tone="subdued">{t("customer_will_type")}</Text>
                          ) : null}
                        </BlockStack>
                      </div>
                    );
                  })}
                </BlockStack>

                {questionLimit !== null && selectedSuggestions.length > (questionLimit - questions.length) && (
                  <Banner tone="warning">
                    <Text variant="bodyMd">{t("can_only_add", { n: Math.max(0, questionLimit - questions.length), plan: PLAN_LABELS[planName] })}</Text>
                  </Banner>
                )}
              </BlockStack>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* ── Validation Modal ── */}
      <Modal open={showValidationModal} onClose={() => setShowValidationModal(false)} title={t("validation_error")}
        primaryAction={{ content: t("got_it"), onAction: () => setShowValidationModal(false) }}>
        <Modal.Section>
          <BlockStack gap="400">
            <Banner tone="critical">
              <BlockStack gap="200">
                <Text variant="bodyMd" fontWeight="bold">{t("fix_error")}</Text>
                <Text variant="bodyMd">{validationError}</Text>
              </BlockStack>
            </Banner>
            <Text variant="bodySm" tone="subdued">{t("try_again")}</Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
