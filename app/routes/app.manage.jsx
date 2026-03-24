import {
  Card,
  Page,
  IndexTable,
  TextField,
  Select,
  Text,
  InlineStack,
  Box,
  BlockStack,
  Modal,
  Button,
  Badge,
  DatePicker,
  Pagination,
  EmptyState,
  Banner,
  Divider,
  Icon,
  Tooltip,
  Spinner,
  SkeletonBodyText,
  SkeletonDisplayText,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { Form, json, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { useState, useMemo, useCallback, useEffect } from "react";
import { PrismaClient } from "@prisma/client";
import {
  ExportIcon,
  SearchIcon,
  ViewIcon,
  DeleteIcon,
  CalendarIcon,
  FilterIcon,
} from "@shopify/polaris-icons";
import * as XLSX from "xlsx";
import { authenticate } from "../shopify.server";

const prisma = new PrismaClient();

const ITEMS_PER_PAGE = 10;
const SORT_OPTIONS = [
  { label: "Newest First", value: "date-desc" },
  { label: "Oldest First", value: "date-asc" },
  { label: "Email A-Z", value: "email-asc" },
  { label: "Email Z-A", value: "email-desc" },
];

const STATUS_FILTER_OPTIONS = [
  { label: "All Statuses", value: "" },
  { label: "Completed", value: "complete" },
  { label: "Not Submitted", value: "incomplete" },
  { label: "Partial", value: "partially" },
];

const EXPORT_FORMAT_OPTIONS = [
  { label: "Choose format...", value: "", disabled: true },
  { label: "Excel (.xlsx)", value: "excel" },
  { label: "CSV (.csv)", value: "csv" },
  { label: "JSON (.json)", value: "json" },
];

export const loader = async ({ request }) => {
  try {
    const { session, admin } = await authenticate.admin(request);
    const shop = session.shop;

    const response = await admin.graphql(
      `#graphql
        query {
          shop {
            url
          }
        }`,
    );

    const data = await response.json();

    if (!data.data?.shop?.url) {
      throw new Error("Unable to fetch shop information");
    }

    const url = data.data.shop.url;
    const shopDomain = url.replace("https://", "");

    const feedbacks = await prisma.apiProxyData.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
    });

    const surveyData = await prisma.survey.findMany({
      where: { shop },
      include: { questions: true },
    });

    return json({ feedbacks, surveyData, shop, shopDomain, success: true });
  } catch (error) {
    console.error("Loader error:", error);
    return json(
      { feedbacks: [], surveyData: [], shop: null, shopDomain: null, success: false, error: error.message },
      { status: 500 }
    );
  }
};

export const action = async ({ request }) => {
  try {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const formData = await request.formData();
    const id = formData.get("id");
    const action = formData.get("_action");

    if (!id) return json({ success: false, error: "Missing feedback ID" }, { status: 400 });

    if (action === "delete") {
      const feedback = await prisma.apiProxyData.findFirst({
        where: { id: parseInt(id, 10), shop },
      });

      if (!feedback) {
        return json({ success: false, error: "Feedback not found or access denied" }, { status: 403 });
      }

      await prisma.apiProxyData.delete({ where: { id: parseInt(id, 10) } });
      return json({ success: true, message: "Feedback deleted successfully" });
    }

    return json({ success: false, error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Action error:", error);
    return json({ success: false, error: "Failed to delete feedback" }, { status: 500 });
  }
};

const getQuizStatus = (answers, totalQuestions) => {
  const answerCount = answers.length;
  if (answerCount === 0) return { label: "Not Submitted", tone: "critical", progress: "incomplete" };
  if (answerCount === totalQuestions) return { label: "Completed", tone: "success", progress: "complete" };
  return { label: "Partially Completed", tone: "warning", progress: "partiallyComplete" };
};

const formatDate = (dateString) =>
  new Date(dateString).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });

const formatTime = (dateString) =>
  new Date(dateString).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const safeJSONParse = (jsonString, fallback = []) => {
  try { return JSON.parse(jsonString); }
  catch { return fallback; }
};

