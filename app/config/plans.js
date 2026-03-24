// app/config/plans.js

export const PLANS = {
  free: {
    name:         "free",
    label:        "Free",
    price:        0,
    surveyLimit:  1,
    trialDays:    0,
  },
  pro: {
    name:         "pro",
    label:        "Pro",
    price:        10,
    surveyLimit:  5,
    trialDays:    7,
  },
  advanced: {
    name:         "advanced",
    label:        "Advanced",
    price:        17,
    surveyLimit:  Infinity,
    trialDays:    7,
  },
};

export const DEFAULT_PLAN = PLANS.free;

export const PLAN_KEYS = Object.keys(PLANS); // ["free", "pro", "advanced"]
