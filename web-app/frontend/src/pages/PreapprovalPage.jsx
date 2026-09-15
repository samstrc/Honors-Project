import { useEffect, useRef, useState } from "react";
import { Kicker, PageTitle, PageSubtitle, FactsRow, SectionTitle, SectionSub } from "../components/PageHeader.jsx";
import { NumberField, SelectField, SliderField, Checkbox } from "../components/Fields.jsx";
import InlineLink from "../components/InlineLink.jsx";
import RiskMeter from "../components/RiskMeter.jsx";
import LiveEstimate from "../components/LiveEstimate.jsx";
import { StepTabs, StepPanel } from "../components/Steps.jsx";
import { WalletIcon, UserIcon, BriefcaseIcon, ShieldIcon, StarIcon, AlertIcon } from "../components/icons.jsx";
import DistributionChart from "../components/DistributionChart.jsx";
import FactorChart from "../components/FactorChart.jsx";
import { predict, loadRiskDistribution } from "../lib/api.js";
import {
  MODEL_AUC,
  MODEL_AUC_APPONLY,
  USD_TO_UNITS,
  PRESETS,
  DEFAULT_FORM,
  FAMILY_STATUS_OPTIONS,
  EDUCATION_OPTIONS,
  INCOME_TYPE_OPTIONS,
  OCCUPATION_OPTIONS,
  ORGANIZATION_OPTIONS,
  SCORE_MIN,
  SCORE_MAX,
  extToScore,
  scoreToExt,
} from "../lib/constants.js";

const TABS = [
  { label: "Income & loan", icon: WalletIcon },
  { label: "About you", icon: UserIcon },
  { label: "Employment", icon: BriefcaseIcon },
  { label: "Credit bureau", icon: ShieldIcon },
];

const NOT_EMPLOYED = ["Unemployed", "Pensioner", "Student"];
const isEmployedUnknown = (form) => NOT_EMPLOYED.includes(form.incomeType);