export default function Manage() {
  const { feedbacks = [], surveyData = [], shop, shopDomain, error } = useLoaderData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const isLoading = navigation.state === "loading" || navigation.state === "submitting";

  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState("");
  const [selectedDates, setSelectedDates] = useState({
    start: new Date(new Date().setMonth(new Date().getMonth() - 1)),
    end: new Date(),
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
    () =>
      feedbacks.map((feedback, index) => ({
        sr: index + 1,
        id: feedback.id.toString(),
        email: feedback.email || "N/A",
        date: formatDate(feedback.createdAt),
        time: formatTime(feedback.createdAt),
        dateObj: new Date(feedback.createdAt),
        answers: safeJSONParse(feedback.answers),
        rawFeedback: feedback,
      })),
    [feedbacks]
  );

  const totalQuestions = useMemo(() => surveyData[0]?.questions?.length || 0, [surveyData]);

  const filteredFeedbacks = useMemo(() => {
    let result = [...processedFeedbacks];

    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      result = result.filter((f) => f.email.toLowerCase().includes(searchLower));
    }

    if (quizStatusFilter) {
      result = result.filter(({ answers }) => {
        const count = answers.length;
        if (quizStatusFilter === "complete") return count === totalQuestions;
        if (quizStatusFilter === "incomplete") return count === 0;
        if (quizStatusFilter === "partially") return count > 0 && count < totalQuestions;
        return true;
      });
    }

    result.sort((a, b) => {
      if (sortField === "email") {
        const cmp = a.email.localeCompare(b.email);
        return sortOrder === "asc" ? cmp : -cmp;
      }
      const cmp = a.dateObj - b.dateObj;
      return sortOrder === "asc" ? cmp : -cmp;
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
  const handleSortChange = useCallback((v) => {
    const [field, order] = v.split("-");
    setSortField(field); setSortOrder(order); setCurrentPage(1);
  }, []);
  const handleQuizStatusChange = useCallback((v) => { setQuizStatusFilter(v); setCurrentPage(1); }, []);
  const handlePageChange = useCallback((p) => setCurrentPage(p), []);
  const clearAllFilters = useCallback(() => { setSearchTerm(""); setQuizStatusFilter(""); setCurrentPage(1); }, []);
  const handleViewFeedback = useCallback((feedback) => { setSelectedFeedback(feedback); setIsViewModalOpen(true); }, []);
  const handleCloseViewModal = useCallback(() => { setIsViewModalOpen(false); setSelectedFeedback(null); }, []);
  const handleDeleteClick = useCallback((id) => setDeleteConfirmId(id), []);
  const handleDeleteConfirm = useCallback(() => {
    if (deleteConfirmId) {
      const formData = new FormData();
      formData.append("id", deleteConfirmId);
      formData.append("_action", "delete");
      submit(formData, { method: "post" });
      setDeleteConfirmId(null);
    }
  }, [deleteConfirmId, submit]);

  const handleExport = useCallback(() => {
    if (!exportFormat) return;
    const dataToExport = filteredFeedbacks
      .filter((f) => f.dateObj >= selectedDates.start && f.dateObj <= selectedDates.end)
      .map((f) => ({
        ID: f.id,
        Email: f.email,
        "Submitted Date": f.date,
        "Submitted Time": f.time,
        Status: getQuizStatus(f.answers, totalQuestions).label,
        "Total Answers": f.answers.length,
        "Total Questions": totalQuestions,
        Answers: f.answers.map((a) => `${a.questionTitle}: ${a.answer}`).join("; "),
      }));

    try {
      if (exportFormat === "excel") {
        const ws = XLSX.utils.json_to_sheet(dataToExport);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Feedbacks");
        ws["!cols"] = [{ wch: 10 }, { wch: 30 }, { wch: 20 }, { wch: 15 }, { wch: 18 }, { wch: 15 }, { wch: 15 }, { wch: 60 }];
        XLSX.writeFile(wb, `feedbacks_${shop}_${Date.now()}.xlsx`);
      } else {
        const ws = XLSX.utils.json_to_sheet(dataToExport);
        const content = exportFormat === "csv" ? XLSX.utils.sheet_to_csv(ws) : JSON.stringify(dataToExport, null, 2);
        const type = exportFormat === "csv" ? "text/csv;charset=utf-8;" : "application/json";
        const blob = new Blob([content], { type });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `feedbacks_${shop}_${Date.now()}.${exportFormat === "csv" ? "csv" : "json"}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      }
      setIsExportModalOpen(false);
      setExportFormat("");
    } catch (err) {
      console.error("Export error:", err);
      alert("Failed to export data. Please try again.");
    }
  }, [filteredFeedbacks, selectedDates, exportFormat, totalQuestions, shop]);

  const activeFilters = useMemo(() => {
    const f = [];
    if (searchTerm) f.push("Search active");
    if (quizStatusFilter) f.push("Status filter active");
    return f;
  }, [searchTerm, quizStatusFilter]);

  useEffect(() => { setCurrentPage(1); }, [searchTerm, quizStatusFilter]);

  if (error) {
    return (
      <Page title="User Feedback Dashboard">
        <Banner tone="critical"><p>Failed to load feedback data: {error}</p></Banner>
      </Page>
    );
  }

  if (isLoading && feedbacks.length === 0) {
    return (
      <Page title="User Feedback Dashboard">
        <BlockStack gap="500">
          <Card><SkeletonDisplayText size="small" /><Box paddingBlockStart="400"><SkeletonBodyText lines={3} /></Box></Card>
          <Card><SkeletonBodyText lines={5} /></Card>
        </BlockStack>
      </Page>
    );
  }

  return (
    <Page
      title="User Feedback Dashboard"
      subtitle={`Manage and analyze customer feedback submissions for ${shop || "your store"}`}
      backAction={{ content: "Back", url: "/app/" }}
      // ── Export Data button is hidden ─────────────────────────────────────
    >
      <BlockStack gap="500">
        {/* Shop Info Banner */}
        <Banner tone="info">
          <InlineStack gap="200" blockAlign="center">
            <Text variant="bodyMd" fontWeight="semibold">🏪 Store: {shop}</Text>
            {shopDomain && (
              <>
                <Text variant="bodyMd" tone="subdued">|</Text>
                <Text variant="bodyMd" tone="subdued">Domain: {shopDomain}</Text>
              </>
            )}
          </InlineStack>
        </Banner>

        {/* Summary Statistics */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Summary Statistics</Text>
            <Divider />
            <InlineStack gap="600" wrap={false} blockAlign="center">
              <Box width="25%">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" tone="subdued">Total Feedbacks</Text>
                  <Text as="p" variant="heading2xl" fontWeight="bold">{statistics.total}</Text>
                </BlockStack>
              </Box>
              <Divider borderColor="border" />
              <Box width="25%">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" tone="subdued">Completed</Text>
                  <Text as="p" variant="heading2xl" fontWeight="bold" tone="success">{statistics.completed}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {statistics.total > 0 ? `${Math.round((statistics.completed / statistics.total) * 100)}%` : "0%"}
                  </Text>
                </BlockStack>
              </Box>
              <Divider borderColor="border" />
              <Box width="25%">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" tone="subdued">Partial</Text>
                  <Text as="p" variant="heading2xl" fontWeight="bold" tone="warning">{statistics.partial}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {statistics.total > 0 ? `${Math.round((statistics.partial / statistics.total) * 100)}%` : "0%"}
                  </Text>
                </BlockStack>
              </Box>
              <Divider borderColor="border" />
              <Box width="25%">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" tone="subdued">Not Submitted</Text>
                  <Text as="p" variant="heading2xl" fontWeight="bold" tone="critical">{statistics.notSubmitted}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {statistics.total > 0 ? `${Math.round((statistics.notSubmitted / statistics.total) * 100)}%` : "0%"}
                  </Text>
                </BlockStack>
              </Box>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Active Filters Banner */}
        {activeFilters.length > 0 && (
          <Banner tone="info" onDismiss={clearAllFilters}>
            <InlineStack gap="200" blockAlign="center" wrap={false}>
              <Icon source={FilterIcon} />
              <Text as="p" fontWeight="semibold">Filters Applied:</Text>
              <Text as="p">Showing {filteredFeedbacks.length} of {processedFeedbacks.length} feedbacks</Text>
            </InlineStack>
          </Banner>
        )}

        {/* Filters & Search */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Filters & Search</Text>
              {activeFilters.length > 0 && (
                <Button onClick={clearAllFilters} size="slim" variant="plain">Clear all filters</Button>
              )}
            </InlineStack>
            <Divider />
            <InlineStack gap="400" wrap={true} blockAlign="end">
              <Box minWidth="300px" style={{ flex: 1 }}>
                <TextField
                  label="Search"
                  value={searchTerm}
                  onChange={handleSearchChange}
                  placeholder="Search by email address..."
                  autoComplete="off"
                  prefix={<Icon source={SearchIcon} />}
                  clearButton
                  onClearButtonClick={() => handleSearchChange("")}
                />
              </Box>
              <Box minWidth="200px">
                <Select label="Sort by" options={SORT_OPTIONS} onChange={handleSortChange} value={`${sortField}-${sortOrder}`} />
              </Box>
              <Box minWidth="200px">
                <Select label="Filter by Status" options={STATUS_FILTER_OPTIONS} value={quizStatusFilter} onChange={handleQuizStatusChange} />
              </Box>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* ── Feedback Table + Pagination inside one Card ────────────────── */}
        <Card padding="0">
          {paginatedFeedbacks.length === 0 ? (
            <Box padding="1600">
              <EmptyState
                heading={activeFilters.length > 0 ? "No feedbacks match your filters" : "No feedbacks found"}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  {activeFilters.length > 0
                    ? "Try adjusting your search or filter criteria to see results"
                    : "Customer feedback submissions will appear here once they start completing surveys"}
                </p>
                {activeFilters.length > 0 && (
                  <Box paddingBlockStart="400">
                    <Button onClick={clearAllFilters}>Clear all filters</Button>
                  </Box>
                )}
              </EmptyState>
            </Box>
          ) : (
            <BlockStack>
              <IndexTable
                resourceName={{ singular: "feedback", plural: "feedbacks" }}
                itemCount={filteredFeedbacks.length}
                headings={[
                  { title: "#" },
                  { title: "Email Address" },
                  { title: "Submitted On" },
                  { title: "Time (GMT+5:30)" },
                  { title: "Status" },
                  { title: "Progress" },
                  { title: "Actions", alignment: "center" },
                ]}
                selectable={false}
                loading={isLoading}
              >
                {paginatedFeedbacks.map(({ sr, id, email, date, time, answers, rawFeedback }, index) => {
                  const status = getQuizStatus(answers, totalQuestions);
                  return (
                    <IndexTable.Row id={id} key={id} position={index}>
                      <IndexTable.Cell>
                        <Text as="span" fontWeight="semibold" tone="subdued">{sr}</Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text as="span" fontWeight="medium">{email}</Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <InlineStack gap="100" blockAlign="center">
                          <Icon source={CalendarIcon} tone="subdued" />
                          <Text as="span">{date}</Text>
                        </InlineStack>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text as="span" tone="subdued">{time}</Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Badge progress={status.progress} tone={status.tone}>{status.label}</Badge>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text as="span" variant="bodySm" tone="subdued">{answers.length}/{totalQuestions} answers</Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <InlineStack align="center" gap="200">
                          <Tooltip content="View feedback details">
                            <Button onClick={() => handleViewFeedback(rawFeedback)} icon={ViewIcon} variant="primary" size="slim">View</Button>
                          </Tooltip>
                          <Tooltip content="Delete this feedback">
                            <Button onClick={() => handleDeleteClick(id)} icon={DeleteIcon} tone="critical" variant="plain" size="slim" />
                          </Tooltip>
                        </InlineStack>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  );
                })}
              </IndexTable>

              {/* ── Pagination sits inside the same Card, below the table ── */}
              {totalPages > 1 && (
                <Box padding="400" borderColor="border-subdued" borderBlockStartWidth="025">
                  <InlineStack align="center" gap="400">
                    <Pagination
                      hasPrevious={currentPage > 1}
                      hasNext={currentPage < totalPages}
                      onPrevious={() => handlePageChange(currentPage - 1)}
                      onNext={() => handlePageChange(currentPage + 1)}
                    />
                    <Text as="p" variant="bodySm" tone="subdued">
                      Page {currentPage} of {totalPages} ({filteredFeedbacks.length}{" "}
                      {filteredFeedbacks.length === 1 ? "feedback" : "feedbacks"})
                    </Text>
                  </InlineStack>
                </Box>
              )}
            </BlockStack>
          )}
        </Card>
      </BlockStack>

      {/* Feedback Details Modal */}
      {selectedFeedback && (
        <Modal open={isViewModalOpen} onClose={handleCloseViewModal} title="Feedback Details" large>
          <Modal.Section>
            <BlockStack gap="500">
              <Box padding="400" background="bg-surface-secondary" borderRadius="300">
                <InlineStack gap="800" wrap={true}>
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">Email Address</Text>
                    <Text as="p" variant="headingMd" fontWeight="bold">{selectedFeedback.email || "N/A"}</Text>
                  </BlockStack>
                  <Divider borderColor="border" />
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">Submitted On</Text>
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      {formatDate(selectedFeedback.createdAt)} at {formatTime(selectedFeedback.createdAt)}
                    </Text>
                  </BlockStack>
                  <Divider borderColor="border" />
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">Status</Text>
                    <Badge
                      progress={getQuizStatus(safeJSONParse(selectedFeedback.answers), totalQuestions).progress}
                      tone={getQuizStatus(safeJSONParse(selectedFeedback.answers), totalQuestions).tone}
                    >
                      {getQuizStatus(safeJSONParse(selectedFeedback.answers), totalQuestions).label}
                    </Badge>
                  </BlockStack>
                  <Divider borderColor="border" />
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">Progress</Text>
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      {safeJSONParse(selectedFeedback.answers).length} / {totalQuestions} answers
                    </Text>
                  </BlockStack>
                </InlineStack>
              </Box>

              <Divider />

              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">Survey Responses</Text>
                {safeJSONParse(selectedFeedback.answers).length === 0 ? (
                  <Box padding="600" background="bg-surface-secondary" borderRadius="300">
                    <InlineStack align="center">
                      <Text as="p" tone="subdued" alignment="center">No responses submitted yet</Text>
                    </InlineStack>
                  </Box>
                ) : (
                  safeJSONParse(selectedFeedback.answers).map((ans, idx) => {
                    const matchedQuestion = surveyData[0]?.questions.find((q) => q.text === ans.questionTitle);
                    const isMultiChoice = matchedQuestion?.isMultiChoice;
                    const hasMultipleAnswers = ans.answer?.includes(",");

                    return (
                      <Box key={idx} padding="400" background="bg-surface" borderRadius="300" borderColor="border" borderWidth="025">
                        <BlockStack gap="300">
                          <InlineStack gap="200" blockAlign="center">
                            <Badge tone="info">Q{idx + 1}</Badge>
                            <Text as="p" variant="headingSm" fontWeight="bold">{ans.questionTitle}</Text>
                          </InlineStack>
                          {isMultiChoice && hasMultipleAnswers ? (
                            <BlockStack gap="200">
                              <Text as="p" variant="bodySm" fontWeight="semibold" tone="subdued">Selected Answers:</Text>
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
                                          {isOther && <Badge tone="info">Custom Response</Badge>}
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
                                  {ans.answer?.startsWith("other(") ? ans.answer.replace(/^other\((.*?)\)$/, "$1") : ans.answer || "No answer provided"}
                                </Text>
                                {ans.answer?.startsWith("other(") && <Badge tone="info">Custom Response</Badge>}
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

      {/* Export Modal (kept functional in case needed later) */}
      <Modal
        open={isExportModalOpen}
        onClose={() => { setIsExportModalOpen(false); setExportFormat(""); }}
        title="Export Feedback Data"
        primaryAction={{ content: "Export", onAction: handleExport, disabled: !exportFormat }}
        secondaryActions={[{ content: "Cancel", onAction: () => { setIsExportModalOpen(false); setExportFormat(""); } }]}
      >
        <Modal.Section>
          <BlockStack gap="500">
            <Banner tone="info">
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd" fontWeight="semibold">Exporting data for: {shop}</Text>
                <Text as="p" variant="bodySm" tone="subdued">Only feedback from this store will be included</Text>
              </BlockStack>
            </Banner>
            <Divider />
            <BlockStack gap="300">
              <Text as="p" variant="headingSm" fontWeight="semibold">Select Date Range</Text>
              <Box padding="400" background="bg-surface-secondary" borderRadius="300">
                <DatePicker month={month} year={year} onChange={setSelectedDates} onMonthChange={handleMonthChange} selected={selectedDates} allowRange />
              </Box>
              <Text as="p" variant="bodySm" tone="subdued">
                Selected: {formatDate(selectedDates.start)} to {formatDate(selectedDates.end)}
              </Text>
            </BlockStack>
            <Divider />
            <BlockStack gap="300">
              <Text as="p" variant="headingSm" fontWeight="semibold">Export Format</Text>
              <Select label="" options={EXPORT_FORMAT_OPTIONS} value={exportFormat} onChange={setExportFormat} />
            </BlockStack>
            <Divider />
            <Banner tone="info">
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd" fontWeight="semibold">Export Summary</Text>
                <Text as="p" variant="bodySm">
                  {filteredFeedbacks.filter((f) => f.dateObj >= selectedDates.start && f.dateObj <= selectedDates.end).length} record(s) will be exported
                  {exportFormat && ` in ${exportFormat.toUpperCase()} format`}
                </Text>
              </BlockStack>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={!!deleteConfirmId}
        onClose={() => setDeleteConfirmId(null)}
        title="Delete Feedback"
        primaryAction={{ content: "Delete", onAction: handleDeleteConfirm, destructive: true, loading: isLoading }}
        secondaryActions={[{ content: "Cancel", onAction: () => setDeleteConfirmId(null) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p">Are you sure you want to delete this feedback? This action cannot be undone.</Text>
            <Banner tone="warning">
              <p>All survey responses and associated data for this feedback will be permanently deleted from your store.</p>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
