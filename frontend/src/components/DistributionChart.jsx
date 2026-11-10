import { useState } from "react";
import { useTooltip, TipTitle, TipRow } from "./Tooltip.jsx";
import { useInView, EASE } from "../lib/motion.js";

/**
 * Histogram of the held-out applicants' scores, with this application and the cutoff
 * marked as full-height rules. A coloured bar can't mark one applicant when most of the
 * population sits in the first few bins, so a rule that spans the plot reads the same
 * wherever it falls.
 *
 * The bars are SVG; every label is HTML positioned by percentage, so text stays at a
 * readable size on a phone instead of shrinking with the drawing.
 *
 * `color` fills the applicant's rule, `textColor` is the text-safe version for its label.
 *
 * The bars rise from the axis the first time the chart is seen. After that, editing the
 * form slides the applicant's rule and its label to the new score, so you can watch an
 * application move through the population.
 */
export default function DistributionChart({ distribution, threshold, prob, color, textColor }) {
  const [hover, setHover] = useState(null);
  const tip = useTooltip();
  const [ref, inView] = useInView();

  if (!distribution) return null;
  const { edges, counts, cap, n: total } = distribution;
  const W = 640;
  const H = 200;
  const top = Math.max(...counts);
  const n = counts.length;
  const step = W / n;
  // kept a hair inside the edges so a rule at 0% or 30%+ isn't half clipped
  const xPct = (v) => Math.min(99.6, Math.max(0.4, (Math.min(v, cap) / cap) * 100));

  const describe = (i) => {
    const lo = edges[i] * 100;
    const hi = edges[i + 1] * 100;
    const last = i === n - 1;
    return (
      <>
        <TipTitle>{last ? `${lo.toFixed(0)}% and up` : `${lo.toFixed(0)}–${hi.toFixed(0)}% chance`}</TipTitle>
        <TipRow>
          {counts[i].toLocaleString()} applicants, {((counts[i] / total) * 100).toFixed(1)}%
        </TipRow>
      </>
    );
  };

  const appAtRight = xPct(prob) > 60;
  const cutLeftOfApp = threshold < prob;

  return (
    <figure ref={ref} className="w-full">
      {/* marker labels: two rows so they never collide */}
      <div className="relative h-11 text-[0.8125rem]" aria-hidden>
        <span
          className={`absolute top-0 whitespace-nowrap font-[650] ${appAtRight ? "-translate-x-full pr-2" : "pl-2"}`}
          style={{
            left: `${xPct(prob)}%`,
            color: textColor,
            opacity: inView ? 1 : 0,
            transition: `left 700ms ${EASE}, color 500ms ease, opacity 400ms ease ${inView ? 700 : 0}ms`,
          }}
        >
          This application, {(prob * 100).toFixed(1)}%
        </span>
        <span
          className={`absolute top-5 whitespace-nowrap text-ink-muted ${cutLeftOfApp ? "-translate-x-full pr-2" : "pl-2"}`}
          style={{ left: `${xPct(threshold)}%` }}
        >
          Cutoff {(threshold * 100).toFixed(1)}%
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-[150px] w-full sm:h-[190px]"
        role="img"
        aria-label={`Distribution of ${total.toLocaleString()} applicants' estimates. This application is at ${(prob * 100).toFixed(1)}%, the cutoff at ${(threshold * 100).toFixed(1)}%.`}
      >
        {[0.5, 1].map((f) => (
          <line key={f} x1="0" x2={W} y1={H * (1 - f / 1.1)} y2={H * (1 - f / 1.1)} stroke="var(--gridline)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        {counts.map((c, i) => {
          const h = (c / (top * 1.1)) * H;
          return (
            <rect
              key={i}
              x={i * step + 1}
              y={H - h}
              width={step - 2}
              height={h}
              fill="var(--bar)"
              opacity={hover === null || hover === i ? 1 : 0.5}
              style={{
                transformBox: "fill-box",
                transformOrigin: "bottom",
                transform: inView ? "scaleY(1)" : "scaleY(0)",
                transition: `transform 700ms ${EASE} ${i * 18}ms, opacity 150ms`,
              }}
            />
          );
        })}
        <line x1={(xPct(threshold) / 100) * W} x2={(xPct(threshold) / 100) * W} y1="0" y2={H} stroke="var(--ink-primary)" strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
        {/* drawn at x=0 and moved with a transform, so a new score slides it across */}
        <line
          x1="0"
          x2="0"
          y1="0"
          y2={H}
          stroke={color}
          strokeWidth="3"
          vectorEffect="non-scaling-stroke"
          style={{
            transform: `translateX(${(xPct(prob) / 100) * W}px)`,
            opacity: inView ? 1 : 0,
            transition: `transform 700ms ${EASE}, stroke 500ms ease, opacity 400ms ease ${inView ? 700 : 0}ms`,
          }}
        />
        {counts.map((_, i) => (
          <rect
            key={`hit-${i}`}
            x={i * step}
            y="0"
            width={step}
            height={H}
            fill="transparent"
            onMouseEnter={(e) => {
              setHover(i);
              tip.show(e.currentTarget, describe(i));
            }}
            onMouseLeave={() => {
              setHover(null);
              tip.hide();
            }}
          />
        ))}
      </svg>

      <div className="mt-2 flex justify-between border-t border-[var(--rule)] pt-1.5 text-[0.8125rem] text-ink-muted" aria-hidden>
        <span>0%</span>
        <span>chance of an early missed payment</span>
        <span>{(cap * 100).toFixed(0)}%+</span>
      </div>
      {tip.element}
    </figure>
  );
}
