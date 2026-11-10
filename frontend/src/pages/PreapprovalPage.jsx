import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { NumberField, SelectField, SliderField, Checkbox } from "../components/Fields.jsx";
import EstimatePanel from "../components/EstimatePanel.jsx";
import DistributionChart from "../components/DistributionChart.jsx";
import FactorChart from "../components/FactorChart.jsx";
import { predict, loadRiskDistribution } from "../lib/api.js";
import { loadSession, saveSession } from "../lib/storage.js";
import { isEmployedUnknown, buildPayload, validate, FIELD_LABEL, usd } from "../lib/application.js";
import { useIndicator, EASE } from "../lib/motion.js";
import {
  MODEL_AUC,
  MODEL_AUC_FORM,
  MODEL_AUC_FORM_BLANK,
  FORM_N_FEATURES,
  FORM_MEAN_PREDICTED,
  BASE_RATE,
  DECLINE_RATE,
  CAUGHT_RATE,
  PRESETS,
  DEFAULT_FORM,
  EDUCATION_OPTIONS,
  INCOME_TYPE_OPTIONS,
  OCCUPATION_OPTIONS,
  ORGANIZATION_OPTIONS,
  SCORE_MIN,
  SCORE_MAX,
  extToScore,
  scoreToExt,
  LIMITS,
} from "../lib/constants.js";

// The examples, by the short name on their button and the one line said about them.
const PRESET_INFO = {
  "Strong applicant": { short: "Strong", blurb: "Well paid, small loan, 15 years in the job, good scores." },
  "Typical applicant": { short: "Typical", blurb: "The median borrower. No bureau scores." },
  "High-risk applicant": { short: "High-risk", blurb: "21, unemployed, borrowing a lot, card over its limit." },
};
const presetIsActive = (form, preset) => Object.keys(preset).every((k) => form[k] === preset[k]);

// Form order, so the panel can name the first field that needs fixing.
const FIELD_ORDER = ["income", "annuity", "creditAmount", "goodsPrice", "ageYears", "children", "familyMembers", "yearsEmployed"];

