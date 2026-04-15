import React, { useCallback, useState } from 'react';
import {
    Box,
    Button,
    ButtonGroup,
    Card,
    InlineStack,
    Page,
    Text,
    Icon,
    DatePicker,
    Modal,
    BlockStack,
    Badge,
    Divider,
    Banner,
    Select,
} from '@shopify/polaris';
import SurveyChart from './component/SurveyBarChart';
import { json, useLoaderData, useSearchParams, useNavigate } from '@remix-run/react';
import { PrismaClient } from '@prisma/client';
import SurveyLineChart from './component/SurveyLineChart';
import SurveyBarChart from './component/SurveyBarChart';
import SurveyPaiChart from './component/SurveyPaiChart';
import {
    ChartDonutIcon,
    ChartLineIcon,
    ChartVerticalIcon,
    CalendarIcon,
    LanguageIcon,
    FilterIcon,
} from '@shopify/polaris-icons';
import { authenticate } from '../shopify.server';
import { getT, LANG_KEY_TO_ISO } from '../utils/translations';

const prisma = new PrismaClient();

const LANGUAGES_DROPDOWN = [
    { label: "🌐  Default (English)", value: "default" },
    { label: "🇫🇷  French",           value: "french" },
    { label: "🇪🇸  Spanish",          value: "spanish" },
    { label: "🇮🇹  Italian",          value: "italian" },
    { label: "🇩🇪  German",           value: "german" },
];

// Map UI language key to the short code used for chart data filtering
const LANG_KEY_TO_SHORT = {
    default: "en",
    french: "fr",
    spanish: "es",
    italian: "it",
    german: "de",
};

// Map short code to survey language field value
const SHORT_TO_SURVEY_LANG = {
    en: "default",
    fr: "french",
    it: "italian",
    es: "spanish",
    de: "german",
};

/**
 * Loader function with multi-tenancy support
 */
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
            orderBy: { createdAt: 'desc' },
        });

        const surveyData = await prisma.survey.findMany({
            where: { shop },
            include: { questions: true },
        });
       console.log("Fetched feedbacks:", feedbacks);
       console.log("Fetched survey data:", surveyData);
        return json({
            feedbacks,
            surveyData,
            shop,
            shopDomain,
            success: true
        });
    } catch (error) {
        console.error("Loader error:", error);
        return json({
            feedbacks: [],
            surveyData: [],
            shop: null,
            shopDomain: null,
            success: false,
            error: error.message
        }, { status: 500 });
    }
};

