import useInView from "../lib/useInView.js";
import { useTooltip, TipTitle, TipRow } from "./Tooltip.jsx";

/**
 * Horizontal bar chart of a rate per band, ordered as given, value labelled at the tip.
 * A hand-rolled equivalent of findings_page.py's rate_bar(): same rounded data-end, same
 * hairline grid, same direct labelling instead of relying on a tooltip.
 *
 * `reference` ({ value, label }) draws a dashed rule through every row at that value --
 * the overall rate, so each band reads as above or below average at a glance.
 * `iconFor(band)` returns a component drawn beside the band's label; `wide` gives the
 * label column more room for long category names.
 *
 * Hovering a row floats the band's headcount above its bar (see Tooltip.jsx).
 */
export default function RateBarChart({ rows, color, pctKey = "rate", height, reference, iconFor, wide = false }) {
  const [ref, visible] = useInView();
  const tip = useTooltip();

  const values = rows.map((r) => r[pctKey] * (pctKey === "rate" ? 100 : 1));
  const max = Math.max(...values, reference?.value ?? 0) * 1.28;
  const rowHeight = 34;
  const refPct = reference ? (reference.value / max) * 100 : null;
  const headerHeight = reference ? 18 : 0;
  const chartHeight = height || rows.length * rowHeight + 8 + headerHeight;

  const describe = (r, val) => (
    <>
      <TipTitle>{r.band}</TipTitle>
      <TipRow>
        {val.toFixed(1)}% {pctKey === "rate" ? "missed an early payment" : "of prior loans"}
        {reference && pctKey === "rate" ? (
          <span className="text-ink-muted">
            {" "}
            · {val >= reference.value ? "+" : "−"}
            {Math.abs(val - reference.value).toFixed(1)} pts vs average
          </span>
        ) : null}
      </TipRow>
      {r.n ? <TipRow>{r.n.toLocaleString()} applicants</TipRow> : null}
    </>
  );

  const labelCol = wide ? "w-[150px] shrink-0 sm:w-[200px]" : "w-[108px] shrink-0 sm:w-[132px]";

  return (
    <div ref={ref} style={{ height: chartHeight }} className="w-full">
      <div className="flex h-full flex-col justify-between">
        {reference ? (
          // mirrors the row layout so the label sits exactly over the rule
          <div className="flex items-end gap-3" style={{ height: headerHeight }}>
            <div className={labelCol} />
            <div className="relative h-full flex-1">
              <span
                className="absolute bottom-0 -translate-x-1/2 whitespace-nowrap text-[0.68rem] font-medium text-ink-muted"
                style={{ left: `${refPct}%`, opacity: visible ? 1 : 0, transition: "opacity 500ms ease 600ms" }}
              >
                {reference.label}
              </span>
            </div>
            <div className="w-16 shrink-0" />
          </div>
        ) : null}

        {rows.map((r, i) => {
          const val = values[i];
          const pct = (val / max) * 100;
          const Icon = iconFor?.(r.band);
          return (
            <div
              key={r.band}
              className="group flex cursor-default items-center gap-3"
              onMouseEnter={(e) => tip.show(e.currentTarget.querySelector("[data-bar]"), describe(r, val))}
              onMouseLeave={tip.hide}
            >
              <div className={`${labelCol} flex items-center justify-end gap-1.5 text-right text-[0.78rem] text-ink-secondary`}>
                <span className="truncate">{r.band}</span>
                {Icon ? <Icon className="h-4 w-4 shrink-0 text-ink-muted transition-colors group-hover:text-ink-primary" /> : null}
              </div>
              {/* fade the track colour, not the element -- an opacity on the track was
                  washing out the bar inside it too */}
              <div
                className="relative h-[15px] flex-1 rounded-[4px]"
                style={{ background: "color-mix(in srgb, var(--gridline) 35%, transparent)" }}
              >
                <div
                  data-bar
                  className="absolute left-0 top-0 h-full rounded-r-[4px] transition-all duration-700 ease-out group-hover:brightness-110"
                  style={{
                    width: visible ? `${pct}%` : "0%",
                    background: color,
                    transitionDelay: `${i * 60}ms`,
                  }}
                />
                {refPct !== null ? (
                  <div
                    aria-hidden
                    className="absolute -bottom-[5px] -top-[5px] w-0 border-l border-dashed border-ink-muted"
                    style={{ left: `${refPct}%`, opacity: visible ? 0.7 : 0, transition: "opacity 500ms ease 600ms" }}
                  />
                ) : null}
              </div>
              <div className="w-16 shrink-0 text-[0.78rem] font-semibold tabular-nums text-ink-primary">
                {val.toFixed(1)}%
              </div>
            </div>
          );
        })}
      </div>
      {tip.element}
    </div>
  );
}