export default function PreapprovalPage() {
  // Opens on the typical applicant, so the example control shows where the numbers came from.
  const [form, setForm] = useState({ ...DEFAULT_FORM, ...PRESETS["Typical applicant"] });
  const [result, setResult] = useState(null);
  const [state, setState] = useState("loading");
  const [distribution, setDistribution] = useState(null);
  const [presetScores, setPresetScores] = useState({});
  const firstScore = useRef(true);

  const errors = validate(form);
  const employedUnknown = isEmployedUnknown(form);
  const firstInvalid = FIELD_ORDER.find((k) => errors[k] && !(k === "yearsEmployed" && employedUnknown));

  useEffect(() => {
    loadRiskDistribution().then(setDistribution).catch(() => {});
  }, []);

  // Score the form as it changes (debounced). The last good result stays on screen while
  // a new one loads, and while a field is out of range, so the panel never blanks out.
  useEffect(() => {
    if (Object.keys(validate(form)).length) {
      setState("invalid");
      return undefined;
    }
    const abort = new AbortController();
    setState("loading");
    const delay = firstScore.current ? 0 : 350;
    firstScore.current = false;
    const id = setTimeout(async () => {
      try {
        setResult(await predict(buildPayload(form), abort.signal));
        setState("ready");
      } catch (e) {
        if (e.name !== "AbortError") setState("offline");
      }
    }, delay);
    return () => {
      clearTimeout(id);
      abort.abort();
    };
  }, [form]);

  // Score the three examples for their buttons. One at a time, and only after the live
  // estimate has had a head start: on a small host the four requests would otherwise
  // fight over the CPU and the number people are watching would arrive last. Remembered
  // for the session so coming back to this page doesn't repeat the work.
  useEffect(() => {
    const cacheKey = "preset-scores";
    const cached = loadSession(cacheKey, null);
    if (cached && Object.keys(PRESETS).every((k) => cached[k])) {
      setPresetScores(cached);
      return undefined;
    }
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      const scores = {};
      for (const name of Object.keys(PRESETS)) {
        try {
          scores[name] = await predict(buildPayload({ ...DEFAULT_FORM, ...PRESETS[name] }), abort.signal);
        } catch (e) {
          if (e.name === "AbortError") return;
          scores[name] = null; // API offline: no score on the button, no endless placeholder
        }
        setPresetScores({ ...scores });
      }
      if (Object.values(scores).every(Boolean)) saveSession(cacheKey, scores);
    }, 900);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, []);

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const err = (key) => errors[key];
  const activePreset = Object.keys(PRESETS).find((name) => presetIsActive(form, PRESETS[name]));
  // the dark pill behind the chosen example glides between buttons
  const examplesRef = useRef(null);
  const pill = useIndicator(examplesRef, activePreset ?? "none");

  // Rendered twice, beside the form on wide screens and after it on a phone; only one
  // is ever displayed, but each needs its own heading id.
  const panel = (idPrefix) => (
    <EstimatePanel result={result} state={state} invalidLabel={firstInvalid ? FIELD_LABEL[firstInvalid] : ""} idPrefix={idPrefix} />
  );

  return (
    <div className="grid grid-cols-1 gap-x-16 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="min-w-0">
        <h1 className="t-h1">Check a preapproval</h1>
        <p className="t-lead mt-3">
          See how likely an applicant is to miss one of their first payments. The model learned
          from 307,511 real loans, and the estimate updates as you type.
        </p>

        {/* examples */}
        <div className="mt-8">
          <p id="examples-label" className="text-[0.875rem] font-[560] text-ink-primary">
            Start from an example
          </p>
          <div
            ref={examplesRef}
            role="group"
            aria-labelledby="examples-label"
            className="relative mt-2 grid w-full grid-cols-3 rounded-md border border-[var(--rule)] p-0.5 sm:inline-grid sm:w-auto"
          >
            <span
              aria-hidden
              className="absolute rounded-[4px] bg-ink-primary"
              style={{
                left: pill?.left ?? 0,
                top: pill?.top ?? 0,
                width: pill?.width ?? 0,
                height: pill?.height ?? 0,
                opacity: pill ? 1 : 0,
                transition: `left 420ms ${EASE}, width 420ms ${EASE}, opacity 250ms ease`,
              }}
            />
            {Object.keys(PRESETS).map((name) => {
              const active = activePreset === name;
              const score = presetScores[name];
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={active}
                  data-active={active}
                  onClick={() => setForm((f) => ({ ...f, ...PRESETS[name] }))}
                  className={`relative flex items-baseline justify-center gap-1.5 whitespace-nowrap rounded-[4px] px-2 py-1.5 text-[0.9375rem] transition-colors duration-300 sm:gap-2 sm:px-4 ${
                    active ? "text-surface" : "text-ink-secondary hover:text-ink-primary"
                  }`}
                >
                  <span>{PRESET_INFO[name].short}</span>
                  {score ? (
                    <span className={`t-num animate-fade-in text-[0.8125rem] transition-colors duration-300 ${active ? "opacity-80" : "text-ink-muted"}`}>
                      {(score.default_probability * 100).toFixed(1)}%
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <p key={activePreset ?? "own"} className="t-small mt-2 min-h-[1.25rem] animate-fade-in">
            {activePreset ? PRESET_INFO[activePreset].blurb : "Your own numbers."}
          </p>
        </div>

        <form noValidate onSubmit={(e) => e.preventDefault()} className="mt-4">
          <FormSection title="Income and loan" note="US dollars a month, before tax">
            <NumberField
              id="income"
              label="Monthly income"
              prefix="$"
              min={LIMITS.income.min}
              max={LIMITS.income.max}
              value={form.income}
              onChange={set("income")}
              error={err("income")}
              help="Before tax. Using take-home pay instead barely changes the estimate."
            />
            <NumberField
              id="annuity"
              label="Monthly payment"
              prefix="$"
              min={LIMITS.annuity.min}
              max={LIMITS.annuity.max}
              value={form.annuity}
              onChange={set("annuity")}
              error={err("annuity")}
              help="What the loan costs each month. With the amount, it sets the term, and 12 to 16 month loans were the riskiest."
            />
            <NumberField
              id="creditAmount"
              label="Amount to borrow"
              prefix="$"
              min={LIMITS.creditAmount.min}
              max={LIMITS.creditAmount.max}
              value={form.creditAmount}
              onChange={set("creditAmount")}
              error={err("creditAmount")}
              help="Before interest."
            />
            <NumberField
              id="goodsPrice"
              label="Price of the item (optional)"
              prefix="$"
              min={0}
              value={form.goodsPrice}
              onChange={set("goodsPrice")}
              error={err("goodsPrice")}
              help="If the loan pays for something, like a phone. Leave at 0 for a cash loan."
            />
            <details className="group sm:col-span-2">
              <summary className="t-small cursor-pointer list-none underline decoration-[var(--rule)] underline-offset-4 hover:text-ink-primary">
                Why dollars?
              </summary>
              <p className="t-small mt-2 max-w-[62ch]">
                The data's currency is hidden, so dollars are scaled to put the typical applicant at
                $4,300 a month. Inputs stay within what the model saw: about {usd(LIMITS.income.min)}{" "}
                to {usd(LIMITS.income.max)} of monthly income and loans up to{" "}
                {usd(LIMITS.creditAmount.max)}.
              </p>
            </details>
          </FormSection>

          <FormSection title="About you">
            <NumberField id="ageYears" label="Age" min={LIMITS.ageYears.min} max={LIMITS.ageYears.max} value={form.ageYears} onChange={set("ageYears")} error={err("ageYears")} />
            <NumberField id="children" label="Children" min={0} max={LIMITS.children.max} value={form.children} onChange={set("children")} error={err("children")} />
            <NumberField
              id="familyMembers"
              label="People in household"
              min={1}
              max={LIMITS.familyMembers.max}
              value={form.familyMembers}
              onChange={set("familyMembers")}
              error={err("familyMembers")}
              help="Everyone in the home, including you."
            />
            <SelectField
              id="education"
              label="Education"
              value={form.education}
              onChange={set("education")}
              options={EDUCATION_OPTIONS}
              help="'Secondary' means high school or trade school. 'Incomplete higher' means some university."
            />
          </FormSection>

          <FormSection title="Employment">
            <SelectField
              id="incomeType"
              label="Income source"
              value={form.incomeType}
              onChange={set("incomeType")}
              options={INCOME_TYPE_OPTIONS}
              help="'Commercial associate' means a private company; 'State servant' means government. The data had very few unemployed people, students or business owners, so estimates for them are rough."
            />
            <NumberField
              id="yearsEmployed"
              label="Years at current job"
              min={0}
              max={LIMITS.yearsEmployed.max}
              value={form.yearsEmployed}
              onChange={set("yearsEmployed")}
              disabled={employedUnknown}
              error={employedUnknown ? undefined : err("yearsEmployed")}
              help="Not needed if you're unemployed, retired or a student."
            />
            <SelectField id="occupation" label="Occupation (optional)" value={form.occupation} onChange={set("occupation")} options={OCCUPATION_OPTIONS} placeholder="Not specified" />
            <SelectField
              id="organizationType"
              label="Type of employer (optional)"
              value={form.organizationType}
              onChange={set("organizationType")}
              options={ORGANIZATION_OPTIONS}
              placeholder="Not specified"
            />
          </FormSection>

          <FormSection title="Credit bureau" note="Optional">
            <div className="sm:col-span-2">
              <p className="t-body max-w-[62ch] text-[0.9375rem]">
                A lender would pull these for you. Without them the model assumes typical scores,
                and the estimate gets much rougher.
              </p>
              <div className="mt-5">
                <Checkbox label="I know my credit bureau scores" checked={form.useExtScores} onChange={set("useExtScores")} />
              </div>
              <Reveal open={form.useExtScores}>
                <div className="grid grid-cols-1 gap-6 pb-1 pt-5 sm:grid-cols-3">
                  {["extScore1", "extScore2", "extScore3"].map((key, i) => (
                    <SliderField
                      key={key}
                      id={key}
                      label={`Bureau score ${i + 1}`}
                      min={SCORE_MIN}
                      max={SCORE_MAX}
                      step={1}
                      value={extToScore(form[key])}
                      onChange={(v) => set(key)(scoreToExt(v))}
                      format={(v) => String(Math.round(v))}
                    />
                  ))}
                  <p className="t-small sm:col-span-3">
                    On the usual {SCORE_MIN} to {SCORE_MAX} scale. Higher is safer: the top quarter missed
                    payments about 3.5% of the time, the bottom quarter about 14%.
                  </p>
                </div>
              </Reveal>
              <div className="mt-5">
                <Checkbox label="I have a credit card" checked={form.useCc} onChange={set("useCc")} />
              </div>
              <Reveal open={form.useCc}>
                <div className="max-w-sm pb-1 pt-5">
                  <SliderField
                    id="ccUtilization"
                    label="Card limit used"
                    min={0}
                    max={2}
                    step={0.01}
                    value={form.ccUtilization}
                    onChange={set("ccUtilization")}
                    format={(v) => `${Math.round(v * 100)}%`}
                    help="Balance divided by limit. Over 100% means over the limit. On its own it barely moves the estimate."
                  />
                </div>
              </Reveal>
            </div>
          </FormSection>
        </form>

        {/* on a phone the estimate sits here, after the form; a bar along the bottom keeps
            the number in view until it does */}
        <div id="estimate" className="mt-10 scroll-mt-6 lg:hidden">
          <MobileEstimate panel={panel("estimate-inline")} result={result} state={state} />
        </div>

        {result ? (
          <section id="breakdown" aria-labelledby="breakdown-heading" className="section-rule mt-14 scroll-mt-6 pt-8">
            <h2 id="breakdown-heading" className="t-h2">
              How it got there
            </h2>

            {distribution ? (
              <div className="mt-6">
                <h3 className="t-h3">Compared with {distribution.n.toLocaleString()} real applicants</h3>
                <p className="t-body mt-1 max-w-[62ch] text-[0.9375rem]">
                  Most people score low. The cutoff turns away {Math.round(DECLINE_RATE * 100)}% of
                  applicants and catches {Math.round(CAUGHT_RATE * 100)}% of the missed payments.
                </p>
                <div className="mt-4">
                  <DistributionChart
                    distribution={distribution}
                    threshold={result.threshold}
                    prob={result.default_probability}
                    color={result.decision === "preapproved" ? "var(--good)" : "var(--critical)"}
                    textColor={result.decision === "preapproved" ? "var(--good-text)" : "var(--critical-text)"}
                  />
                </div>
              </div>
            ) : null}

            <div className="mt-10">
              <h3 className="t-h3">What pushed it up or down</h3>
              <p className="t-body mt-1 max-w-[62ch] text-[0.9375rem]">
                The {result.top_factors.length} biggest of {result.n_contributing || result.top_factors.length}{" "}
                effects, as SHAP values on the model's log-odds scale.
              </p>
              <div className="mt-4">
                <FactorChart factors={result.top_factors} />
              </div>
              <p className="mt-4 text-[0.9375rem]">
                <Link to="/guide" state={{ prefill: questionAbout(result) }} className="link">
                  Ask the research guide about these
                </Link>
              </p>
            </div>
          </section>
        ) : null}

        <section aria-labelledby="model-heading" className="section-rule mt-14 pt-8">
          <h2 id="model-heading" className="t-h2">
            About the model
          </h2>
          <div className="t-body mt-3 max-w-[62ch] space-y-3">
            <p>
              A LightGBM model that uses only what this form asks ({FORM_N_FEATURES} features). It never
              sees sex or marital status, which US lenders can't use. Its average prediction,{" "}
              {(FORM_MEAN_PREDICTED * 100).toFixed(1)}%, matches the real rate of{" "}
              {(BASE_RATE * 100).toFixed(1)}%, so the percentages mean what they say.
            </p>
            <p>
              A missed payment here means one of the first few came in more than a few days late.
              Most of those borrowers still paid the loan off.
            </p>
          </div>
          <table className="mt-5 w-full max-w-[34rem] text-left text-[0.9375rem]">
            <caption className="t-small pb-2 text-left">
              How well each version tells risky applicants from safe ones (test AUC; 0.5 is a coin flip)
            </caption>
            <tbody className="border-t border-[var(--rule)]">
              {[
                ["Research model, with full credit history", MODEL_AUC],
                ["This tool, with bureau scores", MODEL_AUC_FORM],
                ["This tool, without bureau scores", MODEL_AUC_FORM_BLANK],
              ].map(([label, auc]) => (
                <tr key={label} className="border-b border-[var(--border)]">
                  <th scope="row" className="py-2 pr-4 font-normal text-ink-secondary">
                    {label}
                  </th>
                  <td className="t-num py-2 text-right text-ink-primary">{auc.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <aside className="hidden lg:block">
        <div className="sticky top-6 pt-1">{panel("estimate-side")}</div>
      </aside>
    </div>
  );
}

/** Opens and closes its content by animating the height, so the form below glides. */
function Reveal({ open, children }) {
  return (
    <div
      className="grid"
      style={{
        gridTemplateRows: open ? "1fr" : "0fr",
        opacity: open ? 1 : 0,
        transition: `grid-template-rows 450ms ${EASE}, opacity 300ms ease`,
      }}
      inert={open ? undefined : ""}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

function FormSection({ title, note, children }) {
  return (
    <fieldset className="section-rule mt-8 pt-6 first:mt-0">
      <legend className="contents">
        <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="t-h2">{title}</span>
          {note ? <span className="t-small">{note}</span> : null}
        </span>
      </legend>
      <div className="mt-5 grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

/** The in-flow panel on a phone, plus a slim bar that keeps the number visible until then. */
function MobileEstimate({ panel, result, state }) {
  // The bar shows only while the panel is still below the screen: once you reach it, or
  // scroll past it into the breakdown, the number is no longer out of sight.
  const ref = useRef(null);
  const [below, setBelow] = useState(true);
  useEffect(() => {
    const obs = new IntersectionObserver(([entry]) => {
      setBelow(!entry.isIntersecting && entry.boundingClientRect.top > 0);
    });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  const good = result?.decision === "preapproved";
  return (
    <>
      <div ref={ref}>{panel}</div>
      {result && below ? (
        <a
          href="#estimate"
          className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-[var(--rule)] bg-card px-5 py-3 lg:hidden"
        >
          <span className="flex items-baseline gap-2">
            <span className="t-num text-[1.25rem] text-ink-primary">{(result.default_probability * 100).toFixed(1)}%</span>
            <span className="text-[0.875rem] text-ink-secondary">chance of a missed payment</span>
          </span>
          <span className="text-[0.875rem] font-[650]" style={{ color: good ? "var(--good-text)" : "var(--critical-text)" }}>
            {state === "invalid" ? "Check form" : good ? "Preapproved" : "Declined"}
          </span>
        </a>
      ) : null}
    </>
  );
}

// The question the guide link drops into the guide's composer: the result plus its
// biggest factors (the backend sends them largest first).
function questionAbout(result) {
  const { default_probability: prob, decision, top_factors } = result;
  const top = top_factors.slice(0, 3).map((f) => `${f.feature} (${f.contribution > 0 ? "raised" : "lowered"} risk)`);
  return (
    `I ran an application through the preapproval tool and it was ${decision} with a ` +
    `${(prob * 100).toFixed(1)}% chance of an early missed payment. The biggest factors ` +
    `were: ${top.join("; ")}. What does the research say about why those matter?`
  );
}
