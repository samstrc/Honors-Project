/**
 * Small stroke icons shared across the site. All 20x20 and currentColor, so they inherit
 * whatever text colour they sit in.
 */

const base = { viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };

export const SpinnerIcon = ({ className = "h-3.5 w-3.5" }) => (
  <svg viewBox="0 0 24 24" className={`${className} animate-spin`} fill="none">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

export const CheckIcon = (p) => (
  <svg {...base} strokeWidth={2.2} {...p}>
    <path d="M4 10.5 8 14.5 16 6" />
  </svg>
);
