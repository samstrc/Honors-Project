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
              <Verdict good={false} label="Declined" />
              <br />
              On affordability: {result.policy_reason.charAt(0).toLowerCase() + result.policy_reason.slice(1)}
            </>
          ) : (
            <>
              <Verdict good={good} label={good ? "Preapproved!" : "Declined"} />
              <br />
              {good ? "Under" : "Over"} the {(threshold * 100).toFixed(1)}% cutoff. {result.risk_percentile - 1}% of real
              applicants scored lower.
            </>
          )}
        </p>
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

/** The decision as a short headline in its colour, above the sentence that explains it. */
function Verdict({ good, label }) {
  return (
    <span
      className="font-display mb-1 inline-block text-[1.375rem] font-[650] leading-tight tracking-[-0.02em] transition-colors duration-500"
      style={{ color: good ? "var(--good-text)" : "var(--critical-text)" }}
    >
      {label}
    </span>
  );
}

/**
 * A 270-degree dial from 0 to 30%, open at the bottom, drawn like an instrument: a faint
 * green-to-red track with a tick every 5%, the estimate's arc in sage or brick with a soft
 * glow and a bright bead at its tip, and a notch with a small label at the cutoff, so how
 * close it came reads at a glance. The scale is the same as the distribution chart's.
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
  const tone = good ? "var(--good)" : "var(--critical)";
  const [t1x, t1y] = at(threshold, R - 11);
  const [t2x, t2y] = at(threshold, R + 11);
  const [lx, ly] = at(threshold, R + 25);
  const [bx, by] = prob != null ? at(prob, R) : [0, 0];
  const ticks = [];
  for (let v = 0.05; v < RISK_SCALE_MAX; v += 0.05) ticks.push(v);

  return (
    <div className="relative mx-auto w-[232px]">
      {/* a soft pool of the decision's colour behind the dial */}
      <div
        aria-hidden
        className="absolute inset-6 rounded-full blur-2xl transition-colors duration-700"
        style={{ background: prob != null ? tone : "transparent", opacity: 0.22 }}
      />
      <svg viewBox="-12 -12 224 224" className="relative block h-auto w-full overflow-visible" aria-hidden>
        <defs>
          {/* left (low risk) to right (high); the counter-rotation undoes the ring's rotate(135) */}
          <linearGradient id="gauge-track" x1="0" y1="0" x2="1" y2="0" gradientTransform="rotate(-135 0.5 0.5)">
            <stop offset="0%" stopColor="var(--good)" stopOpacity="0.35" />
            <stop offset="50%" stopColor="#c9a24a" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--critical)" stopOpacity="0.4" />
          </linearGradient>
          <filter id="gauge-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle cx="100" cy="100" r={R} fill="none" stroke="rgba(255,250,240,0.07)" strokeWidth="14" strokeLinecap="round" strokeDasharray={`${C * SWEEP} ${C}`} transform="rotate(135 100 100)" />
        <circle cx="100" cy="100" r={R} fill="none" stroke="url(#gauge-track)" strokeWidth="14" strokeLinecap="round" strokeDasharray={`${C * SWEEP} ${C}`} transform="rotate(135 100 100)" />
        {ticks.map((v) => {
          const [x1, y1] = at(v, R - 13);
          const [x2, y2] = at(v, R - 17);
          return <line key={v} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ink-muted)" strokeOpacity="0.5" strokeWidth="1.2" strokeLinecap="round" />;
        })}

        {prob != null ? (
          <>
            <circle
              cx="100"
              cy="100"
              r={R}
              fill="none"
              stroke={tone}
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray={`${Math.max(0.001, C * SWEEP * frac(prob))} ${C}`}
              transform="rotate(135 100 100)"
              filter="url(#gauge-glow)"
              className="animate-fade-in"
              style={{ transition: "stroke 500ms ease" }}
            />
            <circle cx={bx} cy={by} r="4.5" fill="#fffaf2" className="animate-fade-in" style={{ filter: "drop-shadow(0 0 4px rgba(255,250,240,0.7))" }} />
          </>
        ) : null}

        {threshold ? (
          <>
            <line x1={t1x} y1={t1y} x2={t2x} y2={t2y} stroke="var(--ink-primary)" strokeWidth="2.5" strokeLinecap="round" />
            <text x={lx} y={ly} textAnchor={lx > 108 ? "start" : lx < 92 ? "end" : "middle"} dominantBaseline="middle" fontSize="10.5" fontWeight="600" fill="var(--ink-secondary)" letterSpacing="0.02em">
              cutoff {(threshold * 100).toFixed(1)}%
            </text>
          </>
        ) : null}
        <text x={at(0, R)[0]} y={at(0, R)[1] + 24} textAnchor="middle" fontSize="10.5" fill="var(--ink-muted)">0%</text>
        <text x={at(RISK_SCALE_MAX, R)[0]} y={at(RISK_SCALE_MAX, R)[1] + 24} textAnchor="middle" fontSize="10.5" fill="var(--ink-muted)">
          {Math.round(RISK_SCALE_MAX * 100)}%+
        </text>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {prob != null ? (
          <span className="t-num font-display animate-fade-up text-[2.9rem] leading-none tracking-[-0.03em] text-ink-primary">
            {(prob * 100).toFixed(1)}
            <span className="ml-0.5 text-[1.5rem] text-ink-secondary">%</span>
          </span>
        ) : (
          <span className="skeleton block h-11 w-28 animate-shimmer rounded-full opacity-30" />
        )}
        <span className="mt-2 max-w-[7.5rem] text-[0.75rem] leading-snug text-ink-muted">chance of an early missed payment</span>
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
