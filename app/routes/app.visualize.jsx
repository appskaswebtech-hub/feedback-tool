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
        setLanguage((prevLanguage) =>
            prevLanguage === 'en'
                ? 'fr'
                : prevLanguage === 'fr'
                    ? 'it'
                    : prevLanguage === 'it'
                        ? 'es'
                        : prevLanguage === 'es'
                            ? 'de'
                            : 'en'
        );
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
            label: {
                en: 'Bar Chart',
                fr: 'Graphique à barres',
                it: 'Grafico a barre',
                es: 'Gráfico de barras',
                de: 'Balkendiagramm'
            },
            component: SurveyBarChart
        },
        line: {
            icon: ChartLineIcon,
            label: {
                en: 'Line Chart',
                fr: 'Graphique linéaire',
                it: 'Grafico a linee',
                es: 'Gráfico de líneas',
                de: 'Liniendiagramm'
            },
            component: SurveyLineChart
        },
        pai: {
            icon: ChartDonutIcon,
            label: {
                en: 'Pie Chart',
                fr: 'Graphique circulaire',
                it: 'Grafico a torta',
                es: 'Gráfico circular',
                de: 'Kreisdiagramm'
            },
            component: SurveyPaiChart
        }
    };

    const ActiveChart = chartConfig[activeButtonIndex].component;
    const totalResponses = filteredData[0]?.totalUsers || 0;
    const languageFilteredData = filteredData.filter((survey) => {
        if (language === "en") {
            return survey.language === "default";
        }

        if (language === "fr") {
            return survey.language === "french";
        }

        if (language === "it") {
            return survey.language === "italian";
        }

        if (language === "es") {
            return survey.language === "spanish";
        }

        if (language === "de") {
            return survey.language === "german";
        }

        return false;
    });

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
                                    {language === 'en'
                                        ? 'No Survey Data Available'
                                        : language === 'fr'
                                            ? 'Aucune donnée d\'enquête disponible'
                                            : language === 'it'
                                                ? 'Nessun dato del sondaggio disponibile'
                                                : language === 'es'
                                                    ? 'No hay datos de encuesta disponibles'
                                                    : 'Keine Umfragedaten verfügbar'}
                                </Text>
                                <Text variant="bodyMd" tone="subdued" alignment="center">
                                    {language === 'en'
                                        ? 'Create a survey and collect responses to see analytics here.'
                                        : language === 'fr'
                                            ? 'Créez une enquête et collectez des réponses pour voir les analyses ici.'
                                            : language === 'it'
                                                ? 'Crea un sondaggio e raccogli le risposte per vedere qui le analisi.'
                                                : language === 'es'
                                                    ? 'Crea una encuesta y recopila respuestas para ver aquí los análisis.'
                                                    : 'Erstellen Sie eine Umfrage und sammeln Sie Antworten, um hier Analysen zu sehen.'}
                                </Text>
                                <Button url="/app/">
                                    {language === 'en'
                                        ? 'Go to Surveys'
                                        : language === 'fr'
                                            ? 'Aller aux enquêtes'
                                            : language === 'it'
                                                ? 'Vai ai sondaggi'
                                                : language === 'es'
                                                    ? 'Ir a Encuestas'
                                                    : 'Zu Umfragen'}
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
                                    {language === 'en'
                                        ? 'Analytics Overview'
                                        : language === 'fr'
                                            ? 'Aperçu analytique'
                                            : language === 'it'
                                                ? 'Panoramica analitica'
                                                : language === 'es'
                                                    ? 'Resumen analítico'
                                                    : 'Analyseübersicht'}
                                </Text>
                                <InlineStack gap="200">
                                    <Badge tone="info">
                                        {totalResponses} {language === 'en'
                                            ? 'Responses'
                                            : language === 'fr'
                                                ? 'Réponses'
                                                : language === 'it'
                                                    ? 'Risposte'
                                                    : language === 'es'
                                                        ? 'Respuestas'
                                                        : 'Antworten'}
                                    </Badge>
                                    {isFilterActive && (
                                        <Badge tone="attention">
                                            {language === 'en'
                                                ? 'Filtered'
                                                : language === 'fr'
                                                    ? 'Filtré'
                                                    : language === 'it'
                                                        ? 'Filtrato'
                                                        : language === 'es'
                                                            ? 'Filtrado'
                                                            : 'Gefiltert'}
                                        </Badge>
                                    )}
                                </InlineStack>
                            </BlockStack>

                            <InlineStack gap="200">
                                {/* <Button
                                    onClick={toggleLanguage}
                                    icon={LanguageIcon}
                                    accessibilityLabel={
                                        language === 'en'
                                            ? 'Switch to French'
                                            : language === 'fr'
                                                ? 'Switch to Italian'
                                                : language === 'it'
                                                    ? 'Switch to Spanish'
                                                    : 'Switch to English'
                                    }
                                >
                                    {language === 'en'
                                        ? 'EN'
                                        : language === 'fr'
                                            ? 'FR'
                                            : language === 'it'
                                                ? 'IT'
                                                : 'ES'}
                                </Button> */}


                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <Button
                                        onClick={() => setLanguage('en')}
                                        icon={LanguageIcon}
                                        accessibilityLabel="Switch to English"
                                        pressed={language === 'en'}
                                    >
                                        EN
                                    </Button>

                                    <Button
                                        onClick={() => setLanguage('fr')}
                                        icon={LanguageIcon}
                                        accessibilityLabel="Switch to French"
                                        pressed={language === 'fr'}
                                    >
                                        FR
                                    </Button>

                                    <Button
                                        onClick={() => setLanguage('it')}
                                        icon={LanguageIcon}
                                        accessibilityLabel="Switch to Italian"
                                        pressed={language === 'it'}
                                    >
                                        IT
                                    </Button>

                                    <Button
                                        onClick={() => setLanguage('es')}
                                        icon={LanguageIcon}
                                        accessibilityLabel="Switch to Spanish"
                                        pressed={language === 'es'}
                                    >
                                        ES
                                    </Button>

                                    <Button
                                        onClick={() => setLanguage('de')}
                                        icon={LanguageIcon}
                                        accessibilityLabel="Switch to German"
                                        pressed={language === 'de'}
                                    >
                                        DE
                                    </Button>
                                </div>


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
                                            {language === 'en'
                                                ? 'Showing data from'
                                                : language === 'fr'
                                                    ? 'Affichage des données du'
                                                    : language === 'it'
                                                        ? 'Visualizzazione dati dal'
                                                        : language === 'es'
                                                            ? 'Mostrando datos desde'
                                                            : 'Daten anzeigen von'}{' '}
                                            {formatDate(selectedDates.start)}{' '}
                                            {language === 'en'
                                                ? 'to'
                                                : language === 'fr'
                                                    ? 'au'
                                                    : language === 'it'
                                                        ? 'al'
                                                        : language === 'es'
                                                            ? 'a'
                                                            : 'bis'}{' '}
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
                            {language === 'en'
                                ? 'Chart Type'
                                : language === 'fr'
                                    ? 'Type de graphique'
                                    : language === 'it'
                                        ? 'Tipo di grafico'
                                        : language === 'es'
                                            ? 'Tipo de gráfico'
                                            : 'Diagrammtyp'}
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
                                {language === 'en'
                                    ? 'Live Data'
                                    : language === 'fr'
                                        ? 'Données en direct'
                                        : language === 'it'
                                            ? 'Dati in tempo reale'
                                            : language === 'es'
                                                ? 'Datos en vivo'
                                                : 'Live-Daten'}
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
                                        {language === 'en'
                                            ? 'No data available for the selected date range.'
                                            : language === 'fr'
                                                ? 'Aucune donnée disponible pour la plage de dates sélectionnée.'
                                                : language === 'it'
                                                    ? 'Nessun dato disponibile per l’intervallo di date selezionato.'
                                                    : language === 'es'
                                                        ? 'No hay datos disponibles para el rango de fechas seleccionado.'
                                                        : 'Keine Daten für den ausgewählten Datumsbereich verfügbar.'}
                                    </Text>
                                    <Button onClick={handleCancel}>
                                        {language === 'en'
                                            ? 'Reset Filter'
                                            : language === 'fr'
                                                ? 'Réinitialiser le filtre'
                                                : language === 'it'
                                                    ? 'Reimposta filtro'
                                                    : language === 'es'
                                                        ? 'Restablecer filtro'
                                                        : 'Filter zurücksetzen'}
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
                    title={
                        language === 'en'
                            ? 'Select Date Range'
                            : language === 'fr'
                                ? 'Sélectionner la plage de dates'
                                : language === 'it'
                                    ? 'Seleziona intervallo di date'
                                    : language === 'es'
                                        ? 'Seleccionar rango de fechas'
                                        : 'Datumsbereich auswählen'
                    }
                    primaryAction={{
                        content:
                            language === 'en'
                                ? 'Apply Filter'
                                : language === 'fr'
                                    ? 'Appliquer le filtre'
                                    : language === 'it'
                                        ? 'Applica filtro'
                                        : language === 'es'
                                            ? 'Aplicar filtro'
                                            : 'Filter anwenden',
                        onAction: handleApplyFilter,
                    }}
                    secondaryActions={[{
                        content:
                            language === 'en'
                                ? 'Clear & Reset'
                                : language === 'fr'
                                    ? 'Effacer et réinitialiser'
                                    : 'Cancella e reimposta',
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
                                        : language === 'fr'
                                            ? `Filtrage des analyses pour ${shop}`
                                            : language === 'it'
                                                ? `Filtraggio delle analisi per ${shop}`
                                                : language === 'es'
                                                    ? `Filtrando análisis para ${shop}`
                                                    : `Analysen für ${shop} werden gefiltert`}
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
                                        : language === 'fr'
                                            ? 'Sélectionnez une plage de dates pour filtrer les réponses. Cliquez sur "Appliquer le filtre" pour mettre à jour les graphiques.'
                                            : language === 'it'
                                                ? 'Seleziona un intervallo di date per filtrare le risposte al sondaggio. Fai clic su "Applica filtro" per aggiornare i grafici.'
                                                : language === 'es'
                                                    ? 'Seleccione un rango de fechas para filtrar las respuestas de la encuesta. Haga clic en "Aplicar filtro" para actualizar los gráficos.'
                                                    : 'Wählen Sie einen Datumsbereich aus, um die Umfrageantworten zu filtern. Klicken Sie auf "Filter anwenden", um die Diagramme zu aktualisieren.'}
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
                // const answer = answers.find(a => a.questionTitle === question.text)?.answer;
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
