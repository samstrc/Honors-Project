// Ported directly from Streamlit Website/streamlit_app.py, including the comments -- the
// numbers and reasoning are the project's, not this front end's to redecide.

export const MODEL_AUC = 0.797; // full model, with a complete credit history
export const MODEL_AUC_APPONLY = 0.76; // what a preapproval form actually reaches

// The dataset's currency is anonymised, so there is no exchange rate to look up. This is a
// calibration constant, not an exchange rate: it maps the dataset's median applicant
// income (147,150 a month) onto $4,300 a month, so someone entering dollars lands in the
// same part of the population an equivalent Home Credit applicant would.
export const TYPICAL_INCOME_USD = 4300.0;
export const DATASET_MEDIAN_INCOME = 147150.0;
export const USD_TO_UNITS = DATASET_MEDIAN_INCOME / TYPICAL_INCOME_USD; // ~34.2209

// The dataset's three bureau scores are anonymised and normalised to 0-1. The form shows
// them on the 300-850 scale most people know from their own credit report and converts
// linearly, so a slider position means the same thing either way; the model still
// receives the 0-1 value it was trained on.
export const SCORE_MIN = 300;
export const SCORE_MAX = 850;
export const extToScore = (ext) => SCORE_MIN + ext * (SCORE_MAX - SCORE_MIN);
export const scoreToExt = (score) => (score - SCORE_MIN) / (SCORE_MAX - SCORE_MIN);

// What the form will accept, in US dollars. These are the range the model was trained
// on, not arbitrary caps: a tree model can't tell inputs apart beyond the last split it
// learned, so $500k a month and $5M a month score identically, and so do $5 and $500.
// From application_train.csv at the calibration above: 99.9% of applicants had an
// income of $920-$26,300 a month, a loan of $1,400-$73,600 (max $118k), a payment of
// $115-$3,200 (max $7,540), were 21-69, had 0-4 children in a household of 1-6, and
// paid 1-12.4% of the loan per month. Nobody had more children than household members,
// and nobody had been in a job longer than their age minus 14.
export const LIMITS = {
  income: { min: 1000, max: 25000 },
  creditAmount: { min: 1500, max: 120000 },
  annuity: { min: 100, max: 7500 },
  goodsPrice: { min: 1000, max: 120000 },
  ageYears: { min: 18, max: 75 },
  children: { min: 0, max: 12 },
  familyMembers: { min: 1, max: 15 },
  yearsEmployed: { min: 0, max: 50 },
  // the monthly payment as a share of the loan: below 1% the term would run past a
  // decade (the data's longest is 7 years); above 15% it would be under 8 months
  paymentShareOfLoan: { min: 0.01, max: 0.15 },
  // nobody in the data paid more than 73% of their income; twice income is the hard stop
  paymentShareOfIncome: { max: 2 },
  // you can't have worked since before you were 15
  workingAgeFrom: 15,
};

export const RISK_SCALE_MAX = 0.3;
export const RISK_MEDIAN = 0.0606;

export const PRESETS = {
  "Strong applicant": {
    income: 9350.0,
    creditAmount: 5840.0,
    annuity: 350.0,
    goodsPrice: 5260.0,
    ageYears: 42,
    gender: "F",
    children: 0,
    familyMembers: 2,
    familyStatus: "Married",
    education: "Higher education",
    incomeType: "Working",
    occupation: "Managers",
    yearsEmployed: 15.0,
    useExtScores: true,
    extScore1: 0.85,
    extScore2: 0.82,
    extScore3: 0.8,
    useCc: true,
    ccUtilization: 0.1,
  },
  "Typical applicant": {
    income: 4380.0,
    creditAmount: 14990.0,
    annuity: 730.0,
    goodsPrice: 13150.0,
    ageYears: 43,
    gender: "F",
    children: 0,
    familyMembers: 2,
    familyStatus: "Married",
    education: "Secondary / secondary special",
    incomeType: "Working",
    occupation: "",
    yearsEmployed: 4.5,
    useExtScores: false,
    extScore1: 0.5,
    extScore2: 0.5,
    extScore3: 0.5,
    useCc: false,
    ccUtilization: 0.3,
  },
  "High-risk applicant": {
    income: 1170.0,
    creditAmount: 29220.0,
    annuity: 1900.0,
    goodsPrice: 27760.0,
    ageYears: 21,
    gender: "M",
    children: 3,
    familyMembers: 5,
    familyStatus: "Single / not married",
    education: "Lower secondary",
    incomeType: "Unemployed",
    occupation: "",
    yearsEmployed: 0.0,
    useExtScores: true,
    extScore1: 0.08,
    extScore2: 0.06,
    extScore3: 0.07,
    useCc: true,
    ccUtilization: 1.7,
  },
};

export const DEFAULT_FORM = {
  income: 4300.0,
  creditAmount: 15000.0,
  annuity: 730.0,
  goodsPrice: 13150.0,
  ageYears: 35,
  gender: "F",
  children: 0,
  familyMembers: 1,
  familyStatus: "Married",
  education: "Secondary / secondary special",
  incomeType: "Working",
  occupation: "",
  organizationType: "",
  yearsEmployed: 5.0,
  useExtScores: false,
  extScore1: 0.5,
  extScore2: 0.5,
  extScore3: 0.5,
  useCc: false,
  ccUtilization: 0.3,
};

export const FAMILY_STATUS_OPTIONS = [
  "Married",
  "Single / not married",
  "Civil marriage",
  "Separated",
  "Widow",
  "Unknown",
];

export const EDUCATION_OPTIONS = [
  "Secondary / secondary special",
  "Higher education",
  "Incomplete higher",
  "Lower secondary",
  "Academic degree",
];

export const INCOME_TYPE_OPTIONS = [
  "Working",
  "Commercial associate",
  "State servant",
  "Pensioner",
  "Unemployed",
  "Student",
  "Businessman",
  "Maternity leave",
];

export const OCCUPATION_OPTIONS = [
  "Laborers",
  "Core staff",
  "Sales staff",
  "Managers",
  "Drivers",
  "High skill tech staff",
  "Accountants",
  "Medicine staff",
  "Security staff",
  "Cooking staff",
  "Cleaning staff",
  "Private service staff",
  "Low-skill Laborers",
  "Secretaries",
  "Waiters/barmen staff",
  "HR staff",
  "Realty agents",
  "IT staff",
];

export const ORGANIZATION_OPTIONS = [
  "Advertising", "Agriculture", "Bank", "Business Entity Type 1", "Business Entity Type 2",
  "Business Entity Type 3", "Cleaning", "Construction", "Culture", "Electricity",
  "Emergency", "Government", "Hotel", "Housing", "Industry: type 1", "Industry: type 10",
  "Industry: type 11", "Industry: type 12", "Industry: type 13", "Industry: type 2",
  "Industry: type 3", "Industry: type 4", "Industry: type 5", "Industry: type 6",
  "Industry: type 7", "Industry: type 8", "Industry: type 9", "Insurance", "Kindergarten",
  "Legal Services", "Medicine", "Military", "Mobile", "Other", "Police", "Postal",
  "Realtor", "Religion", "Restaurant", "School", "Security", "Security Ministries",
  "Self-employed", "Services", "Telecom", "Trade: type 1", "Trade: type 2",
  "Trade: type 3", "Trade: type 4", "Trade: type 5", "Trade: type 6", "Trade: type 7",
  "Transport: type 1", "Transport: type 2", "Transport: type 3", "Transport: type 4",
  "University", "XNA",
];
