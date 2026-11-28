import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import RateBarChart from "../components/RateBarChart.jsx";
import Waffle from "../components/Waffle.jsx";
import { loadFindings } from "../lib/api.js";
import { MODEL_AUC, MODEL_AUC_FORM, MODEL_AUC_FORM_BLANK } from "../lib/constants.js";
import { useInView, useCountUp } from "../lib/motion.js";

const pct = (rate, digits = 1) => `${(rate * 100).toFixed(digits)}%`;
const oneIn = (rate) => `1 in ${Math.round(1 / rate)}`;
const find = (rows, band) => rows.find((r) => r.band === band);

/** The headline multiple on a dark tile, counting up the first time it's seen. */
function CountUp({ value, caption }) {
  const [ref, inView] = useInView(0.6);
  const shown = useCountUp(value, inView, 1100);
  return (
    <div ref={ref} className="ink-card inline-flex flex-col px-5 py-4">
      <p className="t-num font-display text-[2.5rem] leading-none" aria-label={`${value.toFixed(1)} times`}>
        {shown.toFixed(1)}×
      </p>
      <p className="mt-1.5 text-[0.8125rem] text-ink-secondary">{caption}</p>
    </div>
  );
}

/** One finding: a tray with the claim and its evidence on it, and the chart on a card. */
function Finding({ id, title, children, chart }) {
  return (
    <section aria-labelledby={id} className="tray grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
      <div className="px-4 pb-3 pt-4 lg:pb-4 lg:pr-6">
        <h2 id={id} className="t-h2">
          {title}
        </h2>
        <div className="t-body mt-3 space-y-3">{children}</div>
      </div>
      <div className="raised flex min-w-0 flex-col justify-center p-5 sm:p-6">{chart}</div>
    </section>
  );
}

// The first models' best test AUC (02_research.ipynb, section 1)
const FIRST_MODEL_AUC = 0.780;

/** A titled tray with one raised card in it, the same shape the findings use. */
function Panel({ id, title, children, className = "" }) {
  return (
    <section aria-labelledby={id} className={`tray p-2 ${className}`}>
      <h2 id={id} className="t-h2 px-3 pb-3 pt-2">
        {title}
      </h2>
      <div className="raised t-body p-5 sm:p-6">{children}</div>
    </section>
  );
}

const AI_KINDS = [
  {
    kind: "Machine learning",
    where: "Preapproval tool",
    text: "The prediction comes from LightGBM, a model built from many small decision trees, each one correcting the ones before it. It learned its patterns from past applications instead of following rules someone wrote. Logistic regression, XGBoost, CatBoost and a neural network were tested against it.",
  },
  {
    kind: "Model Explainability",
    where: "Preapproval tool",
    text: "In statistical analysis, it is important to be able to explain how your models arrive at a decision. SHAP, a modern explainability algorithm, splits each prediction into the part each answer contributed, so the tool can show what raised or lowered a score instead of just giving a number.",
  },
  {
    kind: "Natural Language Processing",
    where: "Research guide",
    text: "The research guide writes its answers with a large language model, OpenAI's GPT-4.1 mini. It is told to take every fact about the project from the passages it is given, and to say so when they don't cover a question.",
  },
  {
    kind: "Retrieval-Augmented Generation (RAG)",
    where: "Research guide",
    text: "Before it answers, the guide turns the question into an embedding, a list of numbers that captures its meaning, and finds the closest passages in the project's notebooks, results and code. That keeps its answers tied to the actual work.",
  },
];

