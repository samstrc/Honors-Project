/**
 * Small stroke icons shared across the site. All 20x20 and currentColor, so they inherit
 * whatever text color they sit in.
 */

const base = { viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };

export const CheckIcon = (p) => (
  <svg {...base} strokeWidth={2.2} {...p}>
    <path d="M4 10.5 8 14.5 16 6" />
  </svg>
);
