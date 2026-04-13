// app/routes/app._index.jsx

import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import { PrismaClient } from "@prisma/client";
import { useState, useCallback } from "react";
import {
  Page,
  Card,
  Button,
  BlockStack,
  Text,
  Box,
  InlineStack,
  InlineGrid,
  DataTable,
  Modal,
  List,
  Banner,
  Badge,
  Tooltip,
  Divider,
  Icon,
  EmptyState,
  Spinner,
  Select,
} from "@shopify/polaris";
import {
  DeleteIcon,
  EditIcon,
  PlusCircleIcon,
  ViewIcon,
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

const getLang = (survey) =>
  survey.language ?? (survey.isFrenchVersion ? "french" : "default");

// ─── LOADER ───────────────────────────────────────────────────
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const shopPlan = await getShopPlanFromDB(shop);
  const planName = shopPlan.name ?? "free";
  const rawLimit = QUESTION_LIMITS[planName] ?? 1;

  const surveys = await prisma.survey.findMany({
    where: { shop },
    include: { questions: { include: { answers: true } } },
  });

  const MAX_SURVEYS   = Object.keys(LANGUAGES).length;
  const usedLanguages = surveys.map((s) => getLang(s));
  const totalQuestions = surveys.reduce((sum, s) => sum + (s.questions?.length || 0), 0);

  let singleCount = 0, multiCount = 0, condCount = 0, textCount = 0;
  surveys.forEach((s) =>
    s.questions?.forEach((q) => {
      if (q.isConditional) condCount++;
      else if (q.isMultiChoice) multiCount++;
      else if (q.isTextBox) textCount++;
      else singleCount++;
    })
  );

  return json({
    surveys, shop, planName,
    questionLimit: rawLimit === Infinity ? null : rawLimit,
    maxSurveys: MAX_SURVEYS, usedLanguages, totalQuestions,
    typeCounts: { singleCount, multiCount, condCount, textCount },
  });
};

