import useInView from "../lib/useInView.js";
import { useTooltip, TipTitle, TipRow } from "./Tooltip.jsx";

/**
 * Diverging horizontal bar chart of SHAP contributions, in log-odds. Colour encodes
 * direction (raises vs. lowers risk), not good/bad status -- same convention as the
 * DIVERGING_RED / DIVERGING_BLUE bars in streamlit_app.py.
 *
 * Feature names get truncated to fit the label column, so hovering a row floats the
 * full name and the effect above the bar (see Tooltip.jsx).
 */
export default function FactorChart({ factors, posColor, negColor }) {
  const [ref, visible] = useInView();
  const tip = useTooltip();

  const sorted = [...factors].sort((a, b) => a.contribution - b.contribution);
  const maxAbs = Math.max(...sorted.map((f) => Math.abs(f.contribution)), 0.001);

  const describe = (f) => (
    <>
      <TipTitle>{f.feature}</TipTitle>
      <TipRow>
        {f.contribution > 0 ? "+" : ""}
        {f.contribution.toFixed(3)} log-odds · {f.contribution > 0 ? "increases" : "decreases"} risk
      </TipRow>
    </>
  );

  return (
    <div ref={ref} className="w-full">
      <div className="flex flex-col gap-2.5">
        {sorted.map((f, i) => {
          const pct = (Math.abs(f.contribution) / maxAbs) * 42; // max 42% from centre
          const isPos = f.contribution > 0;
          const color = isPos ? posColor : negColor;
          return (
            <div
              key={f.feature}
              className="group flex cursor-default items-center gap-3"
              onMouseEnter={(e) => tip.show(e.currentTarget.querySelector("[data-bar]"), describe(f))}
              onMouseLeave={tip.hide}
            >
              <div className="w-[46%] shrink-0 truncate text-right text-[0.8rem] text-ink-secondary">
                {f.feature}
              </div>
              <div className="relative h-[20px] flex-1">
                <div className="absolute left-1/2 top-0 h-full w-px bg-[var(--ink-muted)] opacity-50" />
                <div
                  data-bar
                  className={`absolute top-0 h-full rounded-sm transition-all duration-700 ease-out group-hover:brightness-110 ${
                    isPos ? "left-1/2 rounded-l-none" : "right-1/2 rounded-r-none"
                  }`}
                  style={{
                    width: visible ? `${pct}%` : "0%",
                    background: color,
                    transitionDelay: `${i * 50}ms`,
                  }}
                />
              </div>
              <div
                className="w-16 shrink-0 text-[0.78rem] font-semibold tabular-nums"
                style={{ color }}
              >
                {f.contribution > 0 ? "+" : ""}
                {f.contribution.toFixed(3)}
              </div>
            </div>
          );
        })}
      </div>
      {tip.element}
    </div>
  );
}