// The request Modeling/api/main.py expects, built from the form. Used by the submit
// button, the live estimate, and the preset badges, so the conversion lives once.
function buildPayload(form) {
  const employedUnknown = isEmployedUnknown(form);
  return {
    income: form.income * USD_TO_UNITS,
    credit_amount: form.creditAmount * USD_TO_UNITS,
    annuity: form.annuity * USD_TO_UNITS,
    goods_price: form.goodsPrice ? form.goodsPrice * USD_TO_UNITS : null,
    age_years: form.ageYears,
    gender: form.gender,
    children: form.children,
    family_members: form.familyMembers,
    family_status: form.familyStatus,
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

// How each example is introduced on its card.
const PRESET_META = {
  "Strong applicant": { icon: StarIcon, blurb: "Well paid, small loan, long in the job, strong bureau scores." },
  "Typical applicant": { icon: UserIcon, blurb: "The median borrower: ordinary income, ordinary loan, no bureau data." },
  "High-risk applicant": { icon: AlertIcon, blurb: "Young, unemployed, borrowing a lot, weak scores, card over its limit." },
};
const money = (v) => `$${Math.round(v).toLocaleString()}`;
const presetProfile = (p) =>
  `${money(p.income)}/mo · borrows ${money(p.creditAmount)} · age ${p.ageYears} · ${
    NOT_EMPLOYED.includes(p.incomeType) ? p.incomeType.toLowerCase() : `${p.yearsEmployed} yrs in job`
  }`;
const presetIsActive = (form, preset) => Object.keys(preset).every((k) => form[k] === preset[k]);

// Which tab each validated field lives on, so a failed submit can jump straight to it
// instead of silently refusing (which is what the browser did when the offending input
// was on a hidden tab).
const FIELD_TAB = {
  income: 0,
  annuity: 0,
  creditAmount: 0,
  goodsPrice: 0,
  ageYears: 1,
  children: 1,
  familyMembers: 1,
  yearsEmployed: 2,
};
const FIELD_LABEL = {
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

// The same limits Modeling/api/schema.py enforces (income/credit/annuity > 0, age 18-99,
// children >= 0, household >= 1, years employed >= 0, goods price > 0 if given), checked
// here so the message can name the field in plain words rather than surfacing as a 422.
function validate(form, employedUnknown) {
  const errors = {};
  const positive = (key, what) => {
    if (!isNum(form[key])) errors[key] = `Enter ${what}.`;
    else if (form[key] <= 0) errors[key] = `${FIELD_LABEL[key]} must be more than $0.`;
  };
  positive("income", "a monthly income");
  positive("annuity", "a monthly payment");
  positive("creditAmount", "an amount to borrow");

  // optional: blank or 0 means "no item", anything else has to be a real price
  if (form.goodsPrice !== "" && form.goodsPrice !== 0) {
    if (!isNum(form.goodsPrice) || form.goodsPrice < 0) errors.goodsPrice = "Enter a price, or leave at 0 for a cash loan.";
  }

  if (!isNum(form.ageYears)) errors.ageYears = "Enter an age.";
  else if (form.ageYears < 18 || form.ageYears > 99) errors.ageYears = "Age must be between 18 and 99.";

  if (!isInt(form.children) || form.children < 0) errors.children = "Children must be a whole number, 0 or more.";
  if (!isInt(form.familyMembers) || form.familyMembers < 1) errors.familyMembers = "Household must be a whole number, at least 1.";

  if (!employedUnknown) {
    if (!isNum(form.yearsEmployed)) errors.yearsEmployed = "Enter years at your current job (0 if you just started).";
    else if (form.yearsEmployed < 0) errors.yearsEmployed = "Years at current job can't be negative.";
  }
  return errors;
}

function AboutPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-7 mt-2.5 animate-fade-up rounded-xl border border-border bg-card [animation-delay:200ms]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="focus-ring flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="text-[0.82rem] font-semibold text-ink-primary">About this tool</span>
        <svg
          viewBox="0 0 20 20"
          fill="none"
          className={`h-3.5 w-3.5 shrink-0 text-ink-muted transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M5 7.5 10 12.5 15 7.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div className="animate-fade-in space-y-3 border-t border-border px-4 py-4 text-[0.83rem] leading-relaxed text-ink-secondary">
          <p>
            A LightGBM model trained on 307,511 consumer loan applications from Home
            Credit. It reads 693 features: the application itself, plus what the credit
            bureau knows about the applicant, their past applications, and how they
            repaid them.
          </p>
          <p>
            It doesn't reweight the classes, which means the probabilities mean what they
            say. It predicts 7.9% on average against a real rate of 8.1%, with nothing
            corrected afterwards.
          </p>
          <div className="flex gap-6">
            <div>
              <div className="text-[0.7rem] uppercase tracking-wide text-ink-muted">With a full credit file</div>
              <div className="text-lg font-bold text-ink-primary">{MODEL_AUC.toFixed(3)}</div>
            </div>
            <div>
              <div className="text-[0.7rem] uppercase tracking-wide text-ink-muted">From the form alone</div>
              <div className="text-lg font-bold text-ink-primary">{MODEL_AUC_APPONLY.toFixed(3)}</div>
            </div>
          </div>
          <p className="text-[0.78rem] text-ink-muted">
            Two numbers because they answer different questions. The model scores{" "}
            {MODEL_AUC.toFixed(3)} AUC when it can look up the applicant's credit history. A
            preapproval form has no history to look up, so about 600 of the 693 features
            arrive empty and it works out closer to {MODEL_AUC_APPONLY.toFixed(3)}. That
            second number is the one this page is actually delivering.
          </p>
          <div className="h-px bg-border" />
          <p className="text-[0.78rem] text-ink-muted">
            "Risk" here means what the dataset actually recorded: a payment more than a few
            days late on one of the first instalments. That's an early stumble, not a
            written-off loan. It happened to 8.07% of applicants.
          </p>
          <p className="text-[0.78rem] text-ink-muted">
            Built as part of an honors research project. Predictions are illustrative only
            and not a real lending decision.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export default function PreapprovalPage() {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [tab, setTab] = useState(0);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [distribution, setDistribution] = useState(null);
  const [live, setLive] = useState({ estimate: null, state: "loading" });
  const [presetScores, setPresetScores] = useState({});
  const [scoredForm, setScoredForm] = useState(null);
  const firstScore = useRef(true);

  useEffect(() => {
    loadRiskDistribution().then(setDistribution).catch(() => {});
  }, []);

  // Score the form as it changes (debounced), so the estimate beside the title is always
  // current. Invalid forms keep the last number and say why; an unreachable API is shown
  // as offline rather than as an error banner.
  useEffect(() => {
    if (Object.keys(validate(form, isEmployedUnknown(form))).length) {
      setLive((l) => ({ ...l, state: "invalid" }));
      return undefined;
    }
    const abort = new AbortController();
    setLive((l) => ({ ...l, state: "loading" }));
    const delay = firstScore.current ? 0 : 350;
    firstScore.current = false;
    const id = setTimeout(async () => {
      try {
        const r = await predict(buildPayload(form), abort.signal);
        setLive({ estimate: { prob: r.default_probability, threshold: r.threshold, decision: r.decision }, state: "ready" });
      } catch (e) {
        if (e.name !== "AbortError") setLive((l) => ({ ...l, state: "offline" }));
      }
    }, delay);
    return () => {
      clearTimeout(id);
      abort.abort();
    };
  }, [form]);

  // Score the three examples for the badges on their cards. One at a time, and only
  // after the live estimate has had a head start: on a small host the four requests
  // would otherwise fight over the CPU and the number people are actually watching
  // arrives last. Scores are remembered for the session so coming back to this page
  // doesn't repeat the work.
  useEffect(() => {
    const cacheKey = "preset-scores";
    try {
      const cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
      if (cached && Object.keys(PRESETS).every((k) => cached[k])) {
        setPresetScores(cached);
        return undefined;
      }
    } catch {
      /* no cache: score them */
    }
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      const scores = {};
      for (const name of Object.keys(PRESETS)) {
        try {
          scores[name] = await predict(buildPayload({ ...DEFAULT_FORM, ...PRESETS[name] }), abort.signal);
        } catch (e) {
          if (e.name === "AbortError") return;
          scores[name] = null; // tried and failed (API offline): no badge, no endless placeholder
        }
        setPresetScores({ ...scores });
      }
      if (Object.values(scores).every(Boolean)) {
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify(scores));
        } catch {
          /* fine without */
        }
      }
    }, 900);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, []);

  // Editing a field clears its own error straight away; the rest wait for the next submit.
  const set = (key) => (value) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (fieldErrors[key]) setFieldErrors((e) => ({ ...e, [key]: undefined }));
  };
  const employedUnknown = ["Unemployed", "Pensioner", "Student"].includes(form.incomeType);
  const invalidFields = Object.keys(fieldErrors).filter(
    (k) => fieldErrors[k] && !(k === "yearsEmployed" && employedUnknown)
  );

  function applyPreset(name) {
    setForm((f) => ({ ...f, ...PRESETS[name] }));
    setResult(null);
    setError(null);
    setFieldErrors({});
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);

    const errors = validate(form, employedUnknown);
    setFieldErrors(errors);
    const firstBad = Object.keys(errors)[0];
    if (firstBad) {
      setTab(FIELD_TAB[firstBad]);
      return;
    }

    setLoading(true);
    try {
      const res = await predict(buildPayload(form));
      setResult(res);
      setScoredForm(form);
      requestAnimationFrame(() =>
        document.getElementById("result-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" })
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <Kicker>Home Credit · honors research project</Kicker>
      <div className="grid grid-cols-1 items-start gap-6 sm:grid-cols-[1fr_auto] sm:gap-8">
        <div>
          <PageTitle>Consumer loan preapproval</PageTitle>
          <PageSubtitle>
            Fill in a few details and see how likely this applicant is to miss an early
            payment. These are everyday <b>consumer loans</b>, the kind you take out for a
            phone, a laptop or furniture, or as a small cash loan. Most are paid back inside
            a year. No mortgages here.
          </PageSubtitle>
          <InlineLink to="/guide" className="mt-5">
            <b>About the research.</b> How the model was built, what the study found, and
            why the form asks what it asks.
          </InlineLink>
        </div>
        <div className="animate-fade-up sm:pt-3 [animation-delay:200ms]">
          <LiveEstimate estimate={live.estimate} state={live.state} />
        </div>
      </div>

      <FactsRow
        facts={[
          { value: "307,511", label: "real applications behind the model" },
          { value: "8.1%", label: "missed an early payment" },
          { value: "12 months", label: "typical time to pay one back" },
        ]}
      />

      <AboutPanel />

      {/* presets */}
      <div className="mb-2 text-[0.75rem] font-semibold uppercase tracking-wide text-ink-muted">
        Start from an example
      </div>
      <div className="mb-6 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {Object.keys(PRESETS).map((name) => {
          const { icon: Icon, blurb } = PRESET_META[name];
          const score = presetScores[name];
          const active = presetIsActive(form, PRESETS[name]);
          const good = score?.decision === "preapproved";
          const scoreColor = good ? "var(--good)" : "var(--critical)";
          return (
            <button
              key={name}
              type="button"
              onClick={() => applyPreset(name)}
              aria-pressed={active}
              className={`focus-ring group relative flex flex-col rounded-xl border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-card ${
                active ? "border-accent shadow-card" : "border-border hover:border-accent"
              }`}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                    active ? "bg-accent text-[var(--card)]" : "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-accent"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                {score ? (
                  <span
                    className="animate-fade-in rounded-full px-2 py-0.5 text-[0.72rem] font-bold tabular-nums"
                    style={{ color: scoreColor, background: `color-mix(in srgb, ${scoreColor} 14%, transparent)` }}
                  >
                    {(score.default_probability * 100).toFixed(1)}%
                  </span>
                ) : score === undefined ? (
                  <span className="skeleton h-5 w-11 animate-shimmer rounded-full" />
                ) : null}
              </div>
              <div className="mt-3 text-[0.9rem] font-semibold text-ink-primary">{name}</div>
              <div className="mt-0.5 text-[0.76rem] leading-snug text-ink-secondary">{blurb}</div>
              <div className="mt-2.5 border-t border-border pt-2 text-[0.7rem] leading-snug text-ink-muted">
                {presetProfile(PRESETS[name])}
              </div>
            </button>
          );
        })}
      </div>

      <form noValidate onSubmit={onSubmit} className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6">
        <div className="mb-4 border-b border-border pb-3">
          <StepTabs
            items={TABS}
            active={tab}
            onChange={setTab}
            errorAt={(i) => invalidFields.some((k) => FIELD_TAB[k] === i)}
          />
        </div>

        <StepPanel step={tab}>

        {tab === 0 ? (
          <div>
            <p className="mb-4 text-[0.82rem] leading-relaxed text-ink-muted">
              Enter amounts in <b>US dollars</b>. Income is <b>monthly</b>, before tax. The
              dataset's own currency is anonymised, so dollars are converted at a fixed
              rate set so the typical applicant earns $4,300 a month. That rate is a
              calibration constant, not a real exchange rate. For scale, the typical
              applicant borrows about $15,000, roughly 3.3 months of income paid back over
              20 months.
            </p>
            <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2">
              <NumberField
                label="Monthly income before tax"
                prefix="$"
                min={0}
                value={form.income}
                onChange={set("income")}
                error={fieldErrors.income}
                help="Gross monthly income, before tax and deductions. Entering net instead of gross moves a typical result by about 0.2 percentage points."
              />
              <NumberField
                label="Monthly payment"
                prefix="$"
                min={0}
                value={form.annuity}
                onChange={set("annuity")}
                error={fieldErrors.annuity}
                help="What you would pay each month. Across prior loans, monthly payment × number of payments comes to about 1.26x the amount borrowed. The rest is interest."
              />
              <NumberField
                label="Amount you want to borrow"
                prefix="$"
                min={0}
                value={form.creditAmount}
                onChange={set("creditAmount")}
                error={fieldErrors.creditAmount}
                help="The loan principal, before interest."
              />
              <NumberField
                label="Price of the item being bought (optional)"
                prefix="$"
                min={0}
                value={form.goodsPrice}
                onChange={set("goodsPrice")}
                error={fieldErrors.goodsPrice}
                help="For a purchase loan, like a car or an appliance. Leave at 0 for a cash loan with nothing attached to it."
              />
            </div>
          </div>
        ) : null}

        {tab === 1 ? (
          <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-3">
            <NumberField label="Age" min={18} value={form.ageYears} onChange={set("ageYears")} error={fieldErrors.ageYears} />
            <SelectField label="Gender" value={form.gender} onChange={set("gender")} options={["F", "M"]} />
            <NumberField label="Children" min={0} value={form.children} onChange={set("children")} error={fieldErrors.children} />
            <NumberField
              label="People in household"
              min={1}
              value={form.familyMembers}
              onChange={set("familyMembers")}
              error={fieldErrors.familyMembers}
              help="Everyone living in the home, including you and any children."
            />
            <SelectField
              label="Family status"
              value={form.familyStatus}
              onChange={set("familyStatus")}
              options={FAMILY_STATUS_OPTIONS}
              help="'Civil marriage' means living with a partner without being legally married."
            />
            <SelectField
              label="Education"
              value={form.education}
              onChange={set("education")}
              options={EDUCATION_OPTIONS}
              help="'Secondary / secondary special' = finished high school or vocational training. 'Incomplete higher' = started university but did not finish."
            />
          </div>
        ) : null}

        {tab === 2 ? (
          <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              label="Income source"
              value={form.incomeType}
              onChange={set("incomeType")}
              options={INCOME_TYPE_OPTIONS}
              help="'Commercial associate' = employed in the private sector. 'State servant' = government employee."
            />
            <NumberField
              label="Years at your current job"
              min={0}
              value={form.yearsEmployed}
              onChange={set("yearsEmployed")}
              disabled={employedUnknown}
              error={employedUnknown ? undefined : fieldErrors.yearsEmployed}
              help="Disabled automatically for unemployed, retired, or student applicants."
            />
            <SelectField
              label="Occupation (optional)"
              value={form.occupation}
              onChange={set("occupation")}
              options={OCCUPATION_OPTIONS}
              placeholder="(not specified)"
            />
            <SelectField
              label="Type of employer"
              value={form.organizationType}
              onChange={set("organizationType")}
              options={ORGANIZATION_OPTIONS}
              placeholder="(prefer not to say)"
              help="The kind of organisation you work for. The model handles it being unknown."
            />
          </div>
        ) : null}

        {tab === 3 ? (
          <div className="stagger">
            <p className="mb-4 text-[0.82rem] leading-relaxed text-ink-muted">
              In a production system these would come from a live credit bureau pull rather
              than self-reporting. These are optional. Tick the box for any you want to
              include; otherwise the model falls back to typical values learned from the
              training population.
            </p>
            <Checkbox label="I know my credit bureau scores" checked={form.useExtScores} onChange={set("useExtScores")} />
            {form.useExtScores ? (
              <div className="animate-fade-in">
                <p className="mb-3 mt-2 text-[0.78rem] leading-relaxed text-ink-muted">
                  Three creditworthiness scores from outside credit bureaus, shown on the
                  {" "}{SCORE_MIN} to {SCORE_MAX} scale you'd see on your own report.{" "}
                  <b>Higher is safer:</b> applicants in the top quarter default about 3.5%
                  of the time, against roughly 14% in the bottom quarter.
                </p>
                <div className="space-y-4">
                  {["extScore1", "extScore2", "extScore3"].map((key, i) => (
                    <SliderField
                      key={key}
                      label={`Bureau score ${i + 1}`}
                      min={SCORE_MIN}
                      max={SCORE_MAX}
                      step={1}
                      value={extToScore(form[key])}
                      onChange={(v) => set(key)(scoreToExt(v))}
                      format={(v) => String(Math.round(v))}
                    />
                  ))}
                </div>
              </div>
            ) : null}
            <div className={form.useExtScores ? "mt-5" : "mt-3"}>
              <Checkbox label="I have a credit card" checked={form.useCc} onChange={set("useCc")} />
            </div>
            {form.useCc ? (
              <div className="mt-3 animate-fade-in">
                <SliderField
                  label="How much of your credit limit you use"
                  min={0}
                  max={2}
                  step={0.01}
                  value={form.ccUtilization}
                  onChange={set("ccUtilization")}
                  format={(v) => `${Math.round(v * 100)}%`}
                  help="Balance divided by limit. Above 100% means over the limit, which does happen in the data."
                />
              </div>
            ) : null}
          </div>
        ) : null}

        </StepPanel>

        {invalidFields.length ? (
          <div role="alert" className="mt-5 animate-fade-in rounded-lg border px-3.5 py-2.5 text-[0.8rem] leading-relaxed text-ink-secondary" style={{ borderColor: "var(--critical)" }}>
            <span className="font-semibold text-[var(--critical)]">
              {invalidFields.length === 1 ? "One field needs a look: " : `${invalidFields.length} fields need a look: `}
            </span>
            {invalidFields.map((k, i) => (
              <span key={k}>
                {i > 0 ? ", " : ""}
                <button
                  type="button"
                  onClick={() => setTab(FIELD_TAB[k])}
                  className="focus-ring font-medium text-ink-primary underline decoration-border underline-offset-4 hover:decoration-current"
                >
                  {FIELD_LABEL[k]}
                </button>
              </span>
            ))}
            .
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-5">
          <div className="flex items-center gap-1.5" aria-hidden>
            {TABS.map((t, i) => (
              <button
                key={t.label}
                type="button"
                tabIndex={-1}
                onClick={() => setTab(i)}
                title={t.label}
                className={`h-1.5 rounded-full transition-all duration-300 ${i === tab ? "w-5 bg-accent" : "w-1.5 bg-border hover:bg-ink-muted"}`}
              />
            ))}
          </div>
          <div className="flex-1" />
          {tab > 0 ? (
            <button
              type="button"
              onClick={() => setTab(tab - 1)}
              className="focus-ring animate-fade-in rounded-full px-3.5 py-2 text-[0.85rem] font-medium text-ink-secondary transition-colors hover:text-ink-primary"
            >
              ← Back
            </button>
          ) : null}
          {tab < TABS.length - 1 ? (
            <button
              type="button"
              onClick={() => setTab(tab + 1)}
              className="focus-ring animate-fade-in rounded-full border border-border px-4 py-2 text-[0.85rem] font-medium text-ink-secondary transition-all hover:border-accent hover:text-ink-primary active:scale-[0.98]"
            >
              Next →
            </button>
          ) : null}
          <button
            type="submit"
            disabled={loading}
            className="focus-ring flex items-center gap-2 rounded-full bg-accent px-6 py-2.5 text-[0.88rem] font-semibold text-[var(--card)] transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
          >
            {loading ? <Spinner /> : null}
            {loading ? "Scoring…" : "Check preapproval"}
          </button>
        </div>
      </form>

      {error ? (
        <div className="mt-6 animate-fade-up rounded-xl border bg-card p-4 text-[0.85rem] text-[var(--critical)]" style={{ borderColor: "var(--critical)" }}>
          {error}
        </div>
      ) : null}

      <div id="result-anchor" className="scroll-mt-24" />
      {result ? (
        <ResultView
          form={scoredForm || form}
          result={result}
          distribution={distribution}
          employedUnknown={isEmployedUnknown(scoredForm || form)}
          stale={scoredForm !== null && scoredForm !== form}
        />
      ) : null}
    </div>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 animate-spin" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function ResultView({ form, result, distribution, employedUnknown, stale }) {
  const { default_probability: prob, threshold, decision, top_factors, risk_percentile, n_contributing, model_used } = result;
  const isGood = decision === "preapproved";
  const color = isGood ? "var(--good)" : "var(--critical)";
  const employmentText = employedUnknown
    ? "Not currently employed"
    : `${Math.round(form.yearsEmployed)} yrs, ${(form.occupation || form.incomeType).toLowerCase()}`;

  return (
    <div className={`mt-8 transition-opacity duration-300 ${stale ? "opacity-70" : ""}`}>
      {stale ? (
        <div className="mb-4 flex animate-fade-in items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2.5 text-[0.8rem] text-ink-secondary">
          <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
          The form has changed since this was scored. The live estimate above is current;
          check again to refresh the breakdown.
        </div>
      ) : null}
      {/* snapshot */}
      <div className="mb-6 flex animate-fade-up flex-wrap overflow-hidden rounded-xl border border-border bg-card">
        {[
          ["Income", `$${form.income.toLocaleString()}/mo`],
          ["Loan requested", `$${form.creditAmount.toLocaleString()}`],
          ["Age", form.ageYears],
          ["Education", form.education.split(" / ")[0]],
          ["Employment", employmentText],
        ].map(([label, value], i) => (
          <div key={label} className={`flex-1 min-w-[130px] px-4 py-3 ${i !== 0 ? "border-l border-border" : ""}`}>
            <div className="mb-0.5 text-[0.68rem] uppercase tracking-wide text-ink-muted">{label}</div>
            <div className="text-[0.92rem] font-semibold text-ink-primary">{value}</div>
          </div>
        ))}
      </div>

      <RiskMeter prob={prob} threshold={threshold} decision={decision} percentile={risk_percentile} />

      {distribution ? (
        <section className="mt-9">
          <SectionTitle>Where this application falls</SectionTitle>
          <SectionSub>
            Every one of the {distribution.n.toLocaleString()} applicants in the held-out
            set, scored the same way. This one sits at the marked point, riskier than{" "}
            {risk_percentile}% of them.
          </SectionSub>
          <DistributionChart distribution={distribution} threshold={threshold} prob={prob} color={color} />
          <p className="mt-2 text-[0.78rem] text-ink-muted">
            Most applicants bunch up at the low end, well under the cutoff. That shape is
            why declining the riskiest 14% still only catches about half the missed
            payments. The last bar holds everyone above {(distribution.cap * 100).toFixed(0)}%
            ({distribution.tail_n.toLocaleString()} people).
          </p>
        </section>
      ) : null}

      <section className="mt-9">
        <SectionTitle>What drove this score</SectionTitle>
        <SectionSub>
          Each bar is how much one input moved the score, holding everything else fixed.
          These are the {top_factors.length} largest of {n_contributing || top_factors.length}{" "}
          inputs that moved this score. Effects are in <b>log-odds</b>, the scale the model
          works on, so they do not add up to the percentage above.
        </SectionSub>
        <FactorChart factors={top_factors} posColor="var(--pos)" negColor="var(--neg)" />
        <div className="mt-3 flex items-center gap-4 text-[0.8rem]">
          <span className="flex items-center gap-1.5 text-ink-secondary">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--pos)" }} /> increases risk
          </span>
          <span className="flex items-center gap-1.5 text-ink-secondary">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--neg)" }} /> decreases risk
          </span>
        </div>
        <p className="mt-2 text-[0.78rem] text-ink-muted">
          Bars are SHAP values in log-odds. Longer bar = that input mattered more for this
          particular applicant. They add up to the gap between this estimate and the
          model's average applicant.
        </p>

        <FactorTable factors={top_factors} />
      </section>

      <InlineLink to="/guide" state={{ prefill: questionAbout(result) }} className="mt-8">
        <b>Why this score?</b> Take this result to the research guide and ask what the
        study says about the factors behind it.
      </InlineLink>

      <p className="mt-6 text-[0.8rem] text-ink-muted">
        Model: {model_used} · illustrative only, not a real lending decision.
      </p>
    </div>
  );
}

// The question the "Why this score?" link drops into the guide's composer: the result
// plus its biggest factors, so the guide can point at what the research says about them.
function questionAbout(result) {
  const { default_probability: prob, decision, top_factors } = result;
  const top = [...top_factors]
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 3)
    .map((f) => `${f.feature} (${f.contribution > 0 ? "raised" : "lowered"} risk)`);
  return (
    `I ran an application through the preapproval tool and it was ${decision} with a ` +
    `${(prob * 100).toFixed(1)}% chance of an early missed payment. The biggest factors ` +
    `were: ${top.join("; ")}. What does the research say about why those matter?`
  );
}

function FactorTable({ factors }) {
  const [open, setOpen] = useState(false);
  const rows = [...factors].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  return (
    <div className="mt-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="focus-ring text-[0.8rem] font-medium text-ink-secondary underline decoration-border underline-offset-4 hover:text-ink-primary"
      >
        {open ? "Hide table" : "View as a table"}
      </button>
      {open ? (
        <div className="mt-3 animate-fade-in overflow-hidden rounded-lg border border-border">
          <table className="w-full text-left text-[0.8rem]">
            <thead>
              <tr className="bg-surface text-ink-muted">
                <th className="px-3 py-2 font-medium">Factor</th>
                <th className="px-3 py-2 font-medium">Direction</th>
                <th className="px-3 py-2 text-right font-medium">Effect (log-odds)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.feature} className="border-t border-border">
                  <td className="px-3 py-2 text-ink-primary">{f.feature}</td>
                  <td className="px-3 py-2 text-ink-secondary">
                    {f.contribution > 0 ? "increases risk" : "decreases risk"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-primary">
                    {f.contribution.toFixed(3)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
