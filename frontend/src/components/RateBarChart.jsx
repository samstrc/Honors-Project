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

  return (
    <div ref={ref} className={`w-full ${avgPct != null ? "pt-6" : ""}`}>
      <table className="w-full border-collapse">
        <caption className="sr-only">
          {isRate ? "Share who missed an early payment, by group" : "Share of loans, by group"}
        </caption>
        <tbody>
          {rows.map((r, i) => {
            const val = values[i];
            const above = isRate && avg != null && val > avg;
            return (
              <tr
                key={r.band}
                className="group cursor-default"
                onMouseEnter={(e) => tip.show(e.currentTarget.querySelector("[data-bar]"), describe(r, val))}
                onMouseLeave={tip.hide}
              >
                <th scope="row" className="whitespace-nowrap py-[5px] pr-3 text-right align-middle text-[0.875rem] font-normal text-ink-secondary" style={{ width: labelWidth }}>
                  {r.band}
                </th>
                <td className="relative py-[5px] align-middle">
                  <div className="relative h-4">
                    <div
                      data-bar
                      className="absolute inset-y-0 left-0 rounded-r-[2px] group-hover:brightness-110"
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
                      >
                        {i === 0 ? (
                          <span className="absolute bottom-full mb-1 -translate-x-1/2 whitespace-nowrap text-[0.8125rem] text-ink-muted">
                            average {avg.toFixed(1)}%
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </td>
                <td
                  className="w-14 py-[5px] pl-2 text-right align-middle text-[0.875rem] font-[620]"
                  style={{
                    color: above ? "var(--accent-text)" : "var(--ink-primary)",
                    opacity: inView ? 1 : 0,
                    transition: `opacity 400ms ease ${i * 70 + 350}ms`,
                  }}
                >
                  {val.toFixed(1)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {tip.element}
    </div>
  );
}
