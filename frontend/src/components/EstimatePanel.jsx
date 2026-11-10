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
  const prob = useTween(result?.default_probability ?? null, 600, 0);
  const has = Boolean(result);
  const good = result?.decision === "preapproved";
  const threshold = result?.threshold ?? 0;
  const dimmed = state === "invalid" || state === "offline";

  return (
    <section aria-labelledby={`${idPrefix}-heading`} className="tray">
      <h2 id={`${idPrefix}-heading`} className="sr-only">
        Estimate
      </h2>

      {/* The number leads, inside the gauge; the decision follows as a plain sentence. */}
      <div className="ink-card px-5 pb-5 pt-4">
        <div className={`transition-opacity duration-300 ${dimmed ? "opacity-45" : ""}`}>
          <Gauge prob={has ? prob ?? 0 : null} threshold={threshold} good={good} />
        </div>

        <p
          key={`${dimmed ? state : "ok"}-${result?.decision}-${Boolean(result?.policy_reason)}`}
          className="-mt-3 animate-fade-in text-center text-[0.9375rem] leading-relaxed text-ink-secondary"
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
      </div>

      {has && (!compact || result.notes?.length) ? (
        <div className="raised mt-2 p-5">
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

/**
 * A 270-degree ring from 0 to 30%, open at the bottom. The arc fills to this estimate in
 * sage or brick, and a tick marks the cutoff, so how close it came reads at a glance.
 * The scale is the same as the distribution chart's.
 */
function Gauge({ prob, threshold, good }) {
  const R = 78;
  const C = 2 * Math.PI * R;
  const SWEEP = 0.75;
  const frac = (v) => Math.min(1, Math.max(0, v / RISK_SCALE_MAX));
  const at = (v, r) => {
    const a = ((135 + 270 * frac(v)) * Math.PI) / 180;
    return [100 + r * Math.cos(a), 100 + r * Math.sin(a)];
  };
  const [t1x, t1y] = at(threshold, R - 13);
  const [t2x, t2y] = at(threshold, R + 13);
  const [lx, ly] = at(threshold, R + 26);
  return (
    <div className="relative mx-auto w-[220px]">
      <svg viewBox="-10 -10 220 220" className="block h-auto w-full" aria-hidden>
        <circle cx="100" cy="100" r={R} fill="none" stroke="var(--gridline)" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${C * SWEEP} ${C}`} transform="rotate(135 100 100)" />
        {prob != null ? (
          <circle
            cx="100"
            cy="100"
            r={R}
            fill="none"
            stroke={good ? "var(--good)" : "var(--critical)"}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={`${Math.max(0.001, C * SWEEP * frac(prob))} ${C}`}
            transform="rotate(135 100 100)"
            style={{ transition: "stroke 500ms ease" }}
          />
        ) : null}
        {threshold ? (
          <>
            <line x1={t1x} y1={t1y} x2={t2x} y2={t2y} stroke="var(--ink-primary)" strokeWidth="2.5" strokeLinecap="round" />
            <text x={lx} y={ly} textAnchor={lx > 108 ? "start" : lx < 92 ? "end" : "middle"} dominantBaseline="middle" fontSize="11" fontWeight="620" fill="var(--ink-primary)">
              cutoff {(threshold * 100).toFixed(1)}%
            </text>
          </>
        ) : null}
        <text x={at(0, R)[0]} y={at(0, R)[1] + 22} textAnchor="middle" fontSize="11" fill="var(--ink-muted)">0%</text>
        <text x={at(RISK_SCALE_MAX, R)[0]} y={at(RISK_SCALE_MAX, R)[1] + 22} textAnchor="middle" fontSize="11" fill="var(--ink-muted)">
          {Math.round(RISK_SCALE_MAX * 100)}%+
        </text>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center px-10 text-center">
        {prob != null ? (
          <span className="t-num text-[2.75rem] leading-none text-ink-primary">{(prob * 100).toFixed(1)}%</span>
        ) : (
          <span className="skeleton block h-11 w-28 animate-shimmer rounded-full opacity-30" />
        )}
        <span className="mt-1.5 text-[0.8125rem] leading-tight text-ink-secondary">chance of an early missed payment</span>
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
