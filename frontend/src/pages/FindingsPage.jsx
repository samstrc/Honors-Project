import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import RateBarChart from "../components/RateBarChart.jsx";
import Waffle from "../components/Waffle.jsx";
import { loadFindings } from "../lib/api.js";
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
      <p className="t-num text-[2.5rem] leading-none" aria-label={`${value.toFixed(1)} times`}>
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
      <div className="grid grid-cols-1 items-center gap-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-10">
        <div>
          <h1 className="t-h1">What the data says</h1>
          <p className="t-lead mt-3">
            307,511 loan applications to Home Credit, mostly for phones, electronics and small
            cash loans. 8.1% of applicants missed one of their first payments. Here's what set them
            apart.
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
          <div className="tray w-fit">
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
          Each applicant has up to three scores from credit bureaus. In the lowest fifth,{" "}
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
          {pct(cash.n / contractTotal, 0)} were cash loans paid back in fixed instalments. The other{" "}
          {pct(revolving.n / contractTotal, 0)} were revolving credit lines, and those borrowers missed
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

      <section aria-labelledby="f-data" className="tray grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
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
            <dd className="text-ink-primary">{S.n.toLocaleString()}, one row each</dd>
            <dt className="text-ink-muted">History tables</dt>
            <dd className="text-ink-primary">5, covering bureau records, past loans and repayments</dd>
            <dt className="text-ink-muted">Size</dt>
            <dd className="text-ink-primary">2.5 GB of CSV across 10 files</dd>
            <dt className="text-ink-muted">Currency</dt>
            <dd className="text-ink-primary">Hidden, so the tool converts dollars at a fixed rate</dd>
            <dt className="text-ink-muted">Missed payment</dt>
            <dd className="text-ink-primary">One of the first few payments, more than a few days late</dd>
          </dl>
          <p className="pt-1">
            <Link to="/preapproval" className="btn btn-primary">
              Try the preapproval tool
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
