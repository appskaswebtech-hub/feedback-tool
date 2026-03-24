// extensions/order-details/src/checkout.jsx

import {
  reactExtension,
  BlockStack,
  View,
  Heading,
  Text,
  ChoiceList,
  Choice,
  Button,
  useStorage,
  useApi,
  useSettings,
  TextField,
  SkeletonTextBlock,
  InlineStack,
} from '@shopify/ui-extensions-react/checkout';
import { SkeletonText } from '@shopify/ui-extensions/checkout';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

const orderDetailsBlock = reactExtension(
  "purchase.thank-you.block.render",
  () => <ProductReview />
);
export { orderDetailsBlock };

// ─── Plan question limits (mirrors server config) ─────────────
const QUESTION_LIMITS = {
  free:     1,
  pro:      5,
  advanced: null, // null = unlimited
};

function ProductReview() {
  const SHOPIFY_LOCAL_URL = 'https://quiz.kaswebtechsolutions.com';
  const api      = useApi();
  const id       = api.orderConfirmation.current.order.id;
  const orderId  = id.match(/\d+/g).pop();
  const shop     = api.shop.myshopifyDomain;
  const userEmail = api.buyerIdentity?.email?.current;
  const settings  = useSettings();

  const [quizData, setQuizData]         = useState(null);
  const [loading, setLoading]           = useState(false);
  const [fetchError, setFetchError]     = useState(false);
  const [radioValue, setRadioValue]     = useState('');
  const [checkboxValues, setCheckboxValues] = useState([]);
  const [answers, setAnswers]           = useState([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [shouldProceed, setShouldProceed] = useState(true);
  const [survey_title, setSurveyTitle]  = useState(null);
  const [textInput, setTextInput]       = useState('');
  const [submitted, setSubmitted]       = useState(false);

  // ✅ Plan state
  const [planName, setPlanName]         = useState("free");
  const [questionLimit, setQuestionLimit] = useState(1); // default to free
  const [planLoading, setPlanLoading]   = useState(true);

  const [{ data: productReviewed, loading: productReviewedLoading }] =
    useStorageState('product-reviewed');

  // ─── 1. Fetch active plan ────────────────────────────────────
  const fetchActivePlan = async () => {
    setPlanLoading(true);
    try {
      const response = await fetch(
        `${SHOPIFY_LOCAL_URL}/app/shopplan?shop=${encodeURIComponent(shop)}`,
        { method: 'GET' }
      );
      const data = await response.json();

      if (response.ok && data?.plan) {
        const plan  = data.plan.name ?? "free";
        const limit = QUESTION_LIMITS[plan] ?? 1; // null = unlimited
        setPlanName(plan);
        setQuestionLimit(limit);
        console.log(`[checkout] Plan: ${plan}, question limit: ${limit ?? '∞'}`);
      } else {
        // Default to free if plan fetch fails
        console.error('[checkout] Plan fetch failed, defaulting to free');
        setPlanName("free");
        setQuestionLimit(1);
      }
    } catch (error) {
      console.error('[checkout] Error fetching plan:', error);
      // Fail safe → free plan limits
      setPlanName("free");
      setQuestionLimit(1);
    } finally {
      setPlanLoading(false);
    }
  };

  useEffect(() => {
    fetchActivePlan();
  }, []);

  // ─── 2. Fetch survey title ───────────────────────────────────
  const fetchSurveyTitle = async () => {
    try {
      const lang = api?.localization?.language?.current?.isoCode.slice(0, 2) || 'en';
      const response = await fetch(
        `${SHOPIFY_LOCAL_URL}/app/survey?shop=${encodeURIComponent(shop)}&lang=${lang}`,
        { method: 'GET' }
      );
      const data = await response.json();

      if (response.ok && data?.surveyTitle) {
        setSurveyTitle(data.surveyTitle);
      } else {
        console.error('[checkout] Error fetching survey title:', data?.error ?? 'No surveyTitle');
        setFetchError(true);
      }
    } catch (error) {
      console.error('[checkout] Error fetching survey title:', error);
      setFetchError(true);
    }
  };

  useEffect(() => {
    fetchSurveyTitle();
  }, []);

  // ─── 3. Fetch quiz data ──────────────────────────────────────
  const fetchQuizData = async () => {
    setLoading(true);
    try {
      const lang      = api?.localization?.language?.current?.isoCode.slice(0, 2);
      const isFrench  = lang === 'fr';
      const response  = await fetch(
        `${SHOPIFY_LOCAL_URL}/app/questions?shop=${encodeURIComponent(shop)}`,
        { method: 'GET' }
      );
      const data = await response.json();

      if (response.ok) {
        let quiz;
        if (isFrench) {
          quiz = data.surveys.find(s => s.isFrenchVersion === true);
        } else {
          quiz = data.surveys.find(s => s.title === survey_title);
        }

        if (quiz) {
          // ✅ Slice questions based on plan limit
          // questionLimit === null means unlimited (advanced plan)
          const limitedQuiz = {
            ...quiz,
            questions: questionLimit === null
              ? quiz.questions                          // unlimited
              : quiz.questions.slice(0, questionLimit), // slice to limit
          };

          setQuizData(limitedQuiz);
          console.log(
            `[checkout] Loaded ${limitedQuiz.questions.length} question(s) ` +
            `(plan: ${planName}, limit: ${questionLimit ?? '∞'})`
          );
        } else {
          console.error(`[checkout] No quiz found — shop: ${shop}, title: ${survey_title}`);
          setFetchError(true);
        }
      } else {
        console.error('[checkout] Error fetching quiz data:', data.error);
        setFetchError(true);
      }
    } catch (error) {
      console.error('[checkout] Failed to fetch quiz data:', error);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  };

  // ✅ Wait for both survey_title AND plan to be loaded before fetching quiz
  useLayoutEffect(() => {
    if (!survey_title || planLoading) return;
    fetchQuizData();
  }, [survey_title, planLoading]);

  // ─── Submit helpers ──────────────────────────────────────────
  async function handleSubmit(updateAnswers = answers) {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        shop,
        shopDomain: shop,
        email:       userEmail,
        surveyTitle: survey_title,
        orderId,
        answers:     JSON.stringify(updateAnswers),
      });
      const response = await fetch(
        `${SHOPIFY_LOCAL_URL}/app/proxy?${params}`,
        { method: 'GET' }
      );
      if (!response.ok) throw new Error('Failed to submit review');
      console.log('[checkout] Submitted:', await response.json());
      setShouldProceed(false);
      setSubmitted(true);
    } catch (error) {
      console.error('[checkout] Error submitting review:', error);
    } finally {
      setLoading(false);
    }
  }

  async function nextSubmit(updateAnswers = []) {
    try {
      const params = new URLSearchParams({
        shop,
        shopDomain:  shop,
        email:       userEmail,
        surveyTitle: survey_title,
        orderId,
        answers:     JSON.stringify(updateAnswers),
      });
      const response = await fetch(
        `${SHOPIFY_LOCAL_URL}/app/proxy?${params}`,
        { method: 'GET' }
      );
      if (!response.ok) throw new Error('Failed to auto-save');
      console.log('[checkout] Auto-saved:', await response.json());
    } catch (error) {
      console.error('[checkout] Error auto-saving:', error);
    }
  }

  // ─── Guards ──────────────────────────────────────────────────
  if (fetchError) return null;
  if (productReviewed || productReviewedLoading) return null;

  // ── Show loading skeleton while plan or quiz is loading ──────
  if (planLoading || (loading && !quizData)) {
    return (
      <View border="base" padding="base" borderRadius="base">
        <BlockStack>
          <SkeletonTextBlock />
          <SkeletonTextBlock />
          <SkeletonTextBlock />
        </BlockStack>
      </View>
    );
  }

  const currentQuestion = quizData ? quizData.questions[currentQuestionIndex] : null;
  const IS_CHECKBOX     = currentQuestion?.isMultiChoice === true;
  const IS_RADIO        = currentQuestion?.isSingle === true;

  // ─── Navigation ──────────────────────────────────────────────
  const handleNext = (prebuiltAnswers = null) => {
    const answersToUse = prebuiltAnswers || answers;
    const currentQ     = quizData.questions[currentQuestionIndex];
    const currentAnswer = answersToUse[currentQuestionIndex]?.answer?.toLowerCase();

    if (currentQ.isConditional && (currentAnswer === 'no' || currentAnswer === 'non')) {
      setShouldProceed(false);
      handleSubmit(answersToUse);
      return;
    }

    if (currentQuestionIndex < quizData.questions.length - 1) {
      nextSubmit(answersToUse);
      setCurrentQuestionIndex(prev => prev + 1);
      setRadioValue('');
      setCheckboxValues([]);
      setTextInput('');
    }
  };

  // ─── Radio handler ────────────────────────────────────────────
  const handleRadioChange = (selectedValue) => {
    const normalizedValue = Array.isArray(selectedValue) ? selectedValue[0] : selectedValue;
    const selectedOption  = currentQuestion.answers.find(
      opt => opt.id === parseInt(normalizedValue)
    );
    if (!selectedOption) return;

    setRadioValue(normalizedValue);

    const updatedAnswers = [...answers];
    updatedAnswers[currentQuestionIndex] = {
      questionTitle:  currentQuestion.text,
      questionNumber: currentQuestionIndex + 1,
      answer:         selectedOption.text,
    };
    setAnswers(updatedAnswers);

    if (!selectedOption.haveTextBox) {
      nextSubmit(updatedAnswers);
    }
  };

  // ─── Checkbox handler ─────────────────────────────────────────
  const handleCheckboxChange = (selectedValues) => {
    const valuesArray = Array.isArray(selectedValues)
      ? selectedValues
      : String(selectedValues).split(',').filter(Boolean);

    setCheckboxValues(valuesArray);

    const selectedOptions = currentQuestion.answers.filter(opt =>
      valuesArray.includes(opt.id.toString())
    );
    const formattedAnswers = selectedOptions.map(opt =>
      opt.haveTextBox && textInput.trim() !== '' ? `other(${textInput})` : opt.text
    );

    const updatedAnswers = [...answers];
    updatedAnswers[currentQuestionIndex] = {
      questionTitle:  currentQuestion.text,
      questionNumber: currentQuestionIndex + 1,
      answer:         formattedAnswers.join(','),
    };
    setAnswers(updatedAnswers);
    nextSubmit(updatedAnswers);
  };

  // ─── Text input handler ───────────────────────────────────────
  const handleTextInputChange = (value) => {
    setTextInput(value);
    setAnswers(prevAnswers => {
      const updatedAnswers  = [...prevAnswers];
      const activeIds       = IS_CHECKBOX ? checkboxValues : [radioValue];
      const selectedOptions = currentQuestion.answers.filter(opt =>
        activeIds.includes(opt.id.toString())
      );
      const formattedAnswer = selectedOptions.length > 0
        ? selectedOptions.map(opt =>
            opt.haveTextBox ? `other(${value})` : opt.text
          ).join(',')
        : `other(${value})`;

      updatedAnswers[currentQuestionIndex] = {
        questionTitle:  currentQuestion.text,
        questionNumber: currentQuestionIndex + 1,
        answer:         formattedAnswer,
      };
      return updatedAnswers;
    });
  };

  const buildHaveTextBoxAnswers = (currentTextInput) => {
    const updatedAnswers  = [...answers];
    const activeIds       = IS_CHECKBOX ? checkboxValues : [radioValue];
    const selectedOptions = currentQuestion.answers.filter(opt =>
      activeIds.includes(opt.id.toString())
    );
    const formattedAnswer = selectedOptions.length > 0
      ? selectedOptions.map(opt =>
          opt.haveTextBox ? `other(${currentTextInput})` : opt.text
        ).join(',')
      : `other(${currentTextInput})`;

    updatedAnswers[currentQuestionIndex] = {
      questionTitle:  currentQuestion.text,
      questionNumber: currentQuestionIndex + 1,
      answer:         formattedAnswer,
    };
    return updatedAnswers;
  };

  // ─── Submitted screen ─────────────────────────────────────────
  if (!shouldProceed || submitted) {
    return (
      <View border="base" padding="base" borderRadius="base">
        <BlockStack>
          <Heading>Thanks for your feedback!</Heading>
          <Text>Your response has been submitted</Text>
        </BlockStack>
      </View>
    );
  }

  const selectedRadioHasTextBox =
    IS_RADIO &&
    currentQuestion.answers.some(
      opt => opt.haveTextBox && radioValue === opt.id.toString()
    );

  // ─── Main render ──────────────────────────────────────────────
  return (
    <View border="base" padding="base">
      <BlockStack>

        {/* Question heading */}
        <Heading level={1}>
          {currentQuestion ? currentQuestion.text : <SkeletonText />}
        </Heading>

        {/* ✅ Progress indicator — shows x/total based on plan limit */}
        {quizData && quizData.questions.length > 1 && (
          <Text size="small" appearance="subdued">
            Question {currentQuestionIndex + 1} of {quizData.questions.length}
          </Text>
        )}

        {currentQuestion ? (
          <>
            {/* Text box question */}
            {currentQuestion.isTextBox ? (
              <BlockStack>
                <TextField
                  name={`quiz-response-${currentQuestionIndex}`}
                  label="Enter Something!"
                  value={textInput}
                  onChange={handleTextInputChange}
                />
              </BlockStack>

            ) : IS_CHECKBOX ? (
              /* Multi-choice question */
              <ChoiceList
                key={`checkbox-${currentQuestionIndex}`}
                name={`quiz-response-${currentQuestionIndex}`}
                allowMultiple={true}
                value={checkboxValues}
                onChange={handleCheckboxChange}
              >
                <BlockStack>
                  {currentQuestion.answers.map((option, optIndex) => (
                    <Choice key={optIndex} id={option.id.toString()}>
                      {option.haveTextBox ? (
                        <>
                          {option.text}
                          {checkboxValues.includes(option.id.toString()) && (
                            <TextField
                              name={`quiz-response-${currentQuestionIndex}-${optIndex}`}
                              label="Enter your response"
                              value={textInput}
                              onChange={handleTextInputChange}
                            />
                          )}
                        </>
                      ) : (
                        option.text
                      )}
                    </Choice>
                  ))}
                </BlockStack>
              </ChoiceList>

            ) : (
              /* Single / conditional question */
              <ChoiceList
                key={`radio-${currentQuestionIndex}`}
                name={`quiz-response-${currentQuestionIndex}`}
                value={radioValue}
                onChange={handleRadioChange}
              >
                <BlockStack>
                  {currentQuestion.answers.map((option, optIndex) => (
                    <Choice key={optIndex} id={option.id.toString()}>
                      {option.haveTextBox ? (
                        <>
                          {option.text}
                          {radioValue === option.id.toString() && (
                            <InlineStack spacing="base">
                              <TextField
                                name={`quiz-response-${currentQuestionIndex}-${optIndex}`}
                                label="Enter your response"
                                value={textInput}
                                onChange={handleTextInputChange}
                              />
                              <Button
                                kind="secondary"
                                onPress={() => {
                                  const freshAnswers = buildHaveTextBoxAnswers(textInput);
                                  setAnswers(freshAnswers);
                                  handleNext(freshAnswers);
                                }}
                              >
                                SAVE
                              </Button>
                            </InlineStack>
                          )}
                        </>
                      ) : (
                        option.text
                      )}
                    </Choice>
                  ))}
                </BlockStack>
              </ChoiceList>
            )}

            {/* Navigation buttons */}
            <BlockStack>
              {currentQuestionIndex < quizData.questions.length - 1 ? (
                IS_CHECKBOX ? (
                  <Button
                    kind="secondary"
                    onPress={() => handleNext()}
                    disabled={checkboxValues.length === 0}
                  >
                    SAVE
                  </Button>
                ) : currentQuestion.isTextBox ? (
                  <Button kind="secondary" onPress={() => handleNext()}>
                    SAVE
                  </Button>
                ) : selectedRadioHasTextBox ? (
                  null
                ) : (
                  <Button
                    kind="secondary"
                    onPress={() => handleNext()}
                    disabled={!radioValue}
                  >
                    SAVE
                  </Button>
                )
              ) : (
                <Button
                  kind="primary"
                  onPress={() => handleSubmit()}
                  loading={loading}
                >
                  SUBMIT
                </Button>
              )}
            </BlockStack>
          </>
        ) : (
          <>
            <SkeletonTextBlock />
            <SkeletonTextBlock />
            <SkeletonTextBlock />
          </>
        )}
      </BlockStack>
    </View>
  );
}

// ─── Storage hook ─────────────────────────────────────────────
function useStorageState(key) {
  const storage = useStorage();
  const [data, setData]       = useState();
  const [loading, setLoading] = useState(true);

  useLayoutEffect(() => {
    async function queryStorage() {
      const value = await storage.read(key);
      setData(value);
      setLoading(false);
    }
    queryStorage();
  }, [setData, setLoading, storage, key]);

  const setStorage = useCallback(
    (value) => { storage.write(key, value); },
    [storage, key]
  );

  return [{ data, loading }, setStorage];
}

