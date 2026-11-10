import useTween from "../lib/useTween.js";
import { RISK_MEDIAN, RISK_SCALE_MAX } from "../lib/constants.js";

const pctOf = (v) => Math.min(100, Math.max(0, (v / RISK_SCALE_MAX) * 100));

/**
 * The live result beside the form: re-scored as the form changes, so every edit visibly
 * moves the number and the reasons. It is the page's one filled surface on purpose.
 *
 * `result` is the latest /api/predict response (kept while a new one loads, so the panel
 * never blanks out mid-edit); `state` is "ready" | "loading" | "invalid" | "offline".
 * `invalidLabel` names the first field that needs fixing, so the panel can say which.
 */
export default function EstimatePanel({ result, state, invalidLabel, compact = false, idPrefix = "estimate" }) {
  const prob = useTween(result?.default_probability ?? null, 600, 0);
  const has = Boolean(result);
  const good = result?.decision === "preapproved";
  const fill = good ? "var(--good)" : "var(--critical)";
  const threshold = result?.threshold ?? 0;
  const dimmed = state === "invalid" || state === "offline";

  return (
    <section
      aria-labelledby={`${idPrefix}-heading`}
      className="rounded-[10px] border border-[var(--rule)] bg-card p-5 sm:p-6"
    >
      <h2 id={`${idPrefix}-heading`} className="sr-only">
        Estimate
      </h2>

      {/* The number leads; the decision follows as a plain sentence. Colour lives only in
          the meter, so the panel doesn't need a badge to say which way it went. */}
      <p className={`transition-opacity duration-300 ${dimmed ? "opacity-45" : ""}`}>
        {has ? (
          <span className="t-num block text-[3rem] leading-none text-ink-primary">{((prob ?? 0) * 100).toFixed(1)}%</span>
        ) : (
          <span className="skeleton block h-12 w-36 animate-shimmer rounded" />
        )}
        <span className="mt-2 block text-[0.9375rem] text-ink-secondary">chance of an early missed payment</span>
      </p>

      {/* meter: the cutoff and the typical applicant marked under it */}
      <div className={`mt-5 transition-opacity duration-300 ${dimmed ? "opacity-45" : ""}`} aria-hidden>
        <div className="relative h-2 rounded-full bg-[var(--gridline)]">
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-700 ease-out"
            style={{ width: `${pctOf(prob ?? 0)}%`, background: has ? fill : "var(--ink-muted)" }}
          />
          {threshold ? (
            <div className="absolute -top-1 h-4 w-[2px] bg-ink-primary" style={{ left: `${pctOf(threshold)}%` }} />
          ) : null}
        </div>
        <div className="relative mt-1.5 h-5 text-[0.75rem] text-ink-muted">
          <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${pctOf(RISK_MEDIAN)}%` }}>
            typical
          </span>
          {threshold ? (
            <span className="absolute -translate-x-1/2 whitespace-nowrap font-[620] text-ink-primary" style={{ left: `${pctOf(threshold)}%` }}>
              cutoff {(threshold * 100).toFixed(1)}%
            </span>
          ) : null}
        </div>
      </div>

      <p
        key={`${dimmed ? state : "ok"}-${result?.decision}-${Boolean(result?.policy_reason)}`}
        className="mt-4 animate-fade-in text-[0.9375rem] leading-relaxed text-ink-secondary"
        aria-live="polite"
      >
        {state === "offline" ? (
          "The model isn't responding. This is the last estimate."
        ) : state === "invalid" ? (
          <>
            Fix <b className="font-[620] text-ink-primary">{invalidLabel}</b> to update the estimate.
          </>
        ) : !has ? (
          "Scoring…"
        ) : result.policy_reason ? (
          <>
            <b className="font-[650] text-ink-primary">Declined on affordability.</b> {result.policy_reason}
          </>
        ) : (
          <>
            <b className="font-[650] text-ink-primary">{good ? "Preapproved" : "Declined"}</b>, since it's{" "}
            {good ? "under" : "over"} the {(threshold * 100).toFixed(1)}% cutoff. {result.risk_percentile}% of real
            applicants scored lower.
          </>
        )}
      </p>

      {has && !compact ? <TopReasons factors={result.top_factors} /> : null}

      {has && result.notes?.length ? (
        <ul className="mt-5 space-y-2 border-t border-[var(--rule)] pt-4">
          {result.notes.map((note) => (
            <li key={note} className="text-[0.8125rem] leading-snug text-ink-muted">
              {note}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** The three biggest reasons, with a small bar so their sizes compare at a glance. */
function TopReasons({ factors }) {
  const top = factors.slice(0, 3);
  const max = Math.max(...top.map((f) => Math.abs(f.contribution)), 0.001);
  return (
    <div className="mt-5 border-t border-[var(--rule)] pt-4">
      <h3 className="t-h3 text-[0.9375rem]">What moved it most</h3>
      <ul className="mt-3 space-y-3">
        {top.map((f) => {
          const up = f.contribution > 0;
          return (
            <li key={f.feature} className="animate-fade-in">
              <div className="flex items-baseline justify-between gap-3 text-[0.875rem]">
                <span className="text-ink-primary">{f.feature}</span>
                <span className="shrink-0 font-[620]" style={{ color: up ? "var(--critical-text)" : "var(--good-text)" }}>
                  {up ? "raises" : "lowers"}
                </span>
              </div>
              <div className="mt-1 h-1 rounded-full bg-[var(--gridline)]" aria-hidden>
                <div
                  className="h-full rounded-full transition-[width,background-color] duration-700 ease-out"
                  style={{ width: `${(Math.abs(f.contribution) / max) * 100}%`, background: up ? "var(--pos)" : "var(--neg)" }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <a href="#breakdown" className="link mt-4 inline-block text-[0.875rem]">
        See the full breakdown
      </a>
    </div>
  );
}
