// app/routes/app._index.jsx

import { json, redirect } from "@remix-run/node";
import { useLoaderData, Form, useActionData, useNavigate, useNavigation } from "@remix-run/react";
import { PrismaClient } from "@prisma/client";
import { useState } from "react";
import {
  Page,
  Card,
  FormLayout,
  TextField,
  Button,
  Checkbox,
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
} from "@shopify/polaris";
import {
  DeleteIcon,
  EditIcon,
  PlusCircleIcon,
  SaveIcon,
  ToggleOffIcon,
  ToggleOnIcon,
  ViewIcon,
  QuestionCircleIcon,
  CheckCircleIcon,
  AlertCircleIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { getShopPlanFromDB } from "../utils/planUtils";

const prisma = new PrismaClient();

// ─── Question limits per plan (server-side only) ──────────────
const QUESTION_LIMITS = {
  free:     1,
  pro:      5,
  advanced: Infinity, // ✅ Infinity only used server-side
};

const PLAN_LABELS = {
  free:     "Free",
  pro:      "Pro",
  advanced: "Advanced",
};

// ─── LOADER ───────────────────────────────────────────────────
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const shopPlan      = await getShopPlanFromDB(shop);
  const planName      = shopPlan.name ?? "free";
  const rawLimit      = QUESTION_LIMITS[planName] ?? 1;

  const surveys = await prisma.survey.findMany({
    where: { shop },
    include: {
      questions: {
        include: { answers: true },
      },
    },
  });

  const hasReachedLimit = surveys.length >= 2;

  return json({
    surveys,
    hasReachedLimit,
    shop,
    planName,
    // ✅ Infinity → null so JSON serialization works correctly
    questionLimit: rawLimit === Infinity ? null : rawLimit,
  });
};

// ─── ACTION ───────────────────────────────────────────────────
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData        = await request.formData();
  const surveyTitle     = formData.get("quizTitle");
  const questions       = JSON.parse(formData.get("questions"));
  const surveyIdValue   = formData.get("surveyId");
  const surveyId        = surveyIdValue && surveyIdValue !== ""
    ? parseInt(surveyIdValue)
    : null;
  const isFrenchVersion = formData.get("isFrenchVersion") === "true";
  const frenchSurveyId  = formData.get("frenchSurveyId")
    ? parseInt(formData.get("frenchSurveyId"))
    : null;

  // ✅ Check question limit — server-side uses Infinity safely
  const shopPlan      = await getShopPlanFromDB(shop);
  const planName      = shopPlan.name ?? "free";
  const questionLimit = QUESTION_LIMITS[planName] ?? 1;

  if (questionLimit !== Infinity && questions.length > questionLimit) {
    return json({
      error: `Your ${PLAN_LABELS[planName]} plan allows only ${questionLimit} question(s) per survey. You have ${questions.length}. Please upgrade your plan to add more questions.`,
      limitReached: true,
    }, { status: 403 });
  }

  // Validate survey title
  if (!surveyTitle || surveyTitle.trim() === "") {
    return json({ error: "Survey title is required." }, { status: 400 });
  }

  // Validate at least one question
  if (!questions || questions.length === 0) {
    return json({ error: "Survey must have at least one question." }, { status: 400 });
  }

  // Validate each question
  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    if (!question.text || question.text.trim() === "") {
      return json({ error: `Question ${i + 1} must have text.` }, { status: 400 });
    }
    if (question.isMultiChoice || (!question.isTextBox && !question.isConditional)) {
      if (!question.options || question.options.length === 0) {
        return json({ error: `Question ${i + 1} must have at least one option.` }, { status: 400 });
      }
      for (let j = 0; j < question.options.length; j++) {
        if (!question.options[j].text || question.options[j].text.trim() === "") {
          return json({ error: `Question ${i + 1}, Option ${j + 1} must have text.` }, { status: 400 });
        }
      }
    }
  }

  // Validate no duplicate isFrenchVersion
  const existingSurveyWithSameType = await prisma.survey.findFirst({
    where: {
      shop,
      isFrenchVersion,
      NOT: surveyId ? { id: surveyId } : undefined,
    },
  });

  if (existingSurveyWithSameType) {
    return json({
      error: isFrenchVersion
        ? "You already have a French version survey. Please delete it first or uncheck the French version option."
        : "You already have a non-French (default) version survey. Please delete it first or check the French version option.",
    }, { status: 400 });
  }

  try {
    if (!surveyId) {
      const surveyCount = await prisma.survey.count({ where: { shop } });
      if (surveyCount >= 2) {
        return json({
          error: "Maximum survey limit reached. You can only have 2 surveys (1 French + 1 Non-French).",
        }, { status: 400 });
      }
    }

    const questionData = questions.map((q) => ({
      text:            q.text,
      isMultiChoice:   q.isConditional ? false : q.isTextBox ? false : q.isMultiChoice || false,
      isConditional:   q.isMultiChoice ? false : q.isTextBox ? false : q.isConditional || false,
      isTextBox:       q.isConditional ? false : q.isMultiChoice ? false : q.isTextBox || false,
      isSingle:        !q.isConditional && !q.isTextBox && !q.isMultiChoice,
      conditionAnswer: null,
      answers: {
        create: q.isConditional
          ? [{ text: "Yes", haveTextBox: false }, { text: "No", haveTextBox: false }]
          : q.isTextBox
          ? []
          : q.options.map((o) => ({ text: o.text, haveTextBox: o.haveTextBox || false })),
      },
    }));

    if (surveyId) {
      const existingSurvey = await prisma.survey.findFirst({
        where: { id: surveyId, shop },
      });
      if (!existingSurvey) {
        return json({ error: "Survey not found or access denied." }, { status: 403 });
      }
      await prisma.answer.deleteMany({ where: { question: { surveyId } } });
      await prisma.question.deleteMany({ where: { surveyId } });
      await prisma.survey.update({
        where: { id: surveyId },
        data: { title: surveyTitle, shop, isFrenchVersion, surveyId: frenchSurveyId, questions: { create: questionData } },
      });
      console.log("Survey updated:", surveyId);
    } else {
      await prisma.survey.create({
        data: { title: surveyTitle, shop, isFrenchVersion, surveyId: frenchSurveyId, questions: { create: questionData } },
      });
      console.log("Survey created");
    }

    return redirect("/app/");
  } catch (error) {
    console.error("Error saving survey:", error);
    return json({ error: "Failed to save survey." }, { status: 500 });
  }
};

