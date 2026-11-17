import { useTooltip, TipTitle, TipRow } from "./Tooltip.jsx";
import { useInView, EASE } from "../lib/motion.js";

/**
 * Horizontal bars of a rate per band, in the order given, each labelled at its end.
 *
 * Two colours from the palette, one meaning: a band whose rate is above the overall
 * average is drawn in clay brown, everything at or below it in sage. The dashed rule is
 * that average, and the value at the end of each bar says the same thing in numbers, so
 * colour is never the only cue. `max` lets several charts share one scale so they
 * compare. With `pctKey="pct"` the bars are shares, not rates, and are all sage.
 *
 * On a phone, a chart with long labels (wider than 6rem) puts each label on its own line
 * above its bar, so the bars keep the full width instead of a sliver next to the text.
 *
 * The first time a chart scrolls into view its bars grow out from the axis one after
 * another, then the values and the average line settle in.
 */
export default function RateBarChart({ rows, pctKey = "rate", average, max: sharedMax, labelWidth = "7.5rem", unit }) {
  const tip = useTooltip();
  const [ref, inView] = useInView();
  const isRate = pctKey === "rate";
  const values = rows.map((r) => r[pctKey] * (isRate ? 100 : 1));
  const avg = average != null ? average * 100 : null;
  const max = sharedMax ?? Math.max(...values, avg ?? 0) * 1.15;
  const avgPct = avg != null ? (avg / max) * 100 : null;

  const describe = (r, val) => (
    <>
      <TipTitle>{r.band}</TipTitle>
      <TipRow>
        {val.toFixed(1)}% {isRate ? "missed an early payment" : unit || ""}
      </TipRow>
      {r.n ? <TipRow>{r.n.toLocaleString()} applicants</TipRow> : null}
    </>
  );

  // Shared by the header row and every bar row, so the average label lines up with the bars
  const stack = parseFloat(labelWidth) > 6;
  const grid = stack
    ? "grid grid-cols-[minmax(0,1fr)_3.25rem] items-center gap-x-2 sm:grid-cols-[var(--lw)_minmax(0,1fr)_3.5rem] sm:gap-x-3"
    : "grid grid-cols-[var(--lw)_minmax(0,1fr)_3.25rem] items-center gap-x-2 sm:grid-cols-[var(--lw)_minmax(0,1fr)_3.5rem] sm:gap-x-3";
  const labelCell = stack
    ? "col-span-2 pt-1 text-left sm:col-span-1 sm:pt-0 sm:text-right"
    : "text-right";

  return (
    <div ref={ref} className="w-full" style={{ "--lw": labelWidth }} role="table"
         aria-label={isRate ? "Share who missed an early payment, by group" : "Share of loans, by group"}>
      {avgPct != null ? (
        <div aria-hidden className={`${grid} h-6`}>
          <span className={stack ? "hidden sm:block" : ""} />
          <div className="relative h-full">
            <span
              className="absolute bottom-1 -translate-x-1/2 whitespace-nowrap text-[0.8125rem] text-ink-muted"
              style={{ left: `${avgPct}%`, opacity: inView ? 1 : 0, transition: `opacity 400ms ease ${rows.length * 70 + 300}ms` }}
            >
              average {avg.toFixed(1)}%
            </span>
          </div>
          <span />
        </div>
      ) : null}
      {rows.map((r, i) => {
        const val = values[i];
        const above = isRate && avg != null && val > avg;
        return (
          <div
            key={r.band}
            role="row"
            className={`group ${grid} cursor-default py-[5px]`}
            onMouseEnter={(e) => tip.show(e.currentTarget.querySelector("[data-bar]"), describe(r, val))}
            onMouseLeave={tip.hide}
          >
            <span role="rowheader" className={`${labelCell} text-[0.875rem] leading-snug text-ink-secondary sm:whitespace-nowrap`}>
              {r.band}
            </span>
            <div role="cell" className="relative h-[18px]">
              <div
                data-bar
                className="absolute inset-y-0 left-0 rounded-full group-hover:brightness-110"
                style={{
                  width: inView ? `${(val / max) * 100}%` : "0%",
                  background: above ? "var(--cat-2)" : "var(--cat-1)",
                  transition: `width 900ms ${EASE} ${i * 70}ms, filter 150ms`,
                }}
              />
              {avgPct != null ? (
                <div
                  aria-hidden
                  className="absolute -inset-y-1.5 border-l border-dashed border-ink-muted"
                  style={{ left: `${avgPct}%`, opacity: inView ? 1 : 0, transition: `opacity 400ms ease ${rows.length * 70 + 300}ms` }}
                />
              ) : null}
            </div>
            <span
              role="cell"
              className="text-right text-[0.875rem] font-[620]"
              style={{
                color: above ? "var(--accent-text)" : "var(--ink-primary)",
                opacity: inView ? 1 : 0,
                transition: `opacity 400ms ease ${i * 70 + 350}ms`,
              }}
            >
              {val.toFixed(1)}%
            </span>
          </div>
        );
      })}
      {tip.element}
    </div>
  );
}
