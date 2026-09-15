import { useState } from "react";
import useInView from "../lib/useInView.js";
import { useTooltip, TipTitle, TipRow } from "./Tooltip.jsx";

/**
 * Histogram of the held-out population's scores, with the applicant's own score and the
 * decision cutoff marked as full-height rules. Ported from the go.Bar + add_vline chart in
 * streamlit_app.py: a coloured bar can't mark a single applicant when 93% of the
 * population sits in the first couple of bins, so a rule that spans the full height reads
 * the same wherever it falls.
 *
 * Hovering a column shows that bin's range and headcount. The tooltip is anchored to the
 * full-height column rather than the bar itself, so it floats above the plot instead of
 * sitting on top of the neighbouring bars.
 */
export default function DistributionChart({ distribution, threshold, prob, color }) {
  const [ref, visible] = useInView();
  const [hover, setHover] = useState(null);
  const tip = useTooltip();

  if (!distribution) return null;
  const { edges, counts, cap, n: total } = distribution;
  const W = 640;
  const H = 250;
  const padL = 8, padR = 8, padT = 34, padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const top = Math.max(...counts);
  const n = counts.length;
  const barGap = 2;
  const barW = plotW / n - barGap;

  const xAt = (v) => padL + (v / cap) * plotW;
  const yAt = (c) => padT + plotH - (c / (top * 1.24)) * plotH;

  const xApp = Math.min(prob, cap);
  const appRightOfCut = xApp >= threshold;
  const appAnchorEnd = xApp > cap * 0.55;
  const cutAnchorEnd = appRightOfCut;

  const describe = (i) => {
    const lo = edges[i] * 100;
    const hi = edges[i + 1] * 100;
    const last = i === counts.length - 1;
    return (
      <>
        <TipTitle>{last ? `${lo.toFixed(0)}% and up` : `${lo.toFixed(0)}–${hi.toFixed(0)}% chance`}</TipTitle>
        <TipRow>
          {counts[i].toLocaleString()} applicants · {((counts[i] / total) * 100).toFixed(1)}%
        </TipRow>
      </>
    );
  };

  return (
    <div ref={ref} className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible" preserveAspectRatio="xMidYMid meet">
        {/* gridlines */}
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={padL}
            x2={W - padR}
            y1={padT + plotH * (1 - f)}
            y2={padT + plotH * (1 - f)}
            stroke="var(--gridline)"
            strokeWidth="1"
          />
        ))}

        {/* bars */}
        {counts.map((c, i) => {
          const x0 = edges[i];
          const cx = xAt(x0) + (xAt(edges[i + 1]) - xAt(x0)) / 2;
          const h = visible ? plotH - (yAt(c) - padT) : 0;
          return (
            <rect
              key={i}
              x={cx - barW / 2}
              y={padT + plotH - h}
              width={Math.max(barW, 1)}
              height={h}
              rx="2.5"
              fill="var(--cat-1)"
              opacity={hover === null || hover === i ? 1 : 0.55}
              style={{ transition: `height 700ms cubic-bezier(.16,1,.3,1) ${i * 12}ms, y 700ms cubic-bezier(.16,1,.3,1) ${i * 12}ms, opacity 150ms` }}
            />
          );
        })}

        {/* cutoff rule */}
        <line
          x1={xAt(threshold)}
          x2={xAt(threshold)}
          y1={padT}
          y2={padT + plotH}
          stroke="var(--ink-muted)"
          strokeWidth="2"
          strokeDasharray="3 3"
        />
        <text
          x={xAt(threshold) + (cutAnchorEnd ? -6 : 6)}
          y={padT - 4}
          fontSize="10.5"
          fill="var(--ink-muted)"
          textAnchor={cutAnchorEnd ? "end" : "start"}
        >
          cutoff {(threshold * 100).toFixed(1)}%
        </text>

        {/* applicant rule */}
        <line
          x1={xAt(xApp)}
          x2={xAt(xApp)}
          y1={padT}
          y2={padT + plotH}
          stroke={color}
          strokeWidth="3"
          opacity={visible ? 1 : 0}
          style={{ transition: "opacity 500ms ease 500ms" }}
        />
        <text
          x={xAt(xApp) + (appAnchorEnd ? -6 : 6)}
          y={padT + 10}
          fontSize="11"
          fontWeight="700"
          fill={color}
          textAnchor={appAnchorEnd ? "end" : "start"}
          opacity={visible ? 1 : 0}
          style={{ transition: "opacity 500ms ease 500ms" }}
        >
          this application, {(prob * 100).toFixed(1)}%
        </text>

        {/* x axis labels */}
        <text x={padL} y={H - 8} fontSize="10.5" fill="var(--ink-secondary)">0%</text>
        <text x={W - padR} y={H - 8} fontSize="10.5" fill="var(--ink-secondary)" textAnchor="end">
          {(cap * 100).toFixed(0)}%+
        </text>
        <text x={(padL + W - padR) / 2} y={H - 8} fontSize="10.5" fill="var(--ink-secondary)" textAnchor="middle">
          chance of an early missed payment
        </text>

        {/* hover columns: the bars are only a few px wide, so each bin gets an invisible
            full-height hit area and the tooltip hangs off that */}
        {counts.map((_, i) => (
          <rect
            key={`hit-${i}`}
            x={xAt(edges[i])}
            y={padT}
            width={Math.max(xAt(edges[i + 1]) - xAt(edges[i]), 1)}
            height={plotH}
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
      {tip.element}
    </div>
  );
}