const TestCharts = () => {
    const { feedbacks, surveyData, shop, shopDomain, error } = useLoaderData();
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();

    // ── Language from URL ──────────────────────────────────────
    const uiLanguage = searchParams.get("lang") || "default";
    const uiLangIso  = LANG_KEY_TO_ISO[uiLanguage] ?? "en";
    const t          = getT(uiLangIso);

    // Short language code for chart data filtering (en, fr, it, es, de)
    const language = LANG_KEY_TO_SHORT[uiLanguage] || "en";

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

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [activeButtonIndex, setActiveButtonIndex] = useState('bar');

    const [{ month, year }, setDate] = useState({ month: 1, year: 2025 });
    const [selectedDates, setSelectedDates] = useState({
        start: new Date('Wed Jan 01 2025 00:00:00 GMT-0500 (EST)'),
        end: new Date(),
    });

    const [initialFeedbacks] = useState(feedbacks);
    const [filteredData, setFilteredData] = useState(formatSurveyData(feedbacks, surveyData, selectedDates));
    const [isFilterActive, setIsFilterActive] = useState(false);

    const formatDate = (date) => {
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    };

    const handleButtonClick = useCallback(
        (index) => {
            if (activeButtonIndex === index) return;
            setActiveButtonIndex(index);
        },
        [activeButtonIndex]
    );

    const handleMonthChange = useCallback((month, year) => setDate({ month, year }), []);

    const handleDateChange = (dates) => {
        setSelectedDates(dates);

        const normalizedStartDate = new Date(dates.start.setHours(0, 0, 0, 0));
        const normalizedEndDate = new Date(dates.end.setHours(0, 0, 0, 0));

        const isSameDate = normalizedStartDate.getTime() === normalizedEndDate.getTime();

        const filteredFeedbacks = isSameDate
            ? feedbacks.filter(feedback => {
                const feedbackDate = new Date(feedback.createdAt).setHours(0, 0, 0, 0);
                return feedbackDate === normalizedStartDate.getTime();
            })
            : feedbacks.filter(feedback => {
                const feedbackDate = new Date(feedback.createdAt).setHours(0, 0, 0, 0);
                const startDate = new Date(dates.start).setHours(0, 0, 0, 0);
                const endDate = new Date(dates.end).setHours(0, 0, 0, 0);
                return feedbackDate >= startDate && feedbackDate <= endDate;
            });

        const newFilteredData = formatSurveyData(filteredFeedbacks, surveyData, dates);
        setFilteredData(newFilteredData);
    };

    const handleApplyFilter = () => {
        setIsFilterActive(true);
        setIsModalOpen(false);
    };

    const handleCancel = () => {
        setIsModalOpen(false);
        setSelectedDates({
            start: new Date('Wed Jan 01 2025 00:00:00 GMT-0500 (EST)'),
            end: new Date(),
        });
        setFilteredData(formatSurveyData(initialFeedbacks, surveyData, {
            start: new Date('Wed Jan 01 2025 00:00:00 GMT-0500 (EST)'),
            end: new Date()
        }));
        setIsFilterActive(false);
    };

    const chartConfig = {
        bar:  { icon: ChartVerticalIcon, labelKey: "chart_bar",  component: SurveyBarChart },
        line: { icon: ChartLineIcon,     labelKey: "chart_line", component: SurveyLineChart },
        pai:  { icon: ChartDonutIcon,    labelKey: "chart_pie",  component: SurveyPaiChart },
    };

    const ActiveChart = chartConfig[activeButtonIndex].component;
    const totalResponses = filteredData[0]?.totalUsers || 0;

    const languageFilteredData = filteredData.filter((survey) => {
        const surveyLangKey = SHORT_TO_SURVEY_LANG[language];
        return survey.language === surveyLangKey;
    });

    // Show error state
    if (error) {
        return (
            <Page title={t("chart_title")}>
                <Banner tone="critical">
                    <p>Failed to load analytics data: {error}</p>
                </Banner>
            </Page>
        );
    }

    // Show empty state if no data
    if (feedbacks.length === 0 && surveyData.length === 0) {
        return (
            <Page
                title={t("chart_title")}
                backAction={{ content: t("chart_back"), url: withLang("/app/") }}
            >
                <BlockStack gap="400">
                    <Banner tone="info">
                        <InlineStack gap="200" blockAlign="center">
                            <Text variant="bodyMd" fontWeight="semibold">
                                🏪 {t("store_label")}: {shop}
                            </Text>
                        </InlineStack>
                    </Banner>

                    <Card>
                        <Box padding="600">
                            <BlockStack gap="400" align="center">
                                <Text variant="headingMd" alignment="center">
                                    {t("chart_no_data_title")}
                                </Text>
                                <Text variant="bodyMd" tone="subdued" alignment="center">
                                    {t("chart_no_data_desc")}
                                </Text>
                                <Button url={withLang("/app/")}>
                                    {t("chart_go_surveys")}
                                </Button>
                            </BlockStack>
                        </Box>
                    </Card>
                </BlockStack>
            </Page>
        );
    }

    return (
        <Page
            title={t("chart_title")}
            subtitle={t("chart_subtitle", { shop: shop || '' })}
            backAction={{ content: t("chart_back"), url: withLang("/app/") }}
        >
            <BlockStack gap="400">
                {/* Shop Info Banner + Language Dropdown */}
                <InlineStack align="space-between" blockAlign="center" wrap={false}>
                    <Banner tone="info">
                        <InlineStack gap="200" blockAlign="center">
                            <Text variant="bodyMd" fontWeight="semibold">
                                🏪 {t("store_label")}: {shop}
                            </Text>
                            {shopDomain && (
                                <>
                                    <Text variant="bodyMd" tone="subdued">|</Text>
                                    <Text variant="bodyMd" tone="subdued">
                                        {t("fb_domain")}: {shopDomain}
                                    </Text>
                                </>
                            )}
                        </InlineStack>
                    </Banner>
                    <div style={{ minWidth: 200 }}>
                        <Select
                            label=""
                            labelHidden
                            options={LANGUAGES_DROPDOWN}
                            value={uiLanguage}
                            onChange={handleLanguageChange}
                        />
                    </div>
                </InlineStack>

                {/* Stats & Controls Card */}
                <Card>
                    <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="100">
                                <Text as="h2" variant="headingMd">
                                    {t("chart_overview")}
                                </Text>
                                <InlineStack gap="200">
                                    <Badge tone="info">
                                        {totalResponses} {t("chart_responses")}
                                    </Badge>
                                    {isFilterActive && (
                                        <Badge tone="attention">
                                            {t("chart_filtered")}
                                        </Badge>
                                    )}
                                </InlineStack>
                            </BlockStack>
                        </InlineStack>

                        {isFilterActive && (
                            <>
                                <Divider />
                                <Banner tone="info" onDismiss={handleCancel}>
                                    <InlineStack gap="200" blockAlign="center">
                                        <Icon source={FilterIcon} />
                                        <Text as="p">
                                            {t("chart_showing_data")}{' '}
                                            {formatDate(selectedDates.start)}{' '}
                                            {t("chart_to")}{' '}
                                            {formatDate(selectedDates.end)}
                                        </Text>
                                    </InlineStack>
                                </Banner>
                            </>
                        )}
                    </BlockStack>
                </Card>

                {/* Chart Type Selector */}
                <Card>
                    <BlockStack gap="300">
                        <Text as="h3" variant="headingSm">
                            {t("chart_type")}
                        </Text>
                        <InlineStack align="center">
                            <ButtonGroup variant="segmented">
                                {Object.entries(chartConfig).map(([key, config]) => (
                                    <Button
                                        key={key}
                                        pressed={activeButtonIndex === key}
                                        onClick={() => handleButtonClick(key)}
                                        icon={config.icon}
                                    >
                                        {t(config.labelKey)}
                                    </Button>
                                ))}
                            </ButtonGroup>
                        </InlineStack>
                    </BlockStack>
                </Card>

                {/* Chart Display Card */}
                <Card>
                    <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center">
                            <Text as="h3" variant="headingMd">
                                {t(chartConfig[activeButtonIndex].labelKey)}
                            </Text>
                            <Badge tone="success">
                                {t("chart_live")}
                            </Badge>
                        </InlineStack>
                        <Divider />
                        {languageFilteredData.length > 0 ? (
                            <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                                <ActiveChart surveyData={languageFilteredData} language={language} />
                            </Box>
                        ) : (
                            <Box padding="600">
                                <BlockStack gap="200" align="center">
                                    <Text variant="bodyMd" tone="subdued" alignment="center">
                                        {t("chart_no_range_data")}
                                    </Text>
                                    <Button onClick={handleCancel}>
                                        {t("chart_reset_filter")}
                                    </Button>
                                </BlockStack>
                            </Box>
                        )}
                    </BlockStack>
                </Card>
            </BlockStack>

            {/* Date Filter Modal */}
            {isModalOpen && (
                <Modal
                    open={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    title={t("chart_select_range")}
                    primaryAction={{
                        content: t("chart_apply_filter"),
                        onAction: handleApplyFilter,
                    }}
                    secondaryActions={[{
                        content: t("chart_clear_reset"),
                        onAction: handleCancel,
                        destructive: true,
                    }]}
                >
                    <Modal.Section>
                        <BlockStack gap="400">
                            <Banner tone="info">
                                <Text as="p" variant="bodySm">
                                    {t("chart_filtering_for", { shop })}
                                </Text>
                            </Banner>

                            <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                <InlineStack gap="200" blockAlign="center">
                                    <Icon source={CalendarIcon} tone="base" />
                                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                                        {formatDate(selectedDates.start)} — {formatDate(selectedDates.end)}
                                    </Text>
                                </InlineStack>
                            </Box>

                            <Card>
                                <InlineStack align="center">
                                    <DatePicker
                                        month={month}
                                        year={year}
                                        onChange={handleDateChange}
                                        onMonthChange={handleMonthChange}
                                        selected={selectedDates}
                                        allowRange
                                    />
                                </InlineStack>
                            </Card>

                            <Banner tone="info">
                                <Text as="p" variant="bodySm">
                                    {t("chart_filter_hint")}
                                </Text>
                            </Banner>
                        </BlockStack>
                    </Modal.Section>
                </Modal>
            )}
        </Page>
    );
};

/**
 * Format survey data helper function
 */
const formatSurveyData = (feedbacks, surveyData) => {
    const totalUsers = feedbacks.length;

    const formattedData = surveyData.map(survey => {
        console.log("survey from db", survey);
        const questionsWithAnswers = survey.questions.map(question => {
            const answersCount = {};
            feedbacks.forEach(feedback => {
                const answers = JSON.parse(feedback.answers);
                const answer = answers.find(
                    (a) =>
                        a.questionTitle?.trim().toLowerCase() ===
                        question.text?.trim().toLowerCase()
                )?.answer;
                if (answer) {
                    if (question.isMultiChoice) {
                        answer.split(',').forEach(a => {
                            answersCount[a] = (answersCount[a] || 0) + 1;
                        });
                    } else {
                        answersCount[answer] = (answersCount[answer] || 0) + 1;
                    }
                }
            });

            return {
                ...question,
                answersCount: Object.entries(answersCount).map(([answer, count]) => ({ answer, count }))
            };
        });
        console.log("survey.isItalianVersion", survey.isItalianVersion);
        return {
            ...survey,
            questions: questionsWithAnswers,
            totalUsers: feedbacks.length
        };
    });

    return formattedData;
};

export default TestCharts;
