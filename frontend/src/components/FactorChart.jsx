import { useInView, EASE } from "../lib/motion.js";

/**
 * Diverging bars of SHAP contributions, in log-odds, largest first. Color encodes
 * direction (raises vs. lowers risk); the words say it too, so color is never the only
 * cue. On a phone the label sits above its bar instead of beside it.
 *
 * Bars grow out from the center line when the chart first comes into view, and resize
 * smoothly as the form changes; a reason that newly makes the list fades in.
 */
export default function FactorChart({ factors }) {
  const sorted = [...factors].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const maxAbs = Math.max(...sorted.map((f) => Math.abs(f.contribution)), 0.001);
  const [ref, inView] = useInView();

  return (
    <ul ref={ref} className="divide-y divide-[var(--border)]">
      {sorted.map((f, i) => {
        const up = f.contribution > 0;
        const half = (Math.abs(f.contribution) / maxAbs) * 50;
        return (
          <li key={f.feature} className="animate-fade-in grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 py-2.5 sm:grid-cols-[minmax(0,17rem)_1fr_7rem]">
            <span className="text-[0.9375rem] text-ink-primary">{f.feature}</span>
            <span
              className="whitespace-nowrap text-right text-[0.875rem] font-[620] sm:order-last"
              style={{ color: up ? "var(--critical-text)" : "var(--good-text)" }}
            >
              {up ? "raises" : "lowers"} {up ? "+" : "−"}
              {Math.abs(f.contribution).toFixed(2)}
            </span>
            <span className="relative col-span-2 h-3 sm:col-span-1" aria-hidden>
              <span className="absolute inset-y-[-3px] left-1/2 w-px bg-[var(--rule)]" />
              <span
                className="absolute inset-y-0 rounded-full"
                style={{
                  width: inView ? `${half}%` : "0%",
                  transition: `width 800ms ${EASE} ${inView ? i * 60 : 0}ms`,
                  background: up ? "var(--pos)" : "var(--neg)",
                  ...(up ? { left: "50%" } : { right: "50%" }),
                }}
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
