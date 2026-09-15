import { useEffect, useState } from "react";
import { Kicker, PageTitle, PageSubtitle, FactsRow, SectionTitle, SectionSub } from "../components/PageHeader.jsx";
import RateBarChart from "../components/RateBarChart.jsx";
import Waffle from "../components/Waffle.jsx";
import InlineLink from "../components/InlineLink.jsx";
import { useTooltip, TipTitle, TipRow } from "../components/Tooltip.jsx";
import useInView from "../lib/useInView.js";
import { loadFindings } from "../lib/api.js";
import {
  ShieldIcon, WalletIcon, HourglassIcon, BriefcaseIcon, CapIcon, BagIcon, DocIcon, DatabaseIcon, GOODS_ICONS,
} from "../components/icons.jsx";

function ChartSkeleton({ rows = 5 }) {
  return (
    <div className="flex flex-col gap-2.5" style={{ height: rows * 34 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-[15px] w-full animate-shimmer rounded-[4px]" />
      ))}
    </div>
  );
}

const oneIn = (rate) => `1 in ${Math.round(1 / rate)}`;

/** The big-number card beside the bureau-score chart. */
function BureauCallout({ lo, hi }) {
  const [ref, visible] = useInView();
  return (
    <div
      ref={ref}
      className="flex flex-col justify-center rounded-xl border border-border bg-card px-5 py-5 shadow-card transition-all duration-700"
      style={{ opacity: visible ? 1 : 0, transform: visible ? "none" : "translateY(10px)" }}
    >
      <div className="text-[2.6rem] font-bold leading-none tracking-tight text-ink-primary tabular-nums">
        {(lo / hi).toFixed(1)}<span className="text-accent">×</span>
      </div>
      <div className="mt-2 text-[0.82rem] leading-snug text-ink-secondary">
        more likely to miss a payment in the lowest-scored fifth than the highest.
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4">
        <div>
          <div className="text-[1.15rem] font-bold text-[var(--critical)] tabular-nums">{oneIn(lo)}</div>
          <div className="text-[0.7rem] leading-snug text-ink-muted">of the lowest fifth missed a payment</div>
        </div>
        <div>
          <div className="text-[1.15rem] font-bold text-[var(--good)] tabular-nums">{oneIn(hi)}</div>
          <div className="text-[0.7rem] leading-snug text-ink-muted">of the highest fifth did</div>
        </div>
      </div>
    </div>
  );
}