const SKILLS = [
  {
    skill: "Statistics and probability",
    text: "Only 8% of applicants missed a payment, so a model that said \"no\" to everyone would be 92% right and useless. The work leans on AUC instead, on standard errors to tell a real gain from noise (a score here is only good to about ±0.004), on cross-validation (training and scoring on five different splits of the data, so a result isn't luck), and on calibration, so a predicted 10% really means about 1 in 10.",
  },
  {
    skill: "Mathematics",
    text: "Logistic regression predicts the log-odds of a missed payment (the log of its chance against the chance it doesn't happen) as a weighted sum of the answers. Gradient boosting adds small decision trees one at a time, each fixing the errors of the ones before it. A monotone constraint, a rule on those trees, keeps a better credit score from ever raising the risk, and SHAP uses Shapley values from game theory to split a prediction fairly between its inputs.",
  },
  {
    skill: "Machine learning and data engineering",
    text: "Six tables of credit history, 2.5 GB in all, become 1,573 features (numbers a model can learn from), one row per applicant. Every change was tested on its own. The 20% of applicants held back to test the model are never used to build anything, not even the averages that compare an applicant with people like them, and the site works out its features with the same code the model was trained on.",
  },
  {
    skill: "Back-end development",
    text: "An API is the program behind the site that the tool sends each application to. This one, built with FastAPI, loads the model once, checks every application against the range the model was trained on, scores it, explains it, and streams the research guide's answers as they are written.",
  },
  {
    skill: "Front-end development",
    text: "A React site with hand-built charts, a form that rescores as you type, light and dark themes, a layout that works on a phone, and text contrast and labels that work with screen readers.",
  },
  {
    skill: "Software engineering",
    text: "Version control, one shared copy of the feature code so the site and the training can't drift apart, a stress test of the API, Docker so the whole site runs with one command, and automatic deployment to Render.",
  },
  {
    skill: "Generative AI",
    text: "Building the research guide meant splitting the project's write-up into passages, turning each into an embedding, finding the ones closest to a question (by cosine similarity, the angle between two embeddings), and writing instructions that keep the language model to those passages.",
  },
  {
    skill: "Lending, law and communication",
    text: "Knowing what lenders may use (no sex or marital status under the Equal Credit Opportunity Act), checking approval rates by group, and explaining all of it so someone without a technical background can follow.",
  },
];

/** What the project is, how it goes past a typical one, which parts are AI and the skills it took. Static, so
 * it shows while the findings data is still loading. */
function ProjectIntro() {
  return (
    <div>
      <h1 className="t-h1">Predicting early missed payments on consumer loans</h1>
      <p className="t-lead mt-3">
        An undergraduate honors research project. It takes 307,511 real loan applications, asks
        which applicants will miss one of their first payments, and turns the answer into a tool
        people can use: a preapproval tool!
      </p>

      <div className="mt-8 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel id="p-did" title="What it did">
          <ol className="list-decimal space-y-3 pl-5">
            <li>
              <span className="text-ink-primary">Explored the data.</span> 307,511 loan applications and
              six tables of credit history, to see who missed payments. The findings are further down
              this page.
            </li>
            <li>
              <span className="text-ink-primary">Built and tested models.</span> Five kinds of models were
              compared, then the best one was rebuilt one change at a time to find out what actually
              helped.
            </li>
            <li>
              <span className="text-ink-primary">Measured how well they work.</span> The measure is AUC:
              the chance the model rates someone who missed a payment as riskier than someone who
              didn't. A coin flip scores 0.5 and a perfect model 1.0. The best model went from{" "}
              {FIRST_MODEL_AUC.toFixed(3)} to {MODEL_AUC.toFixed(3)}, just short of the 0.80 goal.
            </li>
            <li>
              <span className="text-ink-primary">Made a version for a real form.</span> A preapproval form
              can't see someone's credit history, and lenders can't use sex or marital status. So a
              second model was trained on the form's questions alone. Its AUC is{" "}
              {MODEL_AUC_FORM.toFixed(3)}, or {MODEL_AUC_FORM_BLANK.toFixed(3)} when the applicant
              doesn't know their credit scores.
            </li>
            <li>
              <span className="text-ink-primary">Put it online.</span> That model runs the preapproval
              tool on this site, next to a research guide you can ask about the work.
            </li>
          </ol>
        </Panel>

        <Panel id="p-beyond" title="Past the usual project">
          <p>Most data science projects stop at a model and a score in a notebook. This one also:</p>
          <ul className="mt-3 list-disc space-y-3 pl-5">
            <li>Runs live, connecting math and statistics to software engineering. The preapproval tool scores an application as you type and shows what pushed it up or down.</li>
            <li>
              Is honest about what the site can see. The best research model needs a full credit
              history, which a form can't supply, so the site uses a model built for the form.
            </li>
            <li>
              Follows lending law. US lenders can't use sex or marital status, so the site's model
              never sees them, and its approval rates by group are still checked.
            </li>
            <li>Explains itself, with a breakdown of every score and a guide that answers from the project's own notebooks.</li>
          </ul>
        </Panel>
      </div>

      <section aria-labelledby="p-ai" className="tray mt-3 p-2">
        <h2 id="p-ai" className="t-h2 px-3 pb-3 pt-2">
          The kinds of AI in it
        </h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {AI_KINDS.map((k) => (
            <div key={k.kind} className="raised p-5">
              <p className="t-small">{k.where}</p>
              <h3 className="t-h3 mt-1">{k.kind}</h3>
              <p className="t-body mt-2 text-[0.9375rem]">{k.text}</p>
            </div>
          ))}
        </div>
        <p className="t-small px-3 pb-2 pt-3">
          Not everything is powered by some kind of AI. Declining any payment over 40% of income, and flagging scores for
          unemployed applicants and students as unreliable, are hard-coded rules that work in parallel with the models.
        </p>
      </section>

      <section aria-labelledby="p-skills" className="tray mt-3 p-2">
        <h2 id="p-skills" className="t-h2 px-3 pb-3 pt-2">
          The skills it took
        </h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {SKILLS.map((k) => (
            <div key={k.skill} className="raised p-5">
              <h3 className="t-h3">{k.skill}</h3>
              <p className="t-body mt-2 text-[0.9375rem]">{k.text}</p>
            </div>
          ))}
        </div>
      </section>

      <AboutData />
    </div>
  );
}

