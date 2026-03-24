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
} from '@shopify/polaris';
import SurveyChart from './component/SurveyBarChart';
import { json, useLoaderData } from '@remix-run/react';
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

const prisma = new PrismaClient();

/**
 * Loader function with multi-tenancy support
 */
export const loader = async ({ request }) => {
    try {
        // Get shop from session for multi-tenancy
        const { session, admin } = await authenticate.admin(request);
        const shop = session.shop;

        // Fetch shop domain from GraphQL
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

        // Fetch feedbacks filtered by shop (multi-tenancy)
        const feedbacks = await prisma.apiProxyData.findMany({
            where: {
                shop: shop, // Filter by shop for multi-tenancy
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        // Fetch survey data filtered by shop (multi-tenancy)
        const surveyData = await prisma.survey.findMany({
            where: {
                shop: shop, // Filter by shop for multi-tenancy
            },
            include: {
                questions: true,
            },
        });

        return json({
            feedbacks,
            surveyData,
            shop, // Pass shop to frontend
            shopDomain, // Pass shop domain for display
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

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [activeButtonIndex, setActiveButtonIndex] = useState('bar');
    const [language, setLanguage] = useState('en');
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

    const toggleLanguage = () => {
        setLanguage((prevLanguage) => (prevLanguage === 'en' ? 'fr' : 'en'));
    };

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
        bar: {
            icon: ChartVerticalIcon,
            label: { en: 'Bar Chart', fr: 'Graphique à barres' },
            component: SurveyBarChart
        },
        line: {
            icon: ChartLineIcon,
            label: { en: 'Line Chart', fr: 'Graphique linéaire' },
            component: SurveyLineChart
        },
        pai: {
            icon: ChartDonutIcon,
            label: { en: 'Pie Chart', fr: 'Graphique circulaire' },
            component: SurveyPaiChart
        }
    };

    const ActiveChart = chartConfig[activeButtonIndex].component;
    const totalResponses = filteredData[0]?.totalUsers || 0;

    // Show error state
    if (error) {
        return (
            <Page title="Survey Data Visualization">
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
                title="Survey Data Visualization"
                backAction={{ content: "Back", url: "/app/" }}
            >
                <BlockStack gap="400">
                    {/* Shop Info Banner */}
                    <Banner tone="info">
                        <InlineStack gap="200" blockAlign="center">
                            <Text variant="bodyMd" fontWeight="semibold">
                                🏪 Store: {shop}
                            </Text>
                        </InlineStack>
                    </Banner>

                    <Card>
                        <Box padding="600">
                            <BlockStack gap="400" align="center">
                                <Text variant="headingMd" alignment="center">
                                    {language === 'en' ? 'No Survey Data Available' : 'Aucune donnée d\'enquête disponible'}
                                </Text>
                                <Text variant="bodyMd" tone="subdued" alignment="center">
                                    {language === 'en'
                                        ? 'Create a survey and collect responses to see analytics here.'
                                        : 'Créez une enquête et collectez des réponses pour voir les analyses ici.'}
                                </Text>
                                <Button url="/app/">
                                    {language === 'en' ? 'Go to Surveys' : 'Aller aux enquêtes'}
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
            title="Survey Data Visualization"
            subtitle={`Analytics for ${shop || 'your store'}`}
            backAction={{ content: "Back", url: "/app/" }}
        >
            <BlockStack gap="400">
                {/* Shop Info Banner */}
                <Banner tone="info">
                    <InlineStack gap="200" blockAlign="center">
                        <Text variant="bodyMd" fontWeight="semibold">
                            🏪 Store: {shop}
                        </Text>
                        {shopDomain && (
                            <>
                                <Text variant="bodyMd" tone="subdued">|</Text>
                                <Text variant="bodyMd" tone="subdued">
                                    Domain: {shopDomain}
                                </Text>
                            </>
                        )}
                    </InlineStack>
                </Banner>

                {/* Stats & Controls Card */}
                <Card>
                    <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="100">
                                <Text as="h2" variant="headingMd">
                                    {language === 'en' ? 'Analytics Overview' : 'Aperçu analytique'}
                                </Text>
                                <InlineStack gap="200">
                                    <Badge tone="info">
                                        {totalResponses} {language === 'en' ? 'Responses' : 'Réponses'}
                                    </Badge>
                                    {isFilterActive && (
                                        <Badge tone="attention">
                                            {language === 'en' ? 'Filtered' : 'Filtré'}
                                        </Badge>
                                    )}
                                </InlineStack>
                            </BlockStack>

                            <InlineStack gap="200">
                                <Button
                                    onClick={toggleLanguage}
                                    icon={LanguageIcon}
                                    accessibilityLabel={language === 'en' ? 'Switch to French' : 'Passer à l\'anglais'}
                                >
                                    {language === 'en' ? 'EN' : 'FR'}
                                </Button>
                                {/* <Button
                                    variant="primary"
                                    icon={CalendarIcon}
                                    onClick={() => setIsModalOpen(true)}
                                >
                                    {language === 'en' ? 'Date Range' : 'Plage de dates'}
                                </Button> */}
                            </InlineStack>
                        </InlineStack>

                        {isFilterActive && (
                            <>
                                <Divider />
                                <Banner
                                    tone="info"
                                    onDismiss={handleCancel}
                                >
                                    <InlineStack gap="200" blockAlign="center">
                                        <Icon source={FilterIcon} />
                                        <Text as="p">
                                            {language === 'en' ? 'Showing data from' : 'Affichage des données du'} {formatDate(selectedDates.start)} {language === 'en' ? 'to' : 'au'} {formatDate(selectedDates.end)}
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
                            {language === 'en' ? 'Chart Type' : 'Type de graphique'}
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
                                        {config.label[language]}
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
                                {chartConfig[activeButtonIndex].label[language]}
                            </Text>
                            <Badge tone="success">
                                {language === 'en' ? 'Live Data' : 'Données en direct'}
                            </Badge>
                        </InlineStack>
                        <Divider />
                        {filteredData.length > 0 ? (
                            <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                                <ActiveChart surveyData={filteredData} language={language} />
                            </Box>
                        ) : (
                            <Box padding="600">
                                <BlockStack gap="200" align="center">
                                    <Text variant="bodyMd" tone="subdued" alignment="center">
                                        {language === 'en'
                                            ? 'No data available for the selected date range.'
                                            : 'Aucune donnée disponible pour la plage de dates sélectionnée.'}
                                    </Text>
                                    <Button onClick={handleCancel}>
                                        {language === 'en' ? 'Reset Filter' : 'Réinitialiser le filtre'}
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
                    title={language === 'en' ? 'Select Date Range' : 'Sélectionner la plage de dates'}
                    primaryAction={{
                        content: language === 'en' ? 'Apply Filter' : 'Appliquer le filtre',
                        onAction: handleApplyFilter,
                    }}
                    secondaryActions={[{
                        content: language === 'en' ? 'Clear & Reset' : 'Effacer et réinitialiser',
                        onAction: handleCancel,
                        destructive: true,
                    }]}
                >
                    <Modal.Section>
                        <BlockStack gap="400">
                            {/* Store Context */}
                            <Banner tone="info">
                                <Text as="p" variant="bodySm">
                                    {language === 'en'
                                        ? `Filtering analytics for ${shop}`
                                        : `Filtrage des analyses pour ${shop}`}
                                </Text>
                            </Banner>

                            <Box
                                padding="300"
                                background="bg-surface-secondary"
                                borderRadius="200"
                            >
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
                                    {language === 'en'
                                        ? 'Select a date range to filter survey responses. Click "Apply Filter" to update the charts.'
                                        : 'Sélectionnez une plage de dates pour filtrer les réponses. Cliquez sur "Appliquer le filtre" pour mettre à jour les graphiques.'}
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
        const questionsWithAnswers = survey.questions.map(question => {
            const answersCount = {};
            feedbacks.forEach(feedback => {
                const answers = JSON.parse(feedback.answers);
                const answer = answers.find(a => a.questionTitle === question.text)?.answer;
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

        return {
            ...survey,
            questions: questionsWithAnswers,
            totalUsers: feedbacks.length
        };
    });

    return formattedData;
};

export default TestCharts;
