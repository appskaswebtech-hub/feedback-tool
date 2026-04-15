  // app/routes/app.manage.jsx

  import {
    Card, Page, IndexTable, TextField, Select, Text, InlineStack, Box, BlockStack,
    Modal, Button, Badge, DatePicker, Pagination, EmptyState, Banner, Divider, Icon,
    Tooltip, Spinner, SkeletonBodyText, SkeletonDisplayText,
  } from "@shopify/polaris";
  import { TitleBar } from "@shopify/app-bridge-react";
  import { Form, json, useLoaderData, useNavigation, useSubmit, useSearchParams, useNavigate } from "@remix-run/react";
  import { useState, useMemo, useCallback, useEffect } from "react";
  import { PrismaClient } from "@prisma/client";
  import { ExportIcon, SearchIcon, ViewIcon, DeleteIcon, CalendarIcon, FilterIcon } from "@shopify/polaris-icons";
  import * as XLSX from "xlsx";
  import { authenticate } from "../shopify.server";
  import { getT, LANG_KEY_TO_ISO } from "../utils/translations";

  const prisma = new PrismaClient();
  const ITEMS_PER_PAGE = 10;

  const LANGUAGES_DROPDOWN = [
    { label: "🌐  Default (English)", value: "default" },
    { label: "🇫🇷  French",           value: "french" },
    { label: "🇪🇸  Spanish",          value: "spanish" },
    { label: "🇮🇹  Italian",          value: "italian" },
    { label: "🇩🇪  German",           value: "german" },
  ];

  export const loader = async ({ request }) => {
    try {
      const { session, admin } = await authenticate.admin(request);
      const shop = session.shop;
      const response = await admin.graphql(`#graphql
        query { shop { url } }`);
      const data = await response.json();
      if (!data.data?.shop?.url) throw new Error("Unable to fetch shop information");
      const url = data.data.shop.url;
      const shopDomain = url.replace("https://", "");
      const feedbacks = await prisma.apiProxyData.findMany({ where: { shop }, orderBy: { createdAt: "desc" } });
      const surveyData = await prisma.survey.findMany({ where: { shop }, include: { questions: true } });
      return json({ feedbacks, surveyData, shop, shopDomain, success: true });
    } catch (error) {
      console.error("Loader error:", error);
      return json({ feedbacks: [], surveyData: [], shop: null, shopDomain: null, success: false, error: error.message }, { status: 500 });
    }
  };

  export const action = async ({ request }) => {
    try {
      const { session } = await authenticate.admin(request);
      const shop = session.shop;
      const formData = await request.formData();
      const id = formData.get("id");
      const actionType = formData.get("_action");
      if (!id) return json({ success: false, error: "Missing feedback ID" }, { status: 400 });
      if (actionType === "delete") {
        const feedback = await prisma.apiProxyData.findFirst({ where: { id: parseInt(id, 10), shop } });
        if (!feedback) return json({ success: false, error: "Feedback not found or access denied" }, { status: 403 });
        await prisma.apiProxyData.delete({ where: { id: parseInt(id, 10) } });
        return json({ success: true, message: "Feedback deleted successfully" });
      }
      return json({ success: false, error: "Invalid action" }, { status: 400 });
    } catch (error) {
      console.error("Action error:", error);
      return json({ success: false, error: "Failed to delete feedback" }, { status: 500 });
    }
  };

  const formatDate = (dateString) =>
    new Date(dateString).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
  const formatTime = (dateString) =>
    new Date(dateString).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const safeJSONParse = (jsonString, fallback = []) => {
    try { return JSON.parse(jsonString); } catch { return fallback; }
  };

  export default function Manage() {
    const { feedbacks = [], surveyData = [], shop, shopDomain, error } = useLoaderData();
    const navigation = useNavigation();
    const submit = useSubmit();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const isLoading = navigation.state === "loading" || navigation.state === "submitting";

    // ── Language from URL ──────────────────────────────────────
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

    const handleLanguageChange = useCallback(
      (value) => {
        setSearchParams((prev) => {
          if (value === "default") prev.delete("lang");
          else prev.set("lang", value);
          return prev;
        });
      },
      [setSearchParams],
    );

    // ── Translated dropdown options ────────────────────────────
    const SORT_OPTIONS = useMemo(() => [
      { label: t("fb_sort_newest"), value: "date-desc" },
      { label: t("fb_sort_oldest"), value: "date-asc" },
      { label: t("fb_sort_email_az"), value: "email-asc" },
      { label: t("fb_sort_email_za"), value: "email-desc" },
    ], [t]);

    const STATUS_FILTER_OPTIONS = useMemo(() => [
      { label: t("fb_status_all"), value: "" },
      { label: t("fb_status_completed"), value: "complete" },
      { label: t("fb_status_not_submitted"), value: "incomplete" },
      { label: t("fb_status_partial"), value: "partially" },
    ], [t]);

    const EXPORT_FORMAT_OPTIONS = useMemo(() => [
      { label: t("fb_export_choose"), value: "", disabled: true },
      { label: t("fb_export_excel"), value: "excel" },
      { label: t("fb_export_csv"), value: "csv" },
      { label: t("fb_export_json"), value: "json" },
    ], [t]);

    const getQuizStatus = useCallback((answers, total) => {
      const count = answers.length;
      if (count === 0) return { label: t("fb_status_not_submitted_label"), tone: "critical", progress: "incomplete" };
      if (count === total) return { label: t("fb_status_completed_label"), tone: "success", progress: "complete" };
      return { label: t("fb_status_partial_label"), tone: "warning", progress: "partiallyComplete" };
    }, [t]);

    // ── State ──────────────────────────────────────────────────
    const [isExportModalOpen, setIsExportModalOpen] = useState(false);
    const [isViewModalOpen, setIsViewModalOpen] = useState(false);
    const [exportFormat, setExportFormat] = useState("");
    const [selectedDates, setSelectedDates] = useState({
      start: new Date(new Date().setMonth(new Date().getMonth() - 1)), end: new Date(),
    });
    const [selectedFeedback, setSelectedFeedback] = useState(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [sortField, setSortField] = useState("date");
    const [sortOrder, setSortOrder] = useState("desc");
    const [currentPage, setCurrentPage] = useState(1);
    const [quizStatusFilter, setQuizStatusFilter] = useState("");
    const [month, setMonth] = useState(new Date().getMonth());
    const [year, setYear] = useState(new Date().getFullYear());
    const [deleteConfirmId, setDeleteConfirmId] = useState(null);

    const processedFeedbacks = useMemo(
      () => feedbacks.map((feedback, index) => ({
        sr: index + 1, id: feedback.id.toString(), email: feedback.email || "N/A",
        date: formatDate(feedback.createdAt), time: formatTime(feedback.createdAt),
        dateObj: new Date(feedback.createdAt), answers: safeJSONParse(feedback.answers), rawFeedback: feedback,
      })),
      [feedbacks],
    );

    const totalQuestions = useMemo(() => surveyData[0]?.questions?.length || 0, [surveyData]);

    const filteredFeedbacks = useMemo(() => {
      let result = [...processedFeedbacks];
      if (searchTerm) {
        const sl = searchTerm.toLowerCase();
        result = result.filter((f) => f.email.toLowerCase().includes(sl));
      }
      if (quizStatusFilter) {
        result = result.filter(({ answers }) => {
          const c = answers.length;
          if (quizStatusFilter === "complete") return c === totalQuestions;
          if (quizStatusFilter === "incomplete") return c === 0;
          if (quizStatusFilter === "partially") return c > 0 && c < totalQuestions;
          return true;
        });
      }
      result.sort((a, b) => {
        if (sortField === "email") { const cmp = a.email.localeCompare(b.email); return sortOrder === "asc" ? cmp : -cmp; }
        const cmp = a.dateObj - b.dateObj; return sortOrder === "asc" ? cmp : -cmp;
      });
      return result;
    }, [processedFeedbacks, searchTerm, sortField, sortOrder, quizStatusFilter, totalQuestions]);

    const statistics = useMemo(() => {
      const total = processedFeedbacks.length;
      const completed = processedFeedbacks.filter((f) => f.answers.length === totalQuestions).length;
      const partial = processedFeedbacks.filter((f) => f.answers.length > 0 && f.answers.length < totalQuestions).length;
      const notSubmitted = processedFeedbacks.filter((f) => f.answers.length === 0).length;
      return { total, completed, partial, notSubmitted };
    }, [processedFeedbacks, totalQuestions]);

    const totalPages = Math.ceil(filteredFeedbacks.length / ITEMS_PER_PAGE);
    const paginatedFeedbacks = useMemo(() => {
      const start = (currentPage - 1) * ITEMS_PER_PAGE;
      return filteredFeedbacks.slice(start, start + ITEMS_PER_PAGE);
    }, [filteredFeedbacks, currentPage]);

    const handleMonthChange = useCallback((m, y) => { setMonth(m); setYear(y); }, []);
    const handleSearchChange = useCallback((v) => { setSearchTerm(v); setCurrentPage(1); }, []);
    const handleSortChange = useCallback((v) => { const [f, o] = v.split("-"); setSortField(f); setSortOrder(o); setCurrentPage(1); }, []);
    const handleQuizStatusChange = useCallback((v) => { setQuizStatusFilter(v); setCurrentPage(1); }, []);
    const clearAllFilters = useCallback(() => { setSearchTerm(""); setQuizStatusFilter(""); setCurrentPage(1); }, []);
    const handleViewFeedback = useCallback((fb) => { setSelectedFeedback(fb); setIsViewModalOpen(true); }, []);
    const handleCloseViewModal = useCallback(() => { setIsViewModalOpen(false); setSelectedFeedback(null); }, []);
    const handleDeleteClick = useCallback((id) => setDeleteConfirmId(id), []);
    const handleDeleteConfirm = useCallback(() => {
      if (deleteConfirmId) {
        const fd = new FormData(); fd.append("id", deleteConfirmId); fd.append("_action", "delete");
        submit(fd, { method: "post" }); setDeleteConfirmId(null);
      }
    }, [deleteConfirmId, submit]);

    const handleExport = useCallback(() => {
      if (!exportFormat) return;
      const dataToExport = filteredFeedbacks
        .filter((f) => f.dateObj >= selectedDates.start && f.dateObj <= selectedDates.end)
        .map((f) => ({
          ID: f.id, Email: f.email, "Submitted Date": f.date, "Submitted Time": f.time,
          Status: getQuizStatus(f.answers, totalQuestions).label, "Total Answers": f.answers.length,
          "Total Questions": totalQuestions,
          Answers: f.answers.map((a) => `${a.questionTitle}: ${a.answer}`).join("; "),
        }));
      try {
        if (exportFormat === "excel") {
          const ws = XLSX.utils.json_to_sheet(dataToExport); const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, "Feedbacks");
          ws["!cols"] = [{ wch: 10 }, { wch: 30 }, { wch: 20 }, { wch: 15 }, { wch: 18 }, { wch: 15 }, { wch: 15 }, { wch: 60 }];
          XLSX.writeFile(wb, `feedbacks_${shop}_${Date.now()}.xlsx`);
        } else {
          const ws = XLSX.utils.json_to_sheet(dataToExport);
          const content = exportFormat === "csv" ? XLSX.utils.sheet_to_csv(ws) : JSON.stringify(dataToExport, null, 2);
          const type = exportFormat === "csv" ? "text/csv;charset=utf-8;" : "application/json";
          const blob = new Blob([content], { type }); const url = window.URL.createObjectURL(blob);
          const link = document.createElement("a"); link.href = url;
          link.download = `feedbacks_${shop}_${Date.now()}.${exportFormat === "csv" ? "csv" : "json"}`;
          document.body.appendChild(link); link.click(); document.body.removeChild(link); window.URL.revokeObjectURL(url);
        }
        setIsExportModalOpen(false); setExportFormat("");
      } catch (err) { console.error("Export error:", err); alert("Failed to export."); }
    }, [filteredFeedbacks, selectedDates, exportFormat, totalQuestions, shop, getQuizStatus]);

    const activeFilters = useMemo(() => {
      const f = []; if (searchTerm) f.push("search"); if (quizStatusFilter) f.push("status"); return f;
    }, [searchTerm, quizStatusFilter]);

    useEffect(() => { setCurrentPage(1); }, [searchTerm, quizStatusFilter]);

    if (error) {
      return (
        <Page title={t("fb_title")}>
          <Banner tone="critical"><p>{t("fb_load_error", { error })}</p></Banner>
        </Page>
      );
    }

    if (isLoading && feedbacks.length === 0) {
      return (
        <Page title={t("fb_title")}>
          <BlockStack gap="500">
            <Card><SkeletonDisplayText size="small" /><Box paddingBlockStart="400"><SkeletonBodyText lines={3} /></Box></Card>
            <Card><SkeletonBodyText lines={5} /></Card>
          </BlockStack>
        </Page>
      );
    }

    return (
      <Page
        title={t("fb_title")}
        subtitle={t("fb_subtitle", { shop: shop || "" })}
        backAction={{ content: t("fb_back"), url: withLang("/app/") }}
      >
        <BlockStack gap="500">

          {/* ── Top bar with language dropdown ── */}
          <InlineStack align="space-between" blockAlign="center" wrap={false}>
            <Banner tone="info">
              <InlineStack gap="200" blockAlign="center">
                <Text variant="bodyMd" fontWeight="semibold">🏪 {t("store_label")}: {shop}</Text>
                {shopDomain && (
                  <>
                    <Text variant="bodyMd" tone="subdued">|</Text>
                    <Text variant="bodyMd" tone="subdued">{t("fb_domain")}: {shopDomain}</Text>
                  </>
                )}
              </InlineStack>
            </Banner>
            <div style={{ minWidth: 200 }}>
              <Select label="" labelHidden options={LANGUAGES_DROPDOWN} value={uiLanguage} onChange={handleLanguageChange} />
            </div>
          </InlineStack>

          {/* ── Summary Statistics ── */}
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">{t("fb_summary")}</Text>
              <Divider />
              <InlineStack gap="600" wrap={false} blockAlign="center">
                <Box width="25%">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">{t("fb_total")}</Text>
                    <Text as="p" variant="heading2xl" fontWeight="bold">{statistics.total}</Text>
                  </BlockStack>
                </Box>
                <Divider borderColor="border" />
                <Box width="25%">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">{t("fb_completed")}</Text>
                    <Text as="p" variant="heading2xl" fontWeight="bold" tone="success">{statistics.completed}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">{statistics.total > 0 ? `${Math.round((statistics.completed / statistics.total) * 100)}%` : "0%"}</Text>
                  </BlockStack>
                </Box>
                <Divider borderColor="border" />
                <Box width="25%">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">{t("fb_partial")}</Text>
                    <Text as="p" variant="heading2xl" fontWeight="bold" tone="warning">{statistics.partial}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">{statistics.total > 0 ? `${Math.round((statistics.partial / statistics.total) * 100)}%` : "0%"}</Text>
                  </BlockStack>
                </Box>
                <Divider borderColor="border" />
                <Box width="25%">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">{t("fb_not_submitted")}</Text>
                    <Text as="p" variant="heading2xl" fontWeight="bold" tone="critical">{statistics.notSubmitted}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">{statistics.total > 0 ? `${Math.round((statistics.notSubmitted / statistics.total) * 100)}%` : "0%"}</Text>
                  </BlockStack>
                </Box>
              </InlineStack>
            </BlockStack>
          </Card>

          {/* ── Active Filters ── */}
          {activeFilters.length > 0 && (
            <Banner tone="info" onDismiss={clearAllFilters}>
              <InlineStack gap="200" blockAlign="center" wrap={false}>
                <Icon source={FilterIcon} />
                <Text as="p" fontWeight="semibold">{t("fb_filters_applied")}</Text>
                <Text as="p">{t("fb_showing", { filtered: filteredFeedbacks.length, total: processedFeedbacks.length })}</Text>
              </InlineStack>
            </Banner>
          )}

          {/* ── Filters & Search ── */}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">{t("fb_filters")}</Text>
                {activeFilters.length > 0 && <Button onClick={clearAllFilters} size="slim" variant="plain">{t("fb_clear_filters")}</Button>}
              </InlineStack>
              <Divider />
              <InlineStack gap="400" wrap={true} blockAlign="end">
                <Box minWidth="300px" style={{ flex: 1 }}>
                  <TextField label={t("fb_search")} value={searchTerm} onChange={handleSearchChange} placeholder={t("fb_search_placeholder")} autoComplete="off" prefix={<Icon source={SearchIcon} />} clearButton onClearButtonClick={() => handleSearchChange("")} />
                </Box>
                <Box minWidth="200px">
                  <Select label={t("fb_sort_by")} options={SORT_OPTIONS} onChange={handleSortChange} value={`${sortField}-${sortOrder}`} />
                </Box>
                <Box minWidth="200px">
                  <Select label={t("fb_filter_status")} options={STATUS_FILTER_OPTIONS} value={quizStatusFilter} onChange={handleQuizStatusChange} />
                </Box>
              </InlineStack>
            </BlockStack>
          </Card>

          {/* ── Feedback Table ── */}
          <Card padding="0">
            {paginatedFeedbacks.length === 0 ? (
              <Box padding="1600">
                <EmptyState
                  heading={activeFilters.length > 0 ? t("fb_no_match") : t("fb_no_found")}
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>{activeFilters.length > 0 ? t("fb_no_match_desc") : t("fb_no_found_desc")}</p>
                  {activeFilters.length > 0 && <Box paddingBlockStart="400"><Button onClick={clearAllFilters}>{t("fb_clear_filters")}</Button></Box>}
                </EmptyState>
              </Box>
            ) : (
              <BlockStack>
                <IndexTable
                  resourceName={{ singular: t("fb_feedback_singular"), plural: t("fb_feedback_plural") }}
                  itemCount={filteredFeedbacks.length}
                  headings={[
                    { title: t("fb_col_hash") }, { title: t("fb_col_email") }, { title: t("fb_col_date") },
                    { title: t("fb_col_time") }, { title: t("fb_col_status") }, { title: t("fb_col_progress") },
                    { title: t("fb_col_actions"), alignment: "center" },
                  ]}
                  selectable={false} loading={isLoading}
                >
                  {paginatedFeedbacks.map(({ sr, id, email, date, time, answers, rawFeedback }, index) => {
                    const status = getQuizStatus(answers, totalQuestions);
                    return (
                      <IndexTable.Row id={id} key={id} position={index}>
                        <IndexTable.Cell><Text as="span" fontWeight="semibold" tone="subdued">{sr}</Text></IndexTable.Cell>
                        <IndexTable.Cell><Text as="span" fontWeight="medium">{email}</Text></IndexTable.Cell>
                        <IndexTable.Cell>
                          <InlineStack gap="100" blockAlign="center">
                            <Icon source={CalendarIcon} tone="subdued" /><Text as="span">{date}</Text>
                          </InlineStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell><Text as="span" tone="subdued">{time}</Text></IndexTable.Cell>
                        <IndexTable.Cell><Badge progress={status.progress} tone={status.tone}>{status.label}</Badge></IndexTable.Cell>
                        <IndexTable.Cell><Text as="span" variant="bodySm" tone="subdued">{t("fb_answers_count", { count: answers.length, total: totalQuestions })}</Text></IndexTable.Cell>
                        <IndexTable.Cell>
                          <InlineStack align="center" gap="200">
                            <Tooltip content={t("fb_view_details")}>
                              <Button onClick={() => handleViewFeedback(rawFeedback)} icon={ViewIcon} variant="primary" size="slim">{t("fb_view")}</Button>
                            </Tooltip>
                            <Tooltip content={t("fb_delete_tooltip")}>
                              <Button onClick={() => handleDeleteClick(id)} icon={DeleteIcon} tone="critical" variant="plain" size="slim" />
                            </Tooltip>
                          </InlineStack>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    );
                  })}
                </IndexTable>

                {totalPages > 1 && (
                  <Box padding="400" borderColor="border-subdued" borderBlockStartWidth="025">
                    <InlineStack align="center" gap="400">
                      <Pagination hasPrevious={currentPage > 1} hasNext={currentPage < totalPages} onPrevious={() => setCurrentPage(currentPage - 1)} onNext={() => setCurrentPage(currentPage + 1)} />
                      <Text as="p" variant="bodySm" tone="subdued">
                        {t("fb_page_info", { current: currentPage, total: totalPages, count: filteredFeedbacks.length, label: filteredFeedbacks.length === 1 ? t("fb_feedback_singular") : t("fb_feedback_plural") })}
                      </Text>
                    </InlineStack>
                  </Box>
                )}
              </BlockStack>
            )}
          </Card>
        </BlockStack>

        {/* ── View Details Modal ── */}
        {selectedFeedback && (
          <Modal open={isViewModalOpen} onClose={handleCloseViewModal} title={t("fb_details_title")} large>
            <Modal.Section>
              <BlockStack gap="500">
                <Box padding="400" background="bg-surface-secondary" borderRadius="300">
                  <InlineStack gap="800" wrap={true}>
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">{t("fb_email_label")}</Text>
                      <Text as="p" variant="headingMd" fontWeight="bold">{selectedFeedback.email || "N/A"}</Text>
                    </BlockStack>
                    <Divider borderColor="border" />
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">{t("fb_submitted_on")}</Text>
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        {formatDate(selectedFeedback.createdAt)} {t("fb_at")} {formatTime(selectedFeedback.createdAt)}
                      </Text>
                    </BlockStack>
                    <Divider borderColor="border" />
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">{t("fb_status_label")}</Text>
                      <Badge
                        progress={getQuizStatus(safeJSONParse(selectedFeedback.answers), totalQuestions).progress}
                        tone={getQuizStatus(safeJSONParse(selectedFeedback.answers), totalQuestions).tone}
                      >
                        {getQuizStatus(safeJSONParse(selectedFeedback.answers), totalQuestions).label}
                      </Badge>
                    </BlockStack>
                    <Divider borderColor="border" />
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">{t("fb_progress_label")}</Text>
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        {t("fb_answers_count", { count: safeJSONParse(selectedFeedback.answers).length, total: totalQuestions })}
                      </Text>
                    </BlockStack>
                  </InlineStack>
                </Box>
                <Divider />
                <BlockStack gap="400">
                  <Text as="h3" variant="headingMd">{t("fb_responses_title")}</Text>
                  {safeJSONParse(selectedFeedback.answers).length === 0 ? (
                    <Box padding="600" background="bg-surface-secondary" borderRadius="300">
                      <InlineStack align="center"><Text as="p" tone="subdued" alignment="center">{t("fb_no_responses")}</Text></InlineStack>
                    </Box>
                  ) : (
                    safeJSONParse(selectedFeedback.answers).map((ans, idx) => {
                      const mq = surveyData[0]?.questions.find((q) => q.text === ans.questionTitle);
                      const isMulti = mq?.isMultiChoice;
                      const hasMulti = ans.answer?.includes(",");
                      return (
                        <Box key={idx} padding="400" background="bg-surface" borderRadius="300" borderColor="border" borderWidth="025">
                          <BlockStack gap="300">
                            <InlineStack gap="200" blockAlign="center">
                              <Badge tone="info">Q{idx + 1}</Badge>
                              <Text as="p" variant="headingSm" fontWeight="bold">{ans.questionTitle}</Text>
                            </InlineStack>
                            {isMulti && hasMulti ? (
                              <BlockStack gap="200">
                                <Text as="p" variant="bodySm" fontWeight="semibold" tone="subdued">{t("fb_selected_answers")}</Text>
                                <Box paddingInlineStart="400" paddingBlockStart="100">
                                  <BlockStack gap="200">
                                    {ans.answer.split(",").map((item, i) => {
                                      const trimmed = item.trim();
                                      const isOther = trimmed.startsWith("other(");
                                      const display = isOther ? trimmed.replace(/^other\((.*?)\)$/, "$1") : trimmed;
                                      return (
                                        <Box key={i} padding="200" background="bg-surface-secondary" borderRadius="200">
                                          <InlineStack gap="200" blockAlign="center">
                                            <Text as="span" variant="bodyMd" fontWeight="medium">✓ {display}</Text>
                                            {isOther && <Badge tone="info">{t("fb_custom_response")}</Badge>}
                                          </InlineStack>
                                        </Box>
                                      );
                                    })}
                                  </BlockStack>
                                </Box>
                              </BlockStack>
                            ) : (
                              <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                <InlineStack gap="200" blockAlign="center">
                                  <Text as="p" variant="bodyMd">
                                    {ans.answer?.startsWith("other(") ? ans.answer.replace(/^other\((.*?)\)$/, "$1") : ans.answer || t("fb_no_answer")}
                                  </Text>
                                  {ans.answer?.startsWith("other(") && <Badge tone="info">{t("fb_custom_response")}</Badge>}
                                </InlineStack>
                              </Box>
                            )}
                          </BlockStack>
                        </Box>
                      );
                    })
                  )}
                </BlockStack>
              </BlockStack>
            </Modal.Section>
          </Modal>
        )}

        {/* ── Export Modal ── */}
        <Modal
          open={isExportModalOpen}
          onClose={() => { setIsExportModalOpen(false); setExportFormat(""); }}
          title={t("fb_export_title")}
          primaryAction={{ content: t("fb_export_btn"), onAction: handleExport, disabled: !exportFormat }}
          secondaryActions={[{ content: t("cancel"), onAction: () => { setIsExportModalOpen(false); setExportFormat(""); } }]}
        >
          <Modal.Section>
            <BlockStack gap="500">
              <Banner tone="info">
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">{t("fb_export_info", { shop })}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">{t("fb_export_only")}</Text>
                </BlockStack>
              </Banner>
              <Divider />
              <BlockStack gap="300">
                <Text as="p" variant="headingSm" fontWeight="semibold">{t("fb_export_date_range")}</Text>
                <Box padding="400" background="bg-surface-secondary" borderRadius="300">
                  <DatePicker month={month} year={year} onChange={setSelectedDates} onMonthChange={handleMonthChange} selected={selectedDates} allowRange />
                </Box>
                <Text as="p" variant="bodySm" tone="subdued">{t("fb_export_selected", { start: formatDate(selectedDates.start), end: formatDate(selectedDates.end) })}</Text>
              </BlockStack>
              <Divider />
              <BlockStack gap="300">
                <Text as="p" variant="headingSm" fontWeight="semibold">{t("fb_export_format")}</Text>
                <Select label="" options={EXPORT_FORMAT_OPTIONS} value={exportFormat} onChange={setExportFormat} />
              </BlockStack>
              <Divider />
              <Banner tone="info">
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">{t("fb_export_summary")}</Text>
                  <Text as="p" variant="bodySm">
                    {t("fb_export_records", { count: filteredFeedbacks.filter((f) => f.dateObj >= selectedDates.start && f.dateObj <= selectedDates.end).length })}
                    {exportFormat && ` ${t("fb_export_in_format", { format: exportFormat.toUpperCase() })}`}
                  </Text>
                </BlockStack>
              </Banner>
            </BlockStack>
          </Modal.Section>
        </Modal>

        {/* ── Delete Confirmation ── */}
        <Modal
          open={!!deleteConfirmId}
          onClose={() => setDeleteConfirmId(null)}
          title={t("fb_delete_title")}
          primaryAction={{ content: t("fb_delete_btn"), onAction: handleDeleteConfirm, destructive: true, loading: isLoading }}
          secondaryActions={[{ content: t("cancel"), onAction: () => setDeleteConfirmId(null) }]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Text as="p">{t("fb_delete_confirm")}</Text>
              <Banner tone="warning"><p>{t("fb_delete_warning")}</p></Banner>
            </BlockStack>
          </Modal.Section>
        </Modal>
      </Page>
    );
  }
