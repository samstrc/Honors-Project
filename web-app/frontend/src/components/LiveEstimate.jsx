import useTween from "../lib/useTween.js";
import { RISK_MEDIAN, RISK_SCALE_MAX } from "../lib/constants.js";

const pctOf = (v) => Math.min(100, Math.max(0, (v / RISK_SCALE_MAX) * 100));
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

/**
 * The running estimate shown beside the page title: re-scored as the form changes, so
 * the tool has something to say before the form is submitted, and every edit visibly
 * moves the number. The full breakdown (factors, distribution) still waits for submit.
 *
 * Everything here arrives by transition rather than appearing: the first number counts
 * up from zero, the tint fades in (two colour layers crossfade, since a gradient itself
 * can't animate), and the decision pill and cutoff tick have their space reserved from
 * the start so nothing shifts when they show up.
 *
 * `estimate` is { prob, threshold, decision } or null; `state` is "ready" | "loading" |
 * "invalid" (the form has a field the model can't take yet) | "offline" (API unreachable).
 */
export default function LiveEstimate({ estimate, state }) {
  const prob = useTween(estimate?.prob ?? null, 700, 0);
  const has = estimate !== null && estimate !== undefined;
  const shown = prob ?? 0;
  const isGood = estimate?.decision === "preapproved";
  const color = !has ? "var(--ink-muted)" : isGood ? "var(--good)" : "var(--critical)";
  const threshold = estimate?.threshold ?? 0;

  const tint = (c) => `linear-gradient(160deg, color-mix(in srgb, ${c} 11%, transparent) 0%, transparent 70%)`;

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-card sm:w-[264px]">
      {/* colour wash: one layer per decision, faded in and out */}
      <div aria-hidden className="pointer-events-none absolute inset-0 transition-opacity duration-700" style={{ background: tint("var(--good)"), opacity: has && isGood ? 1 : 0 }} />
      <div aria-hidden className="pointer-events-none absolute inset-0 transition-opacity duration-700" style={{ background: tint("var(--critical)"), opacity: has && !isGood ? 1 : 0 }} />

      <div className="relative">
        <div className="flex h-5 items-center justify-between">
          <div className="flex items-center gap-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            <span className="relative flex h-2 w-2">
              {state === "loading" ? (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: color }} />
              ) : null}
              <span className="relative inline-flex h-2 w-2 rounded-full transition-colors duration-500" style={{ background: state === "offline" ? "var(--ink-muted)" : color }} />
            </span>
            Live estimate
          </div>
          {/* decision pill: always laid out, revealed by opacity + a little scale */}
          <span
            className="rounded-full px-2 py-0.5 text-[0.68rem] font-bold uppercase tracking-wide transition-[opacity,transform,color,background-color] duration-500"
            style={{
              color,
              background: `color-mix(in srgb, ${color} 14%, transparent)`,
              opacity: has ? 1 : 0,
              transform: has ? "scale(1)" : "scale(0.85)",
              transitionTimingFunction: EASE,
            }}
            aria-hidden={!has}
          >
            {has ? (isGood ? "Preapproved" : "Declined") : "Scoring"}
          </span>
        </div>

        {/* the number: fixed line height so the skeleton and the figure occupy the same box */}
        <div className="relative mt-2 h-[2.6rem]">
          <span
            className="skeleton absolute left-0 top-1 block h-8 w-28 animate-shimmer rounded-md transition-opacity duration-300"
            style={{ opacity: has ? 0 : 1 }}
            aria-hidden
          />
          <span
            className="absolute left-0 top-0 text-[2.6rem] font-bold leading-none tracking-tight text-ink-primary tabular-nums transition-opacity duration-500"
            style={{ opacity: has ? 1 : 0 }}
          >
            {(shown * 100).toFixed(1)}%
          </span>
        </div>
        <div className="mt-1 h-[2.2em] text-[0.76rem] leading-snug text-ink-secondary transition-colors duration-300">
          {state === "offline"
            ? "Model API offline. Start it to see a live score."
            : state === "invalid"
              ? "Fill in the empty or out-of-range field to update."
              : "chance of an early missed payment"}
        </div>

        {/* mini meter with the cutoff and the typical applicant marked */}
        <div
          className="relative mt-2.5 h-[8px] overflow-hidden rounded-full transition-colors duration-700"
          style={{ background: `color-mix(in srgb, ${color} 14%, transparent)` }}
        >
          <div
            className="h-full rounded-full transition-[width,background-color] duration-700"
            style={{ width: `${pctOf(shown)}%`, background: color, transitionTimingFunction: EASE }}
          />
        </div>
        <div className="relative mt-1 h-[22px] text-[0.64rem] text-ink-muted">
          <span className="absolute -translate-x-1/2 text-center" style={{ left: `${pctOf(RISK_MEDIAN)}%` }}>
            <span className="mx-auto block h-1.5 w-px bg-ink-muted" />
            typical
          </span>
          <span
            className="absolute -translate-x-1/2 text-center font-semibold transition-opacity duration-500"
            style={{ left: `${pctOf(threshold || RISK_SCALE_MAX / 2)}%`, opacity: threshold ? 1 : 0 }}
            aria-hidden={!threshold}
          >
            <span className="mx-auto block h-1.5 w-px bg-ink-primary" />
            cutoff
          </span>
        </div>

        <div className="mt-2 border-t border-border pt-2 text-[0.68rem] text-ink-muted">
          Updates as you type · full breakdown after you check
        </div>
      </div>
    </div>
  );
}
