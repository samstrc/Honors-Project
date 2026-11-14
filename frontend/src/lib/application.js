// The application form's rules: how it becomes a request, and what it will accept.
import { USD_TO_UNITS, LIMITS } from "./constants.js";

const NOT_EMPLOYED = ["Unemployed", "Pensioner", "Student"];
export const isEmployedUnknown = (form) => NOT_EMPLOYED.includes(form.incomeType);

// The request backend/app/model/schema.py expects, built from the form. The submit
// button, the live estimate and the preset badges all go through this.
export function buildPayload(form) {
  const employedUnknown = isEmployedUnknown(form);
  return {
    income: form.income * USD_TO_UNITS,
    credit_amount: form.creditAmount * USD_TO_UNITS,
    annuity: form.annuity * USD_TO_UNITS,
    goods_price: form.goodsPrice ? form.goodsPrice * USD_TO_UNITS : null,
    age_years: form.ageYears,
    children: form.children,
    family_members: form.familyMembers,
    education: form.education,
    income_type: form.incomeType,
    occupation: form.occupation || null,
    years_employed: employedUnknown ? null : form.yearsEmployed,
    organization_type: form.organizationType || null,
    ext_score_1: form.useExtScores ? form.extScore1 : null,
    ext_score_2: form.useExtScores ? form.extScore2 : null,
    ext_score_3: form.useExtScores ? form.extScore3 : null,
    cc_utilization: form.useCc ? form.ccUtilization : null,
  };
}

export const FIELD_LABEL = {
  income: "Monthly income",
  annuity: "Monthly payment",
  creditAmount: "Amount to borrow",
  goodsPrice: "Price of the item",
  ageYears: "Age",
  children: "Children",
  familyMembers: "People in household",
  yearsEmployed: "Years at current job",
};

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isInt = (v) => isNum(v) && Number.isInteger(v);
export const usd = (v) => `$${Math.round(v).toLocaleString()}`;

// Keeps the form inside the range the model was trained on (see LIMITS in constants.js
// for where the numbers come from) and refuses combinations no real application has.
// The backend applies looser sanity limits of its own; these are tighter and explain
// themselves, because outside this range the model just repeats its nearest answer.
export function validate(form) {
  const employedUnknown = isEmployedUnknown(form);
  const errors = {};
  const within = (key, what, fmt = usd, unit = "") => {
    const v = form[key];
    const { min, max } = LIMITS[key];
    if (!isNum(v)) errors[key] = `Enter ${what}.`;
    else if (v < min || v > max) errors[key] = `${FIELD_LABEL[key]} must be between ${fmt(min)} and ${fmt(max)}${unit}.`;
  };
  const whole = (key, what) => {
    const v = form[key];
    const { min, max } = LIMITS[key];
    if (!isInt(v) || v < min || v > max) errors[key] = `${what} must be a whole number from ${min} to ${max}.`;
  };

  within("income", "a monthly income");
  within("annuity", "a monthly payment");
  within("creditAmount", "an amount to borrow");
  // optional: blank or 0 means "no item", anything else has to be a real price
  if (form.goodsPrice !== "" && form.goodsPrice !== 0) within("goodsPrice", "a price");

  within("ageYears", "an age", String, "");
  whole("children", "Children");
  whole("familyMembers", "Household");
  if (!employedUnknown) within("yearsEmployed", "years at your job (0 if you just started)", String, " years");

  // the fields have to agree with each other, too
  if (!errors.annuity && !errors.creditAmount) {
    const share = form.annuity / form.creditAmount;
    if (share > LIMITS.paymentShareOfLoan.max)
      errors.annuity = `That would pay off the loan in under 8 months, faster than any loan in the data. For ${usd(form.creditAmount)}, keep it under about ${usd(form.creditAmount * LIMITS.paymentShareOfLoan.max)}.`;
    else if (share < LIMITS.paymentShareOfLoan.min)
      errors.annuity = `That would take over a decade to repay, and the longest loan in the data was 7 years. For ${usd(form.creditAmount)}, make it at least ${usd(form.creditAmount * LIMITS.paymentShareOfLoan.min)}.`;
  }
  if (!errors.annuity && !errors.income && form.annuity > LIMITS.paymentShareOfIncome.max * form.income)
    errors.annuity = `That's more than ${LIMITS.paymentShareOfIncome.max} times the monthly income. Nobody in the data paid more than about three quarters of theirs.`;
  if (!errors.children && !errors.familyMembers && form.familyMembers < form.children + 1)
    errors.familyMembers = `Count yourself and the ${form.children} children: at least ${form.children + 1}.`;
  if (!employedUnknown && !errors.yearsEmployed && !errors.ageYears && form.yearsEmployed > form.ageYears - LIMITS.workingAgeFrom)
    errors.yearsEmployed = `At ${form.ageYears}, that can be ${form.ageYears - LIMITS.workingAgeFrom} at most.`;
  return errors;
}