/** Cash vs revolving: one proportional bar, each segment carrying its own miss rate. */
function ContractSplit({ rows, avg }) {
  const [ref, visible] = useInView();
  const tip = useTooltip();
  const total = rows.reduce((a, r) => a + r.n, 0);
  const colors = ["var(--cat-2)", "var(--cat-3)"];

  return (
    <div ref={ref}>
      <div className="flex h-[38px] w-full overflow-hidden rounded-lg">
        {rows.map((r, i) => (
          <div
            key={r.band}
            className="relative flex cursor-default items-center justify-center overflow-hidden transition-[width] duration-700 ease-out hover:brightness-110"
            style={{
              width: visible ? `${(r.n / total) * 100}%` : i === 0 ? "100%" : "0%",
              background: colors[i],
              transitionDelay: `${i * 80}ms`,
            }}
            onMouseEnter={(e) =>
              tip.show(
                e.currentTarget,
                <>
                  <TipTitle>{r.band}</TipTitle>
                  <TipRow>{r.n.toLocaleString()} applications · {((r.n / total) * 100).toFixed(1)}%</TipRow>
                  <TipRow>
                    {(r.rate * 100).toFixed(1)}% missed an early payment
                    <span className="text-ink-muted"> · {r.rate >= avg ? "+" : "−"}{Math.abs((r.rate - avg) * 100).toFixed(1)} pts vs average</span>
                  </TipRow>
                </>
              )
            }
            onMouseLeave={tip.hide}
          >
            <span className="truncate px-2 text-[0.78rem] font-semibold text-[var(--card)]">
              {((r.n / total) * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {rows.map((r, i) => (
          <div key={r.band} className="flex items-start gap-2.5">
            <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colors[i] }} />
            <div className="text-[0.82rem] leading-snug text-ink-secondary">
              <span className="font-semibold text-ink-primary">{r.band}</span> · {r.n.toLocaleString()} applications,{" "}
              <b className="text-ink-primary">{(r.rate * 100).toFixed(1)}%</b> missed a payment
            </div>
          </div>
        ))}
      </div>
      {tip.element}
    </div>
  );
}

function DatasetCard({ n }) {
  const tiles = [
    { value: n.toLocaleString(), label: "loan applications, one row each" },
    { value: "5", label: "credit-history tables: bureau records, prior applications, repayments" },
    { value: "2.5 GB", label: "of raw CSV across 10 files" },
    { value: "Anonymised", label: "currency, so the tool converts dollars at a fixed rate" },
  ];
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6">
      <SectionTitle icon={DatabaseIcon}>Where the numbers come from</SectionTitle>
      <p className="mt-2 max-w-2xl text-[0.89rem] leading-relaxed text-ink-secondary">
        Home Credit is a consumer-finance lender founded in 1997 and operating across Central
        and Eastern Europe and Asia. Its products are point-of-sale loans, cash loans and
        revolving credit, and no mortgages. The data is its public{" "}
        <b className="text-ink-primary">Home Credit Default Risk</b> dataset from Kaggle: one
        table of applications, plus what the lender knew about each applicant's history at
        the time.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-border bg-surface px-3.5 py-3">
            <div className="text-[1.2rem] font-bold tracking-tight text-ink-primary tabular-nums">{t.value}</div>
            <div className="mt-0.5 text-[0.72rem] leading-snug text-ink-muted">{t.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FindingsPage() {
  const [S, setS] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadFindings().then(setS).catch((e) => setError(e.message));
  }, []);

  const lo = S?.by_ext_score?.[0]?.rate;
  const hi = S?.by_ext_score?.[S.by_ext_score.length - 1]?.rate;
  const avgPct = S ? S.miss_rate * 100 : null;
  const reference = S ? { value: avgPct, label: `average ${avgPct.toFixed(1)}%` } : undefined;

  return (
    <div>
      <Kicker>Home Credit · honors research project</Kicker>
      <div className="grid grid-cols-1 items-start gap-8 sm:grid-cols-[1fr_auto]">
        <div>
          <PageTitle>What the data says</PageTitle>
          <PageSubtitle>
            Before building anything, it's worth knowing what separates the people who keep
            up with payments from the people who don't. These are everyday consumer loans,
            the kind you take out for a phone, a laptop or furniture, or as a small cash
            loan. Here's what 307,511 of them look like.
          </PageSubtitle>
        </div>
        {S ? (
          <div className="animate-fade-up sm:pt-3 [animation-delay:200ms]">
            <Waffle
              count={Math.round(S.miss_rate * 100)}
              label={`${Math.round(S.miss_rate * 100)} in every 100 missed an early payment`}
              caption={`${(S.miss_rate * 100).toFixed(2)}% of ${S.n.toLocaleString()} applicants`}
            />
          </div>
        ) : null}
      </div>

      {S ? (
        <FactsRow
          facts={[
            { value: { to: S.n, format: (v) => Math.round(v).toLocaleString() }, label: "loan applications" },
            { value: { to: S.miss_rate * 100, format: (v) => `${v.toFixed(1)}%` }, label: "missed an early payment" },
            { value: { to: S.term.median, format: (v) => `${Math.round(v)} months` }, label: "typical time to pay one back" },
          ]}
        />
      ) : (
        <div className="mt-7 flex gap-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-[74px] flex-1 animate-shimmer rounded-xl border border-border" />
          ))}
        </div>
      )}

      <InlineLink to="/preapproval">
        <b>Try the preapproval tool.</b> Score an application and see where it lands.
      </InlineLink>

      {error ? (
        <p className="mt-8 rounded-xl border bg-card p-4 text-[0.85rem] text-[var(--critical)]" style={{ borderColor: "var(--critical)" }}>
          {error} Run <code>python Modeling/utilities/site_findings.py</code> in the
          original project to regenerate it, then copy it into
          <code> web-app/frontend/public/data/site_findings.json</code>.
        </p>
      ) : null}

      <div className="my-8 h-px bg-border" />

      {/* 1. bureau scores */}
      <section className="mb-10">
        <SectionTitle icon={ShieldIcon}>Credit bureau scores separate people more than anything else</SectionTitle>
        <SectionSub>
          Each applicant carries up to three creditworthiness scores from outside bureaus.
          Sorting everyone by their average and splitting into fifths, the riskiest fifth
          misses a payment{" "}
          {S ? <b className="text-ink-primary">{(lo / hi).toFixed(1)} times</b> : "…"} as
          often as the safest. Nothing else in the data comes close.
        </SectionSub>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-[1fr_200px]">
          {S ? <RateBarChart rows={S.by_ext_score} color="var(--cat-1)" reference={reference} /> : <ChartSkeleton rows={5} />}
          {S ? <BureauCallout lo={lo} hi={hi} /> : <div className="skeleton animate-shimmer rounded-xl border border-border" />}
        </div>
        {S ? (
          <p className="mt-2 text-[0.78rem] text-ink-muted">
            {(S.ext_missing_rate * 100).toFixed(0)}% of applicants have no bureau score at
            all, which is itself informative: the model treats missing as its own signal
            rather than filling it in. The dashed line on every chart is the overall rate.
          </p>
        ) : null}
      </section>

      {/* 2. affordability */}
      <section className="mb-10">
        <SectionTitle icon={WalletIcon}>How much of your income the payment eats</SectionTitle>
        <SectionSub>
          The monthly payment as a share of monthly income. This is the quantity a lender
          underwrites on, and it matters far more than income by itself: in the final
          model, changing stated income barely moves a prediction, while changing the
          payment moves it a lot.
        </SectionSub>
        {S ? <RateBarChart rows={S.by_dsr} color="var(--cat-2)" reference={reference} /> : <ChartSkeleton rows={6} />}
      </section>

      {/* 3. age + employment */}
      <section className="mb-10 grid grid-cols-1 gap-8 sm:grid-cols-2">
        <div>
          <SectionTitle icon={HourglassIcon}>Age</SectionTitle>
          <SectionSub>
            Younger applicants miss payments more often, and it falls steadily with age.
          </SectionSub>
          {S ? <RateBarChart rows={S.by_age} color="var(--cat-3)" reference={reference} /> : <ChartSkeleton rows={6} />}
        </div>
        <div>
          <SectionTitle icon={BriefcaseIcon}>Time in the job</SectionTitle>
          <SectionSub>
            Recent starters are the riskiest group. Pensioners are excluded here since they
            have no employment record.
          </SectionSub>
          {S ? <RateBarChart rows={S.by_employment} color="var(--cat-4)" reference={reference} /> : <ChartSkeleton rows={5} />}
        </div>
      </section>

      {/* 4. education */}
      <section className="mb-10">
        <SectionTitle icon={CapIcon}>Education</SectionTitle>
        <SectionSub>
          A clear gradient, though a smaller one than the bureau scores. Bands with fewer
          than 500 applicants are left out.
        </SectionSub>
        {S ? <RateBarChart rows={S.by_education} color="var(--cat-5)" reference={reference} /> : <ChartSkeleton rows={4} />}
      </section>

      {/* 5. contract type */}
      <section className="mb-10">
        <SectionTitle icon={DocIcon}>Two kinds of loan</SectionTitle>
        <SectionSub>
          Nearly everything here is a straightforward cash loan: a fixed amount paid back in
          instalments. The rest is revolving credit, a limit you can draw on and repay, and
          those borrowers miss payments noticeably less often.
        </SectionSub>
        {S ? <ContractSplit rows={S.by_contract} avg={S.miss_rate} /> : <ChartSkeleton rows={2} />}
      </section>

      {/* 6. goods */}
      <section className="mb-10">
        <SectionTitle icon={BagIcon}>What people actually borrowed for</SectionTitle>
        <SectionSub>
          From prior applications, where the financed item is recorded.{" "}
          {S ? (
            <>
              Half the median loan is repaid inside{" "}
              <b className="text-ink-primary">{S.term.median.toFixed(0)} months</b> and the
              longest runs {S.term.max.toFixed(0)}.
            </>
          ) : null}{" "}
          This is consumer credit, not mortgages.
        </SectionSub>
        {S ? (
          <RateBarChart rows={S.goods} color="var(--cat-1)" pctKey="pct" iconFor={(band) => GOODS_ICONS[band]} wide />
        ) : (
          <ChartSkeleton rows={8} />
        )}
      </section>

      {S ? <DatasetCard n={S.n} /> : null}

      <div className="my-8 h-px bg-border" />
      <p className="text-[0.8rem] leading-relaxed text-ink-muted">
        Rates are the share of applicants in each band who missed a payment more than a few
        days late on one of the first instalments, which is what the dataset records. The
        dataset's own currency is anonymised, so the preapproval page takes dollars and
        converts them at a fixed rate set so the typical applicant earns $4,300 a month.
        Income is monthly.
      </p>
    </div>
  );
}