// ─── COMPONENT ────────────────────────────────────────────────
export default function Index() {
  const {
    surveys,
    hasReachedLimit,
    shop,
    planName,
    questionLimit, // null = unlimited, number = limit
  } = useLoaderData();

  const actionData  = useActionData();
  const navigate    = useNavigate();
  const navigation  = useNavigation();

  const [surveyTitle, setSurveyTitle]   = useState("");
  const [questions, setQuestions]       = useState([
    { text: "", options: [{ text: "" }], isSingle: true },
  ]);
  const [activeSurvey, setActiveSurvey]             = useState(null);
  const [modalOpen, setModalOpen]                   = useState(false);
  const [isDeleteBannerVisible, setDeleteBannerVisible] = useState(false);
  const [surveyToDelete, setSurveyToDelete]         = useState(null);
  const [isFrenchVersion, setIsFrenchVersion]       = useState(false);
  const [selectedSurveyId, setSelectedSurveyId]     = useState("");
  const [validationError, setValidationError]       = useState("");
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [isDeleting, setIsDeleting]                 = useState(false);

  const isSubmitting = navigation.state === "submitting" || navigation.state === "loading";

  const hasFrenchVersion    = surveys.some((s) => s.isFrenchVersion);
  const hasNonFrenchVersion = surveys.some((s) => !s.isFrenchVersion);

  // ✅ null = unlimited, number = has limit
  const limitLabel       = questionLimit === null ? "∞" : questionLimit;
  const hasReachedQLimit = questionLimit !== null && questions.length >= questionLimit;

  const totalQuestions = surveys.reduce((sum, s) => sum + (s.questions?.length || 0), 0);

  // ── Handlers ───────────────────────────────────────────────
  const handleInputChange = (index, field, value) => {
    const updatedQuestions = [...questions];
    updatedQuestions[index][field] = value;
    const q = updatedQuestions[index];
    updatedQuestions[index].isSingle = !q.isConditional && !q.isTextBox && !q.isMultiChoice;
    setQuestions(updatedQuestions);
    if (validationError) { setValidationError(""); setShowValidationModal(false); }
  };

  const handleAddQuestion = () => {
    // ✅ null = unlimited, never block
    if (hasReachedQLimit) return;
    setQuestions([...questions, { text: "", options: [{ text: "" }], isSingle: true }]);
  };

  const handleRemoveQuestion = (index) =>
    setQuestions(questions.filter((_, idx) => idx !== index));

  const handleAddOption = (questionIndex) => {
    const updatedQuestions = [...questions];
    updatedQuestions[questionIndex].options.push({ text: "" });
    setQuestions(updatedQuestions);
  };

  const handleRemoveOption = (questionIndex, optionIndex) => {
    const updatedQuestions = [...questions];
    updatedQuestions[questionIndex].options =
      updatedQuestions[questionIndex].options.filter((_, idx) => idx !== optionIndex);
    setQuestions(updatedQuestions);
  };

  const handleViewSurvey = (survey) => { setActiveSurvey(survey); setModalOpen(true); };
  const handleCloseModal = () => { setModalOpen(false); setTimeout(() => setActiveSurvey(null), 300); };

  const handleEditSurvey = (survey) => {
    setSurveyTitle(survey.title);
    setActiveSurvey(survey);
    setIsFrenchVersion(survey.isFrenchVersion || false);
    setSelectedSurveyId(survey.surveyId ? survey.surveyId.toString() : "");
    setValidationError(""); setShowValidationModal(false);
    setQuestions(survey.questions.map((q) => ({
      text:          q.text,
      isConditional: q.isConditional || false,
      isMultiChoice: q.isMultiChoice || false,
      isTextBox:     q.isTextBox || false,
      isSingle:      !q.isConditional && !q.isMultiChoice && !q.isTextBox,
      options: q.isTextBox
        ? [{ text: "" }]
        : q.answers.map((a) => ({ text: a.text, haveTextBox: a.haveTextBox || false })),
    })));
  };

  const handleDeleteSurvey = (surveyId) => {
    setSurveyToDelete(surveyId);
    setDeleteBannerVisible(true);
  };

  const confirmDeleteSurvey = async () => {
    if (!surveyToDelete) return;
    setIsDeleting(true);
    try {
      const response = await fetch("/api/delete-survey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surveyId: surveyToDelete }),
      });
      if (response.ok) {
        setDeleteBannerVisible(false); setSurveyToDelete(null); setIsDeleting(false);
        navigate("/app/", { replace: true });
      } else {
        setIsDeleting(false);
        alert("Failed to delete survey. Please try again.");
      }
    } catch (error) {
      console.error("Error deleting survey:", error);
      setIsDeleting(false);
      alert("Failed to delete survey. Please try again.");
    }
  };

  const cancelDeleteSurvey = () => { setDeleteBannerVisible(false); setSurveyToDelete(null); };

  const handleNewSurvey = () => {
    if (hasReachedLimit && !activeSurvey) return;
    setSurveyTitle(""); setActiveSurvey(null);
    setIsFrenchVersion(!hasFrenchVersion && hasNonFrenchVersion);
    setSelectedSurveyId(""); setValidationError(""); setShowValidationModal(false);
    setQuestions([{ text: "", options: [{ text: "" }], isSingle: true }]);
  };

  const validateForm = () => {
    if (!surveyTitle || surveyTitle.trim() === "") {
      const errorMsg = "Survey title is required. Please enter a title for your survey.";
      setValidationError(errorMsg); setShowValidationModal(true);
      window.scrollTo({ top: 0, behavior: "smooth" }); return false;
    }
    if (questions.length === 0) {
      const errorMsg = "Survey must have at least one question.";
      setValidationError(errorMsg); setShowValidationModal(true);
      window.scrollTo({ top: 0, behavior: "smooth" }); return false;
    }
    // ✅ null = unlimited, skip check
    if (questionLimit !== null && questions.length > questionLimit) {
      const errorMsg = `Your ${PLAN_LABELS[planName]} plan allows only ${questionLimit} question(s) per survey. Please remove ${questions.length - questionLimit} question(s) or upgrade your plan.`;
      setValidationError(errorMsg); setShowValidationModal(true);
      window.scrollTo({ top: 0, behavior: "smooth" }); return false;
    }
    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      if (!question.text || question.text.trim() === "") {
        const errorMsg = `Question ${i + 1} must have text. Please enter a question.`;
        setValidationError(errorMsg); setShowValidationModal(true);
        window.scrollTo({ top: 0, behavior: "smooth" }); return false;
      }
      if (question.isTextBox || question.isConditional) continue;
      if (!question.options || question.options.length === 0) {
        const errorMsg = `Question ${i + 1} must have at least one option.`;
        setValidationError(errorMsg); setShowValidationModal(true);
        window.scrollTo({ top: 0, behavior: "smooth" }); return false;
      }
      const emptyOptionIndex = question.options.findIndex(
        (opt) => !opt.text || opt.text.trim() === ""
      );
      if (emptyOptionIndex !== -1) {
        const errorMsg = `Question ${i + 1}, Option ${emptyOptionIndex + 1} must have text.`;
        setValidationError(errorMsg); setShowValidationModal(true);
        window.scrollTo({ top: 0, behavior: "smooth" }); return false;
      }
    }
    return true;
  };

  const handleFormSubmit = (e) => {
    if (!validateForm()) { e.preventDefault(); return false; }
    setValidationError(""); return true;
  };

  const surveyRows = surveys.map((survey, index) => [
    <Box paddingBlock="200" key={`badge-${survey.id}`}>
      <Badge tone="info" size="large">{index + 1}</Badge>
    </Box>,
    <BlockStack gap="200" key={`details-${survey.id}`}>
      <Text variant="headingSm" fontWeight="bold">{survey.title}</Text>
      <InlineStack gap="200">
        <Badge tone="success">
          <InlineStack gap="100" blockAlign="center">
            <Icon source={QuestionCircleIcon} />
            <Text as="span">{survey.questions?.length || 0} Questions</Text>
          </InlineStack>
        </Badge>
        {survey.isFrenchVersion
          ? <Badge tone="magic">🇫🇷 French</Badge>
          : <Badge tone="info">🌐 Default</Badge>
        }
      </InlineStack>
    </BlockStack>,
    <InlineStack key={`actions-${survey.id}`} gap="200">
      <Tooltip content="Preview survey">
        <Button onClick={() => handleViewSurvey(survey)} icon={ViewIcon} size="slim" variant="tertiary" disabled={isSubmitting || isDeleting}>View</Button>
      </Tooltip>
      <Tooltip content="Edit survey">
        <Button onClick={() => handleEditSurvey(survey)} icon={EditIcon} variant="primary" size="slim" disabled={isSubmitting || isDeleting}>Edit</Button>
      </Tooltip>
      <Tooltip content="Delete survey">
        <Button onClick={() => handleDeleteSurvey(survey.id)} icon={DeleteIcon} size="slim" tone="critical" disabled={isSubmitting || isDeleting}>Delete</Button>
      </Tooltip>
    </InlineStack>,
  ]);

  return (
    <Page fullWidth>
      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(-10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-in { animation: slideIn 0.3s ease-out; }
      `}</style>

      <BlockStack gap="600">

        {/* ── Store + Plan Banner ── */}
        <Banner tone="info">
          <InlineStack align="space-between" blockAlign="center" wrap={false}>
            <Text variant="bodyMd" fontWeight="semibold">🏪 Store: {shop}</Text>
            <InlineStack gap="200" blockAlign="center">
              <Badge tone={planName === "advanced" ? "success" : planName === "pro" ? "info" : "subdued"}>
                {PLAN_LABELS[planName]} Plan
              </Badge>
              <Text variant="bodySm" tone="subdued">
                {questionLimit === null
                  ? "Unlimited questions per survey"
                  : `${questionLimit} question(s) per survey`
                }
              </Text>
              <Button size="slim" variant="primary" onClick={() => navigate("/app/billing")}>
                Manage Plan
              </Button>
            </InlineStack>
          </InlineStack>
        </Banner>

        {isSubmitting && (
          <Banner tone="info">
            <InlineStack gap="200" blockAlign="center">
              <Spinner size="small" />
              <Text variant="bodyMd" fontWeight="semibold">
                {activeSurvey ? "Updating survey..." : "Creating survey..."} Please wait.
              </Text>
            </InlineStack>
          </Banner>
        )}

        {actionData?.error && (
          <Banner
            tone={actionData.limitReached ? "warning" : "critical"}
            action={actionData.limitReached
              ? { content: "⬆️ Upgrade Plan", onAction: () => navigate("/app/billing") }
              : undefined
            }
            onDismiss={() => {}}
          >
            <InlineStack gap="200" blockAlign="center">
              <Icon source={AlertCircleIcon} />
              <Text variant="bodyMd" fontWeight="semibold">{actionData.error}</Text>
            </InlineStack>
          </Banner>
        )}

        {validationError && (
          <Banner tone="critical" onDismiss={() => { setValidationError(""); setShowValidationModal(false); }}>
            <InlineStack gap="200" blockAlign="center">
              <Icon source={AlertCircleIcon} />
              <Text variant="bodyMd" fontWeight="semibold">{validationError}</Text>
            </InlineStack>
          </Banner>
        )}

        {hasReachedLimit && !activeSurvey && (
          <Banner tone="warning">
            <InlineStack gap="200" blockAlign="center">
              <Icon source={AlertCircleIcon} />
              <Text variant="bodyMd" fontWeight="semibold">
                ⚠️ Maximum survey limit reached (2/2). Delete one to create a new survey.
              </Text>
            </InlineStack>
          </Banner>
        )}

        <Box paddingBlockEnd="200">
          <InlineStack align="space-between" blockAlign="center" wrap={false}>
            <BlockStack gap="200">
              <Text variant="heading2xl" as="h1">Survey Management Dashboard</Text>
              <Text variant="bodyLg" tone="subdued">
                Create and manage your surveys —{" "}
                {questionLimit === null
                  ? `Unlimited questions per survey on your ${PLAN_LABELS[planName]} plan`
                  : `Up to ${questionLimit} question(s) per survey on your ${PLAN_LABELS[planName]} plan`
                }
              </Text>
            </BlockStack>
            {(activeSurvey || surveys.length > 0) && (
              <Button
                size="large"
                onClick={handleNewSurvey}
                icon={PlusCircleIcon}
                variant="primary"
                disabled={hasReachedLimit || isSubmitting || isDeleting}
              >
                Create New Survey
              </Button>
            )}
          </InlineStack>
        </Box>

        {/* ── Stats cards ── */}
        <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="start">
                <Text variant="headingSm" tone="subdued">Total Surveys</Text>
                <Icon source={CheckCircleIcon} tone="success" />
              </InlineStack>
              <InlineStack gap="200" blockAlign="baseline">
                <Text variant="heading2xl" fontWeight="bold">{surveys.length}</Text>
                <Text variant="bodyMd" tone="subdued">/ 2</Text>
              </InlineStack>
              {hasReachedLimit && <Badge tone="warning">Limit Reached</Badge>}
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="start">
                <Text variant="headingSm" tone="subdued">Total Questions</Text>
                <Icon source={QuestionCircleIcon} tone="info" />
              </InlineStack>
              <Text variant="heading2xl" fontWeight="bold">{totalQuestions}</Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="start">
                <Text variant="headingSm" tone="subdued">Questions / Survey</Text>
                <Badge tone={planName === "advanced" ? "success" : planName === "pro" ? "info" : "subdued"}>
                  {PLAN_LABELS[planName]}
                </Badge>
              </InlineStack>
              <Text variant="heading2xl" fontWeight="bold">{limitLabel}</Text>
              <Button
                size="slim"
                variant={planName === "advanced" ? "tertiary" : "primary"}
                tone={planName === "advanced" ? undefined : "success"}
                onClick={() => navigate("/app/billing")}
              >
                {planName === "advanced" ? "✓ Max Plan" : "⬆️ Upgrade for more"}
              </Button>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* ── Delete modal ── */}
        {isDeleteBannerVisible && (
          <Modal
            open={true}
            onClose={isDeleting ? undefined : cancelDeleteSurvey}
            title="Confirm Deletion"
            primaryAction={{ content: isDeleting ? "Deleting..." : "Delete Permanently", onAction: confirmDeleteSurvey, destructive: true, loading: isDeleting, disabled: isDeleting }}
            secondaryActions={[{ content: "Cancel", onAction: cancelDeleteSurvey, disabled: isDeleting }]}
          >
            <Modal.Section>
              <BlockStack gap="400">
                {isDeleting && (
                  <Banner tone="info">
                    <InlineStack gap="200" blockAlign="center">
                      <Spinner size="small" />
                      <Text variant="bodyMd" fontWeight="semibold">Deleting survey, please wait...</Text>
                    </InlineStack>
                  </Banner>
                )}
                <Banner tone="critical">
                  <BlockStack gap="300">
                    <Text variant="headingSm" fontWeight="bold">⚠️ This action cannot be undone!</Text>
                    <Text variant="bodyMd">Deleting this survey will permanently remove:</Text>
                    <List type="bullet">
                      <List.Item>The survey and all its questions</List.Item>
                      <List.Item>All user responses and data</List.Item>
                      <List.Item>Any associated analytics</List.Item>
                    </List>
                  </BlockStack>
                </Banner>
              </BlockStack>
            </Modal.Section>
          </Modal>
        )}

        <InlineGrid gap="500" columns={{ xs: 1, lg: 2 }}>

          {/* ── Survey Form ── */}
          {(activeSurvey || !hasReachedLimit) && (
            <Form method="post" onSubmit={handleFormSubmit}>
              <Card>
                <BlockStack gap="600">
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="200">
                        <Text variant="headingXl" as="h2">
                          {activeSurvey ? "✏️ Edit Survey" : "✨ Create New Survey"}
                        </Text>
                        <Text variant="bodySm" tone="subdued">
                          {activeSurvey ? "Update your survey details below" : "Build your survey step by step"}
                        </Text>
                      </BlockStack>
                    </InlineStack>
                    <Divider />
                  </BlockStack>

                  <FormLayout>
                    <Card background="bg-surface-secondary">
                      <BlockStack gap="400">
                        <InlineStack gap="200" blockAlign="center">
                          <Icon source={EditIcon} />
                          <Text variant="headingMd" fontWeight="bold">Survey Details</Text>
                        </InlineStack>
                        <TextField
                          label="Survey Title"
                          value={surveyTitle}
                          onChange={(value) => { setSurveyTitle(value); if (validationError) { setValidationError(""); setShowValidationModal(false); } }}
                          name="quizTitle"
                          id="quizTitle"
                          placeholder="e.g., Customer Satisfaction Survey"
                          requiredIndicator
                          autoComplete="off"
                          helpText="Choose a clear, descriptive title for your survey"
                          disabled={isSubmitting}
                        />
                        <Card background="bg-surface">
                          <BlockStack gap="300">
                            <Checkbox
                              label={<InlineStack gap="200" blockAlign="center"><Text as="span">🇫🇷 French Version Survey</Text></InlineStack>}
                              checked={isFrenchVersion}
                              onChange={(value) => setIsFrenchVersion(value)}
                              helpText={isFrenchVersion ? "This is a French language survey" : "This is a default (non-French) survey"}
                              disabled={
                                isSubmitting ||
                                (isFrenchVersion && hasFrenchVersion && !activeSurvey?.isFrenchVersion) ||
                                (!isFrenchVersion && hasNonFrenchVersion && activeSurvey?.isFrenchVersion)
                              }
                            />
                            {!activeSurvey && (
                              <Text variant="bodySm" tone="subdued">
                                {hasFrenchVersion && !hasNonFrenchVersion && "⚠️ You need to create a non-French (default) survey"}
                                {!hasFrenchVersion && hasNonFrenchVersion && "⚠️ You need to create a French survey"}
                                {!hasFrenchVersion && !hasNonFrenchVersion && "ℹ️ Choose survey language (one of each type allowed)"}
                                {hasFrenchVersion && hasNonFrenchVersion && "✅ You have both survey types"}
                              </Text>
                            )}
                          </BlockStack>
                        </Card>
                      </BlockStack>
                    </Card>

                    <BlockStack gap="400">
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="100">
                          <InlineStack gap="200" blockAlign="center">
                            <Icon source={QuestionCircleIcon} />
                            <Text variant="headingMd" fontWeight="bold">Questions</Text>
                            {/* ✅ Shows x / ∞ or x / 5 etc */}
                            <Badge tone={hasReachedQLimit ? "critical" : "info"}>
                              {questions.length} / {limitLabel}
                            </Badge>
                          </InlineStack>
                          <Text variant="bodySm" tone="subdued">
                            {questionLimit === null
                              ? "Unlimited questions on your Advanced plan"
                              : `Your ${PLAN_LABELS[planName]} plan allows up to ${questionLimit} question(s)`
                            }
                          </Text>
                        </BlockStack>

                        {/* ✅ Only disable when there's an actual limit AND it's reached */}
                        <Tooltip content={
                          hasReachedQLimit
                            ? `Upgrade to add more than ${questionLimit} question(s)`
                            : "Add a new question"
                        }>
                          <Button
                            onClick={handleAddQuestion}
                            icon={PlusCircleIcon}
                            variant="primary"
                            disabled={isSubmitting || hasReachedQLimit}
                          >
                            Add Question
                          </Button>
                        </Tooltip>
                      </InlineStack>

                      {/* ✅ Only show upgrade banner when there's a real limit reached */}
                      {hasReachedQLimit && questionLimit !== null && (
                        <Banner
                          tone="warning"
                          action={{ content: "⬆️ Upgrade Plan", onAction: () => navigate("/app/billing") }}
                        >
                          <Text variant="bodyMd">
                            You've reached the <strong>{questionLimit} question</strong> limit on your{" "}
                            <strong>{PLAN_LABELS[planName]}</strong> plan.
                            Upgrade to {planName === "free" ? "Pro (5 questions)" : "Advanced (unlimited)"}.
                          </Text>
                        </Banner>
                      )}

                      <Divider />
                    </BlockStack>

                    <BlockStack gap="400">
                      {questions.map((question, index) => (
                        <div key={index} className="animate-slide-in">
                          <Card background="bg-surface-brand">
                            <BlockStack gap="500">
                              <InlineStack align="space-between" blockAlign="start">
                                <InlineStack gap="300" blockAlign="center">
                                  <Badge tone="success" size="large">Q{index + 1}</Badge>
                                  <Text variant="headingSm" fontWeight="semibold">Question {index + 1}</Text>
                                  {question.isSingle && <Badge tone="attention">Single Choice</Badge>}
                                </InlineStack>
                                <Tooltip content="Remove this question">
                                  <Button onClick={() => handleRemoveQuestion(index)} icon={DeleteIcon} variant="plain" tone="critical" disabled={isSubmitting} />
                                </Tooltip>
                              </InlineStack>

                              <Card background="bg-surface-secondary">
                                <BlockStack gap="300">
                                  <Text variant="headingXs" fontWeight="medium">Question Type</Text>
                                  <InlineGrid columns={3} gap="300">
                                    <Tooltip content="Yes/No question with conditional logic">
                                      <Checkbox label="🔀 Conditional" checked={question.isConditional || false} disabled={question.isMultiChoice || question.isTextBox || isSubmitting} onChange={(v) => handleInputChange(index, "isConditional", v)} />
                                    </Tooltip>
                                    <Tooltip content="Open-ended text response">
                                      <Checkbox label="📝 Text Box" checked={question.isTextBox || false} disabled={question.isMultiChoice || question.isConditional || isSubmitting} onChange={(v) => handleInputChange(index, "isTextBox", v)} />
                                    </Tooltip>
                                    <Tooltip content="Allow multiple answer selections">
                                      <Checkbox label="☑️ Multi-Choice" checked={question.isMultiChoice || false} disabled={question.isConditional || question.isTextBox || isSubmitting} onChange={(v) => handleInputChange(index, "isMultiChoice", v)} />
                                    </Tooltip>
                                  </InlineGrid>
                                  {question.isSingle && (
                                    <Text variant="bodySm" tone="subdued">
                                      ℹ️ No type selected — defaulting to <strong>Single Choice</strong>
                                    </Text>
                                  )}
                                </BlockStack>
                              </Card>

                              <TextField
                                label="Question Text"
                                placeholder="Enter your question here..."
                                value={question.text}
                                onChange={(value) => { handleInputChange(index, "text", value); if (validationError) { setValidationError(""); setShowValidationModal(false); } }}
                                autoComplete="off"
                                multiline={2}
                                requiredIndicator
                                disabled={isSubmitting}
                              />

                              {!question.isTextBox && (
                                <Card background="bg-surface">
                                  <BlockStack gap="400">
                                    <InlineStack align="space-between" blockAlign="center">
                                      <Text variant="headingSm" fontWeight="medium">Answer Options</Text>
                                      {!question.isConditional && (
                                        <Button onClick={() => handleAddOption(index)} icon={PlusCircleIcon} variant="primary" tone="success" size="slim" disabled={isSubmitting}>Add Option</Button>
                                      )}
                                    </InlineStack>
                                    <BlockStack gap="300">
                                      {question.isConditional ? (
                                        <>
                                          <Card background="bg-surface-secondary" padding="300">
                                            <InlineStack gap="200" blockAlign="center">
                                              <Badge tone="success">✓</Badge>
                                              <TextField disabled value="Yes" />
                                            </InlineStack>
                                          </Card>
                                          <Card background="bg-surface-secondary" padding="300">
                                            <InlineStack gap="200" blockAlign="center">
                                              <Badge tone="critical">✗</Badge>
                                              <TextField disabled value="No" />
                                            </InlineStack>
                                          </Card>
                                        </>
                                      ) : (
                                        question.options.map((option, optIndex) => (
                                          <Card key={optIndex} background="bg-surface-secondary" padding="300">
                                            <InlineStack gap="200" blockAlign="center">
                                              <Badge>{optIndex + 1}</Badge>
                                              <Box width="100%">
                                                <TextField
                                                  placeholder={`Option ${optIndex + 1}`}
                                                  value={option.text}
                                                  onChange={(value) => {
                                                    const updatedQuestions = [...questions];
                                                    updatedQuestions[index].options[optIndex].text = value;
                                                    setQuestions(updatedQuestions);
                                                    if (validationError) { setValidationError(""); setShowValidationModal(false); }
                                                  }}
                                                  autoComplete="off"
                                                  requiredIndicator
                                                  disabled={isSubmitting}
                                                />
                                              </Box>
                                              <div style={{ display: "none" }}>
                                                {!question.isConditional && !question.isTextBox && (
                                                  <Tooltip content={option.haveTextBox ? "Text field enabled" : "Add text field"}>
                                                    <Button
                                                      onClick={() => {
                                                        const updatedQuestions = [...questions];
                                                        updatedQuestions[index].options[optIndex].haveTextBox = !updatedQuestions[index].options[optIndex].haveTextBox;
                                                        setQuestions(updatedQuestions);
                                                      }}
                                                      icon={questions[index].options[optIndex].haveTextBox ? ToggleOnIcon : ToggleOffIcon}
                                                      variant={questions[index].options[optIndex].haveTextBox ? "primary" : "secondary"}
                                                      size="slim"
                                                      disabled={isSubmitting}
                                                    />
                                                  </Tooltip>
                                                )}
                                              </div>
                                              <Tooltip content="Remove this option">
                                                <Button onClick={() => handleRemoveOption(index, optIndex)} icon={DeleteIcon} tone="critical" size="slim" disabled={isSubmitting} />
                                              </Tooltip>
                                            </InlineStack>
                                          </Card>
                                        ))
                                      )}
                                    </BlockStack>
                                  </BlockStack>
                                </Card>
                              )}
                            </BlockStack>
                          </Card>
                        </div>
                      ))}
                    </BlockStack>

                    <input type="hidden" name="questions" value={JSON.stringify(questions)} />
                    <input type="hidden" name="surveyId" value={activeSurvey ? activeSurvey.id : ""} />
                    <input type="hidden" name="isFrenchVersion" value={isFrenchVersion} />
                    <input type="hidden" name="frenchSurveyId" value={selectedSurveyId || ""} />

                    <Box paddingBlockStart="400">
                      <Button submit icon={SaveIcon} variant="primary" size="large" fullWidth tone="success" loading={isSubmitting} disabled={isSubmitting}>
                        {activeSurvey ? "💾 Update Survey" : "✨ Save Survey"}
                      </Button>
                    </Box>
                  </FormLayout>
                </BlockStack>
              </Card>
            </Form>
          )}

          {/* ── Survey list ── */}
          <Card>
            <BlockStack gap="500">
              <BlockStack gap="300">
                <BlockStack gap="200">
                  <Text variant="headingXl" as="h2">Your Surveys</Text>
                  <Text variant="bodySm" tone="subdued">
                    Manage your surveys (Max: 1 French + 1 Non-French) —{" "}
                    {PLAN_LABELS[planName]}: {limitLabel} questions/survey
                  </Text>
                </BlockStack>
                <Divider />
              </BlockStack>
              {surveys.length > 0 ? (
                <DataTable
                  columnContentTypes={["text", "text", "text"]}
                  headings={[
                    <Text variant="headingXs" fontWeight="semibold" key="h1">#</Text>,
                    <Text variant="headingXs" fontWeight="semibold" key="h2">Survey Details</Text>,
                    <Text variant="headingXs" fontWeight="semibold" key="h3">Actions</Text>,
                  ]}
                  rows={surveyRows}
                  hoverable
                />
              ) : (
                <Box padding="1600">
                  <EmptyState heading="No surveys yet" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                    <p>Create your first survey to get started (Maximum: 1 French + 1 Non-French)</p>
                  </EmptyState>
                </Box>
              )}
            </BlockStack>
          </Card>
        </InlineGrid>
      </BlockStack>

      {/* ── View Survey Modal ── */}
      {activeSurvey && (
        <Modal open={modalOpen} onClose={handleCloseModal} title={<BlockStack gap="200"><Text variant="headingLg" fontWeight="bold">{activeSurvey.title}</Text></BlockStack>} large>
          <Modal.Section>
            <BlockStack gap="500">
              <Card background="bg-surface-secondary">
                <InlineStack gap="300" wrap>
                  <Badge tone="success" size="large">
                    <InlineStack gap="100" blockAlign="center">
                      <Icon source={QuestionCircleIcon} />
                      <Text as="span">{activeSurvey.questions?.length || 0} Questions</Text>
                    </InlineStack>
                  </Badge>
                  {activeSurvey.isFrenchVersion
                    ? <Badge tone="magic" size="large">🇫🇷 French Version</Badge>
                    : <Badge tone="info" size="large">🌐 Default Version</Badge>
                  }
                </InlineStack>
              </Card>
              <Divider />
              <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                {activeSurvey.questions.map((question, questionIndex) => (
                  <Card key={question.id} background="bg-surface-brand">
                    <BlockStack gap="400">
                      <InlineStack gap="200" blockAlign="start">
                        <Badge tone="info" size="large">Q{questionIndex + 1}</Badge>
                      </InlineStack>
                      <Text variant="headingMd" fontWeight="bold">{question.text}</Text>
                      <InlineStack gap="200" wrap>
                        {question.isConditional && <Badge tone="attention">🔀 Conditional</Badge>}
                        {question.isMultiChoice && <Badge tone="success">☑️ Multi-Choice</Badge>}
                        {question.isTextBox && <Badge tone="info">📝 Text Box</Badge>}
                        {!question.isConditional && !question.isMultiChoice && !question.isTextBox && <Badge tone="warning">🔘 Single Choice</Badge>}
                      </InlineStack>
                      {!question.isTextBox && (
                        <Card background="bg-surface">
                          <BlockStack gap="300">
                            <Text variant="headingXs" fontWeight="medium" tone="subdued">Answer Options:</Text>
                            <List type="bullet">
                              {question.answers.map((answer) => (
                                <List.Item key={answer.id}>
                                  <InlineStack gap="200" blockAlign="center">
                                    <Text variant="bodyMd">{answer.text}</Text>
                                    {answer.haveTextBox && <Tooltip content="Includes additional text field"><Badge tone="attention" size="small">+ Text</Badge></Tooltip>}
                                  </InlineStack>
                                </List.Item>
                              ))}
                            </List>
                          </BlockStack>
                        </Card>
                      )}
                    </BlockStack>
                  </Card>
                ))}
              </InlineGrid>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* ── Validation Modal ── */}
      <Modal open={showValidationModal} onClose={() => setShowValidationModal(false)} title="⚠️ Validation Error" primaryAction={{ content: "Got it", onAction: () => setShowValidationModal(false) }}>
        <Modal.Section>
          <BlockStack gap="400">
            <Banner tone="critical">
              <BlockStack gap="300">
                <Text variant="headingMd" fontWeight="bold">Please fix the following error:</Text>
                <Text variant="bodyLg">{validationError}</Text>
              </BlockStack>
            </Banner>
            <Text variant="bodyMd" tone="subdued">Please correct the error and try submitting again.</Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