function AboutData() {
  return (
    <section aria-labelledby="f-data" className="tray mt-3 grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
      <h2 id="f-data" className="t-h2 px-4 pb-3 pt-4">
        About the data
      </h2>
      <div className="raised t-body space-y-4 p-5 sm:p-6">
        <p className="max-w-[62ch]">
          Home Credit's public Default Risk dataset on Kaggle. Home Credit lends to consumers in
          Central and Eastern Europe and Asia. Each row is one application, plus the applicant's
          credit history at the time.
        </p>
        <dl className="grid max-w-[62ch] grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[0.9375rem]">
          <dt className="text-ink-muted">Applications</dt>
          <dd className="text-ink-primary">307,511, one row each</dd>
          <dt className="text-ink-muted">History tables</dt>
          <dd className="text-ink-primary">6, covering bureau records, past loans and repayments</dd>
          <dt className="text-ink-muted">Size</dt>
          <dd className="text-ink-primary">2.5 GB of CSV across 10 files</dd>
          <dt className="text-ink-muted">Currency</dt>
          <dd className="text-ink-primary">Hidden, so the tool converts dollars at a fixed rate</dd>
          <dt className="text-ink-muted">Missed payment</dt>
          <dd className="text-ink-primary">One of the first few payments, more than a few days late</dd>
        </dl>
      </div>
    </section>
  );
}

