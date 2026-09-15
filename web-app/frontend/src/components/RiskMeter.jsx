import { useEffect, useState } from "react";
import { RISK_MEDIAN, RISK_SCALE_MAX } from "../lib/constants";

const pctOf = (v) => Math.min(100, Math.max(0, (v / RISK_SCALE_MAX) * 100));

export default function RiskMeter({ prob, threshold, decision, percentile }) {
  const [animated, setAnimated] = useState(0);
  const isGood = decision === "preapproved";
  const color = isGood ? "var(--good)" : "var(--critical)";
  const label = isGood ? "Preapproved" : "Declined";

  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimated(prob));
    return () => cancelAnimationFrame(id);
  }, [prob]);

  return (
    <div className="animate-fade-up rounded-2xl border border-border bg-card p-6 shadow-card sm:p-7">
      <div className="mb-1 flex items-center gap-2">
        <span
          className="h-[9px] w-[9px] rounded-full"
          style={{ background: color, boxShadow: `0 0 0 4px color-mix(in srgb, ${color} 18%, transparent)` }}
        />
        <span
          className="text-[0.8rem] font-bold uppercase tracking-[0.05em]"
          style={{ color }}
        >
          {label}
        </span>
      </div>

      <div
        className="my-0.5 text-[clamp(48px,7vw,66px)] font-bold leading-[1.05] tracking-tight text-ink-primary tabular-nums transition-all"
        style={{ transitionDuration: "900ms" }}
      >
        {(prob * 100).toFixed(1)}%
      </div>
      <div className="mb-4 text-[0.92rem] text-ink-secondary">
        estimated chance of an early missed payment · riskier than{" "}
        <b className="text-ink-primary">{percentile}%</b> of real applicants
      </div>

      <div
        className="relative h-[14px] overflow-hidden rounded-[4px]"
        style={{ background: `color-mix(in srgb, ${color} 12%, transparent)` }}
      >
        <div
          className="h-full rounded-r-[4px] transition-[width] duration-[1100ms] ease-out"
          style={{ width: `${pctOf(animated)}%`, background: color }}
        />
      </div>

      <div className="relative mt-1.5 h-[30px]">
        <div
          className="absolute -translate-x-1/2 text-center"
          style={{ left: `${pctOf(RISK_MEDIAN)}%` }}
        >
          <div className="mx-auto mb-[3px] h-2 w-[2px] rounded-[1px] bg-ink-muted" />
          <div className="whitespace-nowrap text-[0.72rem] text-ink-muted">typical</div>
        </div>
        <div
          className="absolute -translate-x-1/2 text-center"
          style={{ left: `${pctOf(threshold)}%` }}
        >
          <div className="mx-auto mb-[3px] h-2 w-[2px] rounded-[1px] bg-ink-primary" />
          <div className="whitespace-nowrap text-[0.72rem] font-bold text-ink-muted">
            cutoff {(threshold * 100).toFixed(1)}%
          </div>
        </div>
      </div>
      <div className="mt-0.5 flex justify-between text-[0.72rem] text-ink-muted">
        <span>0%</span>
        <span>{(RISK_SCALE_MAX * 100).toFixed(0)}%+</span>
      </div>
    </div>
  );
}
