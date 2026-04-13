import React, { useState } from "react";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell
} from "recharts";
import { BlockStack, InlineStack, Pagination, Text, EmptyState } from "@shopify/polaris";

const SurveyBarChart = ({ surveyData, language }) => {
    const [currentPage, setCurrentPage] = useState(1);
    const questionsPerPage = 1;

    const indexOfLastQuestion = currentPage * questionsPerPage;
    const indexOfFirstQuestion = indexOfLastQuestion - questionsPerPage;

    const handlePagination = (page) => {
        setCurrentPage(page);
    };

    // Filter the survey data based on the selected language (English or French)
    // const filteredSurveyData = surveyData.filter((survey) => {
    //     if (language === "en") {
    //         return !survey.isFrenchVersion && !survey.isItalianVersion;
    //     }

    //     if (language === "fr") {
    //         return survey.isFrenchVersion === true;
    //     }

    //     if (language === "it") {
    //         return survey.isItalianVersion === true;
    //     }

    //     return false;
    // });

    return (
        <div>
            {surveyData.map((survey, surveyIndex) => {
                // Filter out questions with only "Other" answers
                const validQuestions = survey.questions.filter((question) => {
                    // Filter out answers that start with "Other"
                    const filteredAnswers = question.answersCount.filter((ans) => {
                        const value = ans.answer.toLowerCase();

                        return (
                            !value.startsWith("other") &&
                            !value.startsWith("autre") &&
                            !value.startsWith("altro") &&
                            !value.startsWith("otro")
                        );
                    });
                    return filteredAnswers.length > 0; // Keep only questions with valid answers
                });

                // Slice valid questions for pagination
                const currentQuestions = validQuestions.slice(indexOfFirstQuestion, indexOfLastQuestion);

                return (
                    <div key={surveyIndex}>
                        {/* <Text variant="headingLg" as="h5">
                            {language === "fr" ? "French Survey" : "English Survey"}
                        </Text> */}
                        {currentQuestions.map((question, index) => {
                            // Total users who took the survey
                            const totalUsers = survey.totalUsers;
                            let chartData;

                            // Filter out answers that start with "Other"
                            const filteredAnswers = question.answersCount.filter(
                                (ans) => !ans.answer.toLowerCase().startsWith("other")
                            );

                            // Check if there are any valid answers left after filtering "Other"
                            if (filteredAnswers.length === 0) {
                                return null; // This should never happen due to earlier filtering
                            }

                            if (question.isConditional) {
                                const yesLabels = ["yes", "oui", "si", "sí"];
                                const noLabels = ["no", "non"];

                                const yesAnswer = question.answersCount.find((ans) =>
                                    yesLabels.includes(ans.answer.toLowerCase())
                                );

                                const noAnswer = question.answersCount.find((ans) =>
                                    noLabels.includes(ans.answer.toLowerCase())
                                );

                                const yesCount = yesAnswer ? yesAnswer.count : 0;
                                const noCount = noAnswer ? noAnswer.count : 0;

                                chartData = [
                                    {
                                        answer:
                                            language === "fr"
                                                ? "Oui"
                                                : language === "it"
                                                    ? "Sì"
                                                    : language === "es"
                                                        ? "Sí"
                                                        : "Yes",
                                        count: yesCount,
                                    },
                                    {
                                        answer:
                                            language === "fr"
                                                ? "Non"
                                                : language === "it"
                                                    ? "No"
                                                    : language === "es"
                                                        ? "No"
                                                        : "No",
                                        count: noCount,
                                    },
                                ];
                            } else {
                                chartData = filteredAnswers;
                            }

                            return (
                                <BlockStack gap={300} key={question.id}>
                                    <Text variant="headingLg" as="h5">
                                        Q{currentPage}: {question.text}
                                    </Text>
                                    <ResponsiveContainer width="100%" height={400}>
                                        <PieChart>
                                            <Pie
                                                data={chartData}
                                                dataKey="count"
                                                nameKey="answer"
                                                cx="50%"
                                                cy="50%"
                                                outerRadius={150}
                                                fill="#8884d8"
                                                labelLine={false} // Removes the label lines
                                                label={({ cx, cy, midAngle, innerRadius, outerRadius, percent, index, value }) => {
                                                    const RADIAN = Math.PI / 180;
                                                    const radius = innerRadius + (outerRadius - innerRadius) * 0.5; // Position inside the slice
                                                    const x = cx + radius * Math.cos(-midAngle * RADIAN);
                                                    const y = cy + radius * Math.sin(-midAngle * RADIAN);
                                                    return (
                                                        <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central">
                                                            {value} {/* This is the count value */}
                                                        </text>
                                                    );
                                                }}
                                            >
                                                {chartData.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={["#0088FE", "#00C49F", "#FFBB28", "#FF8042"][index % 4]} />
                                                ))}
                                            </Pie>
                                            <Tooltip />
                                            <Legend />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </BlockStack>
                            );
                        })}

                        {/* If there isn't any Survey Data */}
                        {currentQuestions.length === 0 ? (
                            <EmptyState
                                heading={
                                    language === 'en'
                                        ? 'No English Survey Found'
                                        : language === 'fr'
                                            ? 'No French Survey Found'
                                            : language === 'it'
                                                ? 'No Italian Survey Found'
                                                : 'No Spanish Survey Found'
                                } image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                            >
                            </EmptyState>

                        )
                            :
                            (
                                <InlineStack align="center">
                                    <Pagination
                                        hasPrevious={currentPage > 1}
                                        label={currentPage + " / " + validQuestions.length}
                                        onPrevious={() => handlePagination(currentPage - 1)}
                                        hasNext={currentPage < Math.ceil(validQuestions.length / questionsPerPage)}
                                        onNext={() => handlePagination(currentPage + 1)}
                                    />
                                </InlineStack>
                            )}
                    </div>
                );
            })}
        </div>
    );

};

export default SurveyBarChart;
