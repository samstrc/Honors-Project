import useTween from "../lib/useTween.js";
import { RISK_SCALE_MAX } from "../lib/constants.js";

/**
 * The live result beside the form: re-scored as the form changes, so every edit visibly
 * moves the number and the reasons. The dark tile is the one heavy surface on the page, on
 * purpose: it is the answer.
 *
 * `result` is the latest /api/predict response (kept while a new one loads, so the panel
 * never blanks out mid-edit); `state` is "ready" | "loading" | "invalid" | "offline".
 * `invalidLabel` names the first field that needs fixing, so the panel can say which.
 */
export default function EstimatePanel({ result, state, invalidLabel, compact = false, idPrefix = "estimate" }) {
  const prob = useTween(result?.default_probability ?? null, 800, 0);
  const has = Boolean(result);
  const good = result?.decision === "preapproved";
  const threshold = result?.threshold ?? 0;
  const dimmed = state === "invalid" || state === "offline";

  return (
    <section aria-labelledby={`${idPrefix}-heading`} className="tray">
      <h2 id={`${idPrefix}-heading`} className="sr-only">
        Estimate
      </h2>

      {/* The number leads, the decision sits opposite it, and a thin bar below shows where
          the estimate falls against the cutoff. */}
      <div className="ink-card px-6 pb-5 pt-5">
        <div className={`transition-opacity duration-300 ${dimmed ? "opacity-45" : ""}`}>
          <div className="flex items-end justify-between gap-4">
            <div>
              {has ? (
                <span className="t-num font-display block animate-fade-up text-[3rem] leading-none tracking-[-0.03em] text-ink-primary">
                  {((prob ?? 0) * 100).toFixed(1)}
                  <span className="ml-0.5 text-[1.5rem] text-ink-secondary">%</span>
                </span>
              ) : (
                <span className="skeleton block h-12 w-32 animate-shimmer rounded-full opacity-30" />
              )}
              <span className="mt-1.5 block text-[0.8125rem] leading-snug text-ink-muted">chance of an early missed payment</span>
            </div>
            {has && !dimmed ? (
              <div key={`${result.decision}-${Boolean(result.policy_reason)}`} className="animate-fade-in text-right">
                <Verdict good={good && !result.policy_reason} label={good && !result.policy_reason ? "Preapproved!" : "Declined"} />
                {!result.policy_reason ? (
                  <span className="mt-1 block text-[0.8125rem] text-ink-secondary">{result.risk_percentile - 1}% of real applicants scored lower</span>
                ) : null}
              </div>
            ) : null}
          </div>
          <Meter prob={has ? prob ?? 0 : null} threshold={threshold} good={good && !result?.policy_reason} />
        </div>

        {state === "offline" || state === "invalid" || !has || result.policy_reason ? (
          <p
            key={`${dimmed ? state : "ok"}-${Boolean(result?.policy_reason)}`}
            className="mt-4 animate-fade-in text-[0.875rem] leading-relaxed text-ink-secondary"
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
            ) : (
              <>On affordability: {result.policy_reason.charAt(0).toLowerCase() + result.policy_reason.slice(1)}</>
            )}
          </p>
        ) : (
          <p className="sr-only" aria-live="polite">
            {good ? "Preapproved" : "Declined"}: {(result.default_probability * 100).toFixed(1)}% chance of a missed payment,{" "}
            {good ? "under" : "over"} the {(threshold * 100).toFixed(1)}% cutoff.
          </p>
        )}
      </div>

      {has && (!compact || result.notes?.length) ? (
        <div className="raised mt-2 animate-fade-up p-5 [animation-delay:120ms]">
          {!compact ? <TopReasons factors={result.top_factors} /> : null}
          {result.notes?.length ? (
            <ul className={`space-y-2 ${compact ? "" : "mt-5 border-t border-[var(--border)] pt-4"}`}>
              {result.notes.map((note) => (
                <li key={note} className="text-[0.8125rem] leading-snug text-ink-muted">
                  {note}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** The decision in its color, opposite the number. */
function Verdict({ good, label }) {
  return (
    <span
      className="font-display block text-[1.3rem] font-[650] leading-none tracking-[-0.02em] transition-colors duration-500"
      style={{ color: good ? "var(--good-text)" : "var(--critical-text)" }}
    >
      {label}
    </span>
  );
}

/**
 * A thin bar from 0 to 30%: a faint green-to-red track, filled to the estimate in sage or
 * brick with a soft glow and a bright bead at its tip, and a notch at the cutoff with its
 * label above. The scale is the same as the distribution chart's further down.
 */
function Meter({ prob, threshold, good }) {
  const pct = (v) => `${Math.min(1, Math.max(0, v / RISK_SCALE_MAX)) * 100}%`;
  const tone = good ? "var(--good)" : "var(--critical)";
  return (
    <div className="mt-8" aria-hidden>
      <div
        className="relative h-1.5 rounded-full"
        style={{
          background:
            "linear-gradient(90deg, color-mix(in srgb, var(--good) 32%, transparent), color-mix(in srgb, #c9a24a 30%, transparent), color-mix(in srgb, var(--critical) 42%, transparent))",
        }}
      >
        {prob != null ? (
          <>
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-colors duration-500"
              style={{ width: pct(prob), background: tone, boxShadow: `0 0 10px color-mix(in srgb, ${tone} 75%, transparent)` }}
            />
            <div
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 animate-fade-in rounded-full bg-[#fffaf2]"
              style={{ left: pct(prob), boxShadow: "0 0 8px rgba(255, 250, 240, 0.8)" }}
            />
          </>
        ) : null}
        {threshold ? (
          <>
            <div className="absolute -inset-y-[5px] w-[2px] -translate-x-1/2 rounded-full bg-[var(--ink-primary)]" style={{ left: pct(threshold) }} />
            <span
              className="absolute bottom-full mb-2.5 -translate-x-1/2 whitespace-nowrap text-[0.6875rem] text-ink-secondary"
              style={{ left: pct(threshold) }}
            >
              cutoff {(threshold * 100).toFixed(1)}%
            </span>
          </>
        ) : null}
      </div>
      <div className="mt-2 flex justify-between text-[0.6875rem] text-ink-muted">
        <span>0%</span>
        <span>{Math.round(RISK_SCALE_MAX * 100)}%+</span>
      </div>
    </div>
  );
}

/** The three biggest reasons, with a small bar so their sizes compare at a glance. */
function TopReasons({ factors }) {
  const top = factors.slice(0, 3);
  const max = Math.max(...top.map((f) => Math.abs(f.contribution)), 0.001);
  return (
    <div>
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
              <div className="mt-1.5 h-1.5 rounded-full bg-[var(--gridline)]" aria-hidden>
                <div
                  className="h-full rounded-full transition-[width,background-color] duration-700 ease-out"
                  style={{ width: `${(Math.abs(f.contribution) / max) * 100}%`, background: up ? "var(--pos)" : "var(--neg)" }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <a href="#breakdown" className="chip mt-4">
        See the full breakdown
      </a>
    </div>
  );
}