function Loading() {
  return (
    <div className="mt-12 space-y-3" aria-busy="true" aria-label="Loading the findings">
      {[80, 64, 72, 48].map((w) => (
        <div key={w} className="skeleton h-4 animate-shimmer rounded" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

export default function FindingsPage() {
  const [S, setS] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadFindings().then(setS).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <ProjectIntro />

      <div className="mt-16 grid grid-cols-1 items-center gap-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-10">
        <div>
          <h2 className="t-h1">Data analysis findings</h2>
          <p className="t-lead mt-3">
            307,511 loan applications to Home Credit, mostly for phones, electronics and small
            cash loans. 8.1% of applicants missed one of their first payments. What set them
            apart?
          </p>
          <p className="t-small mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[var(--cat-2)]" /> above the 8.1% average
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[var(--cat-1)]" /> at or below it
            </span>
          </p>
        </div>
        {S ? (
          <div className="tray sm:w-fit">
            <div className="raised px-5 py-5">
              <Waffle count={Math.round(S.miss_rate * 100)} label={`${Math.round(S.miss_rate * 100)} in 100 applicants missed an early payment`} />
            </div>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="mt-10 text-critical-text">
          {error} Run section 5 of <code>modeling/01_eda.ipynb</code> to regenerate{" "}
          <code>frontend/public/data/site_findings.json</code>.
        </p>
      ) : null}

      {!S && !error ? <Loading /> : null}

      {S ? <Findings S={S} /> : null}
    </div>
  );
}

function Findings({ S }) {
  const avg = S.miss_rate;
  const lo = S.by_ext_score[0].rate;
  const hi = S.by_ext_score[S.by_ext_score.length - 1].rate;
  // age and time in the job share one scale so their bars compare directly
  const sharedMax = Math.max(...S.by_age.map((r) => r.rate), ...S.by_employment.map((r) => r.rate)) * 100 * 1.12;
  const cash = find(S.by_contract, "Cash loans");
  const revolving = find(S.by_contract, "Revolving loans");
  const contractTotal = cash.n + revolving.n;
  const dsrTop = S.by_dsr.reduce((a, r) => (r.rate > a.rate ? r : a));
  const dsrLow = S.by_dsr[0];
  const dsrOver = S.by_dsr[S.by_dsr.length - 1];

  return (
    <div className="mt-10 space-y-3">
      <Finding
        id="f-bureau"
        title="Credit scores matter most"
        chart={<RateBarChart rows={S.by_ext_score} average={avg} labelWidth="5.5rem" />}
      >
        <CountUp value={lo / hi} caption="riskier in the lowest fifth than the highest" />
        <p>
          Each applicant has up to three credit scores from outside sources. In the lowest fifth,{" "}
          {oneIn(lo)} missed a payment. In the highest, {oneIn(hi)}.
        </p>
        <p className="t-small">Fifths by average score. Only {pct(S.ext_missing_rate, 2)} of applicants had none.</p>
      </Finding>

      <Finding
        id="f-age"
        title="Older, longer-employed applicants were safer"
        chart={
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
            <div>
              <h3 className="t-h3 text-[0.9375rem]">Age</h3>
              <RateBarChart rows={S.by_age} average={avg} max={sharedMax} labelWidth="4.25rem" />
            </div>
            <div>
              <h3 className="t-h3 text-[0.9375rem]">Years in the current job</h3>
              <RateBarChart rows={S.by_employment} average={avg} max={sharedMax} labelWidth="4.25rem" />
            </div>
          </div>
        }
      >
        <p>
          Under-25s missed payments {pct(find(S.by_age, "under 25").rate)} of the time, over-60s{" "}
          {pct(find(S.by_age, "60+").rate)}. People under three years into a job were the riskiest,
          and those past eleven years the safest.
        </p>
        <p className="t-small">Same scale on both. Pensioners aren't in the job chart.</p>
      </Finding>

      <Finding
        id="f-education"
        title="Education matters, but less"
        chart={<RateBarChart rows={S.by_education} average={avg} labelWidth="8.5rem" />}
      >
        <p>
          {pct(find(S.by_education, "Higher education").rate)} of university graduates missed a payment,
          against {pct(find(S.by_education, "Lower secondary").rate)} of those who left school earliest.
          A real gap, but about a third of the credit-score one.
        </p>
        <p className="t-small">Groups under 500 people are left out.</p>
      </Finding>

      <Finding
        id="f-dsr"
        title="Bigger payments, barely riskier"
        chart={<RateBarChart rows={S.by_dsr} average={avg} labelWidth="5.5rem" />}
      >
        <p>
          As the payment takes more of someone's income, the rate only moves from {pct(dsrLow.rate)}{" "}
          to {pct(dsrTop.rate)}, and drops back to {pct(dsrOver.rate)} past 30%. The data only has
          approved loans, so most people who couldn't afford one never made it in.
        </p>
        <p className="t-small">So the tool declines any payment over 40% of income as a rule.</p>
      </Finding>

      <Finding
        id="f-contract"
        title="Credit lines were safer than cash loans"
        chart={<RateBarChart rows={S.by_contract} average={avg} labelWidth="8.5rem" />}
      >
        <p>
          {pct(cash.n / contractTotal, 0)} were cash loans paid back in fixed installments. The other{" "}
          {pct(revolving.n / contractTotal, 0)} were revolving credit lines, which work like a credit card, and those borrowers missed
          fewer payments.
        </p>
      </Finding>

      <Finding
        id="f-goods"
        title="Mostly phones and electronics"
        chart={<RateBarChart rows={S.goods} pctKey="pct" unit="of earlier loans" labelWidth="11rem" />}
      >
        <p>
          Phones alone were {Math.round(find(S.goods, "Mobile").pct)}% of financed purchases. The typical
          loan ran {Math.round(S.term.median)} months. These are everyday consumer loans, not mortgages.
        </p>
        <p className="t-small">From earlier loans that recorded what was bought.</p>
      </Finding>

      <p className="pt-3">
        <Link to="/preapproval" className="btn btn-primary">
          Try the preapproval tool
        </Link>
      </p>
    </div>
  );
}