// ─── COMPONENT ────────────────────────────────────────────────
export default function DashboardIndex() {
  const {
    surveys, shop, planName, questionLimit,
    maxSurveys, usedLanguages, totalQuestions, typeCounts,
  } = useLoaderData();

  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Read language from URL, default to "default" (English) ──
  const uiLanguage = searchParams.get("lang") || "default";
  const uiLangIso  = LANG_KEY_TO_ISO[uiLanguage] ?? "en";
  const t          = getT(uiLangIso);

  // Helper: build path that always carries the current lang param
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
        if (value === "default") { prev.delete("lang"); }
        else { prev.set("lang", value); }
        return prev;
      });
    },
    [setSearchParams],
  );

  const limitLabel      = questionLimit === null ? "∞" : questionLimit;
  const hasReachedLimit = surveys.length >= maxSurveys;

  // Delete state
  const [isDeleteBannerVisible, setDeleteBannerVisible] = useState(false);
  const [surveyToDelete, setSurveyToDelete]             = useState(null);
  const [isDeleting, setIsDeleting]                     = useState(false);

  // View modal
  const [activeSurvey, setActiveSurvey] = useState(null);
  const [modalOpen, setModalOpen]       = useState(false);

  const handleViewSurvey   = (s) => { setActiveSurvey(s); setModalOpen(true); };
  const handleCloseModal   = () => { setModalOpen(false); setTimeout(() => setActiveSurvey(null), 300); };
  const handleDeleteSurvey = (id) => { setSurveyToDelete(id); setDeleteBannerVisible(true); };
  const cancelDeleteSurvey = () => { setDeleteBannerVisible(false); setSurveyToDelete(null); };

  const confirmDeleteSurvey = async () => {
    if (!surveyToDelete) return;
    setIsDeleting(true);
    try {
      const res = await fetch("/api/delete-survey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surveyId: surveyToDelete }),
      });
      if (res.ok) {
        setDeleteBannerVisible(false); setSurveyToDelete(null); setIsDeleting(false);
        navigate(withLang("/app/"), { replace: true });
      } else { setIsDeleting(false); alert("Failed to delete survey."); }
    } catch (e) { console.error(e); setIsDeleting(false); alert("Failed to delete survey."); }
  };

  const LangBadge = ({ survey }) => {
    const lang = getLang(survey);
    const info = LANGUAGES[lang] ?? LANGUAGES.default;
    return <Badge tone={info.badge}>{info.flag} {info.label}</Badge>;
  };

  const { singleCount, multiCount, condCount, textCount } = typeCounts;
  const pct = (n) => totalQuestions > 0 ? Math.round((n / totalQuestions) * 100) : 0;

  // ── Table rows ─────────────────────────────────────────────
  const surveyRows = surveys.map((survey, index) => [
    <Text variant="bodyMd" fontWeight="semibold" key={`n-${survey.id}`}>{index + 1}</Text>,
    <BlockStack gap="100" key={`d-${survey.id}`}>
      <Text variant="bodyMd" fontWeight="bold">{survey.title}</Text>
      <InlineStack gap="200">
        <Text variant="bodySm" tone="subdued">{survey.questions?.length || 0} {t("questions_label")}</Text>
        <Text variant="bodySm" tone="subdued">·</Text>
        <LangBadge survey={survey} />
      </InlineStack>
    </BlockStack>,
    <InlineStack key={`a-${survey.id}`} gap="200">
      <Button onClick={() => handleViewSurvey(survey)} icon={ViewIcon} size="slim" variant="tertiary">{t("view_survey")}</Button>
      <Button onClick={() => navigate(withLang(`/app/create-survey?edit=${survey.id}`))} icon={EditIcon} size="slim">{t("edit_survey")}</Button>
      <Button onClick={() => handleDeleteSurvey(survey.id)} icon={DeleteIcon} size="slim" tone="critical">{t("delete_survey")}</Button>
    </InlineStack>,
  ]);

  return (
    <Page fullWidth>
      <BlockStack gap="500">

        {/* ── Top Bar ── */}
        <InlineStack align="space-between" blockAlign="center" wrap={false}>
          <BlockStack gap="100">
            <Text variant="heading2xl" as="h1">{t("dashboard_title")}</Text>
            <Text variant="bodyMd" tone="subdued">{t("dashboard_subtitle")}</Text>
          </BlockStack>
          <InlineStack gap="300" blockAlign="center">
            <div style={{ minWidth: 200 }}>
              <Select
                label=""
                labelHidden
                options={LANGUAGE_DROPDOWN_OPTIONS}
                value={uiLanguage}
                onChange={handleLanguageChange}
              />
            </div>
            <Button
              size="large"
              onClick={() => navigate(withLang("/app/create-survey"))}
              icon={PlusCircleIcon}
              variant="primary"
              disabled={hasReachedLimit}
            >
              {t("create_new_survey")}
            </Button>
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

        {hasReachedLimit && (
          <Banner tone="warning">
            <Text variant="bodyMd">⚠️ {t("max_survey_limit")} ({maxSurveys}/{maxSurveys}). {t("delete_to_create")}</Text>
          </Banner>
        )}

        {/* ── Stats ── */}
        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
          <Card padding="400">
            <BlockStack gap="200">
              <Text variant="bodySm" tone="subdued">{t("total_surveys")}</Text>
              <InlineStack gap="200" blockAlign="baseline">
                <Text variant="heading2xl" fontWeight="bold">{surveys.length}</Text>
                <Text variant="bodySm" tone="subdued">/ {maxSurveys}</Text>
              </InlineStack>
              <div style={{ height: 6, borderRadius: 3, background: "#e4e5e7", overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 3, width: `${(surveys.length / maxSurveys) * 100}%`, background: surveys.length >= maxSurveys ? "#d82c0d" : "#2c6ecb", transition: "width 0.4s ease" }} />
              </div>
            </BlockStack>
          </Card>

          <Card padding="400">
            <BlockStack gap="200">
              <Text variant="bodySm" tone="subdued">{t("total_questions")}</Text>
              <Text variant="heading2xl" fontWeight="bold">{totalQuestions}</Text>
              <Text variant="bodySm" tone="subdued">
                {surveys.length > 0 ? `≈ ${Math.round(totalQuestions / surveys.length)} / ${t("questions_per_survey").toLowerCase()}` : "—"}
              </Text>
            </BlockStack>
          </Card>

          <Card padding="400">
            <BlockStack gap="200">
              <Text variant="bodySm" tone="subdued">{t("questions_per_survey")}</Text>
              <Text variant="heading2xl" fontWeight="bold">{limitLabel}</Text>
              <Button size="slim" fullWidth variant={planName === "advanced" ? "tertiary" : "primary"} onClick={() => navigate(withLang("/app/billing"))}>
                {planName === "advanced" ? t("max_plan") : t("upgrade_for_more")}
              </Button>
            </BlockStack>
          </Card>

          <Card padding="400">
            <BlockStack gap="200">
              <Text variant="bodySm" tone="subdued">{t("language_versions")}</Text>
              <BlockStack gap="100">
                {Object.entries(LANGUAGES).map(([key, { flag, label }]) => {
                  const active = usedLanguages.includes(key);
                  return (
                    <InlineStack key={key} gap="200" blockAlign="center">
                      <Text variant="bodySm">{flag}</Text>
                      <Text variant="bodySm" tone={active ? undefined : "subdued"}>{label}</Text>
                      <div style={{ marginLeft: "auto" }}>
                        {active
                          ? <span style={{ color: "#008060", fontSize: 12, fontWeight: 600 }}>✓</span>
                          : <span style={{ color: "#b5b5b5", fontSize: 12 }}>–</span>}
                      </div>
                    </InlineStack>
                  );
                })}
              </BlockStack>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* ── Question Types ── */}
        {totalQuestions > 0 && (
          <Card padding="400">
            <BlockStack gap="400">
              <Text variant="headingMd" fontWeight="bold">{t("question_types_breakdown")}</Text>
              <Divider />
              <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
                {[
                  { label: t("single_choice"), count: singleCount, emoji: "🔘", color: "#ffc453" },
                  { label: t("multi_choice"),  count: multiCount,  emoji: "☑️",  color: "#36a569" },
                  { label: t("conditional"),   count: condCount,   emoji: "🔀", color: "#e8a735" },
                  { label: t("text_box"),      count: textCount,   emoji: "📝", color: "#5baaec" },
                ].map(({ label, count, emoji, color }) => (
                  <div key={label} style={{ border: "1px solid #e1e3e5", borderRadius: 8, padding: 16, background: "#fafbfb" }}>
                    <BlockStack gap="200">
                      <InlineStack gap="200" blockAlign="center">
                        <span style={{ fontSize: 18 }}>{emoji}</span>
                        <Text variant="bodySm" fontWeight="semibold">{label}</Text>
                      </InlineStack>
                      <InlineStack gap="200" blockAlign="baseline">
                        <Text variant="headingXl" fontWeight="bold">{count}</Text>
                        <Text variant="bodySm" tone="subdued">{pct(count)}%</Text>
                      </InlineStack>
                      <div style={{ height: 4, borderRadius: 2, background: "#e4e5e7", overflow: "hidden" }}>
                        <div style={{ height: "100%", borderRadius: 2, width: `${pct(count)}%`, background: color, transition: "width 0.4s ease" }} />
                      </div>
                    </BlockStack>
                  </div>
                ))}
              </InlineGrid>
            </BlockStack>
          </Card>
        )}

        {/* ── Language Distribution ── */}
        {surveys.length > 0 && (
          <Card padding="400">
            <BlockStack gap="400">
              <Text variant="headingMd" fontWeight="bold">{t("survey_distribution")}</Text>
              <Divider />
              <InlineGrid columns={{ xs: 2, sm: 3, md: 5 }} gap="300">
                {Object.entries(LANGUAGES).map(([key, { flag, label }]) => {
                  const survey = surveys.find((s) => getLang(s) === key);
                  return (
                    <div key={key} style={{ border: `1px solid ${survey ? "#bfe3d0" : "#e1e3e5"}`, borderRadius: 8, padding: "14px 12px", textAlign: "center", background: survey ? "#f0fdf4" : "#fafbfb" }}>
                      <BlockStack gap="200" inlineAlign="center">
                        <Text variant="headingLg">{flag}</Text>
                        <Text variant="bodySm" fontWeight="semibold">{label}</Text>
                        {survey ? (
                          <>
                            <Text variant="bodySm" fontWeight="medium" tone="success">{survey.title}</Text>
                            <Text variant="bodySm" tone="subdued">{survey.questions?.length || 0} {t("questions_label")}</Text>
                          </>
                        ) : (
                          <Text variant="bodySm" tone="subdued">—</Text>
                        )}
                      </BlockStack>
                    </div>
                  );
                })}
              </InlineGrid>
            </BlockStack>
          </Card>
        )}

        {/* ── Survey List ── */}
        <Card padding="400">
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text variant="headingLg" fontWeight="bold">{t("your_surveys")}</Text>
                <Text variant="bodySm" tone="subdued">
                  {t("one_survey_per_lang")} · {PLAN_LABELS[planName]}: {limitLabel} {t("questions_per_survey_label")}
                </Text>
              </BlockStack>
              <Button onClick={() => navigate(withLang("/app/create-survey"))} icon={PlusCircleIcon} disabled={hasReachedLimit}>
                {t("create_new_survey")}
              </Button>
            </InlineStack>
            <Divider />
            {surveys.length > 0 ? (
              <DataTable
                columnContentTypes={["numeric", "text", "text"]}
                headings={[
                  <Text variant="bodySm" fontWeight="semibold" key="h1">#</Text>,
                  <Text variant="bodySm" fontWeight="semibold" key="h2">{t("survey_details")}</Text>,
                  <Text variant="bodySm" fontWeight="semibold" key="h3">{t("actions_label")}</Text>,
                ]}
                rows={surveyRows}
                hoverable
              />
            ) : (
              <Box padding="1200">
                <EmptyState
                  heading={t("no_surveys_yet")}
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  action={{ content: t("create_new_survey"), onAction: () => navigate(withLang("/app/create-survey")) }}
                >
                  <p>{t("no_surveys_desc")}</p>
                </EmptyState>
              </Box>
            )}
          </BlockStack>
        </Card>
      </BlockStack>

      {/* ── Delete Modal ── */}
      {isDeleteBannerVisible && (
        <Modal
          open={true}
          onClose={isDeleting ? undefined : cancelDeleteSurvey}
          title={t("confirm_deletion")}
          primaryAction={{ content: isDeleting ? t("deleting") : t("delete_permanently"), onAction: confirmDeleteSurvey, destructive: true, loading: isDeleting, disabled: isDeleting }}
          secondaryActions={[{ content: t("cancel"), onAction: cancelDeleteSurvey, disabled: isDeleting }]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              {isDeleting && (
                <Banner tone="info">
                  <InlineStack gap="200" blockAlign="center">
                    <Spinner size="small" />
                    <Text variant="bodyMd" fontWeight="semibold">{t("deleting")}</Text>
                  </InlineStack>
                </Banner>
              )}
              <Banner tone="critical">
                <BlockStack gap="300">
                  <Text variant="bodyMd" fontWeight="bold">{t("cannot_undo")}</Text>
                  <Text variant="bodyMd">{t("delete_warning")}</Text>
                  <List type="bullet">
                    <List.Item>{t("delete_item_survey")}</List.Item>
                    <List.Item>{t("delete_item_responses")}</List.Item>
                    <List.Item>{t("delete_item_analytics")}</List.Item>
                  </List>
                </BlockStack>
              </Banner>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* ── View Modal ── */}
      {activeSurvey && (
        <Modal open={modalOpen} onClose={handleCloseModal} title={activeSurvey.title} large>
          <Modal.Section>
            <BlockStack gap="500">
              <InlineStack gap="300" wrap>
                <Badge tone="success">{activeSurvey.questions?.length || 0} {t("questions_label")}</Badge>
                <LangBadge survey={activeSurvey} />
              </InlineStack>
              <Divider />
              <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                {activeSurvey.questions.map((question, qIdx) => (
                  <Card key={question.id} padding="400">
                    <BlockStack gap="300">
                      <InlineStack gap="200" blockAlign="center">
                        <Text variant="bodySm" fontWeight="bold" tone="subdued">Q{qIdx + 1}</Text>
                        <Text variant="bodyMd" fontWeight="bold">{question.text}</Text>
                      </InlineStack>
                      <InlineStack gap="200" wrap>
                        {question.isConditional  && <Badge tone="warning">🔀 {t("conditional")}</Badge>}
                        {question.isMultiChoice  && <Badge tone="success">☑️ {t("multi_choice")}</Badge>}
                        {question.isTextBox      && <Badge tone="info">📝 {t("text_box")}</Badge>}
                        {!question.isConditional && !question.isMultiChoice && !question.isTextBox && (
                          <Badge tone="attention">🔘 {t("single_choice")}</Badge>
                        )}
                      </InlineStack>
                      {!question.isTextBox && (
                        <BlockStack gap="100">
                          {question.answers.map((a) => (
                            <InlineStack key={a.id} gap="200" blockAlign="center">
                              <span style={{ color: "#8c9196" }}>•</span>
                              <Text variant="bodyMd">{a.text}</Text>
                            </InlineStack>
                          ))}
                        </BlockStack>
                      )}
                    </BlockStack>
                  </Card>
                ))}
              </InlineGrid>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
