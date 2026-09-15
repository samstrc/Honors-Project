/**
 * Small stroke icons for the findings page: one per section, one per financed-goods
 * category. All 20x20, currentColor, so they inherit whatever text colour they sit in.
 */

const base = { viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };

export const ShieldIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M10 2.5 4 4.8v4.4c0 3.6 2.5 6.5 6 7.8 3.5-1.3 6-4.2 6-7.8V4.8L10 2.5Z" />
    <path d="m7.5 10 1.8 1.8L12.8 8" />
  </svg>
);
export const WalletIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h10A1.5 1.5 0 0 1 16 6.5V8" />
    <rect x="3" y="8" width="14" height="8" rx="1.5" />
    <path d="M13 12h1.5" />
  </svg>
);
export const HourglassIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M6 3h8M6 17h8M7 3v2.5L10 10l-3 4.5V17M13 3v2.5L10 10l3 4.5V17" />
  </svg>
);
export const BriefcaseIcon = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="6.5" width="14" height="9.5" rx="1.5" />
    <path d="M7.5 6.5V5A1.5 1.5 0 0 1 9 3.5h2A1.5 1.5 0 0 1 12.5 5v1.5M3 10.5h14" />
  </svg>
);
export const CapIcon = (p) => (
  <svg {...base} {...p}>
    <path d="m2.5 8 7.5-3.5L17.5 8 10 11.5 2.5 8Z" />
    <path d="M6 9.8v3.2c0 1 1.8 2 4 2s4-1 4-2V9.8M17.5 8v4" />
  </svg>
);
export const BagIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M4.5 7h11l-.8 9.3a1.5 1.5 0 0 1-1.5 1.2H6.8a1.5 1.5 0 0 1-1.5-1.2L4.5 7Z" />
    <path d="M7.5 9V6a2.5 2.5 0 0 1 5 0v3" />
  </svg>
);
export const DocIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M5.5 3h6l3.5 3.5V17H5.5V3Z" />
    <path d="M11.5 3v3.5H15M8 10h4M8 13h4" />
  </svg>
);
export const DatabaseIcon = (p) => (
  <svg {...base} {...p}>
    <ellipse cx="10" cy="5" rx="6" ry="2.3" />
    <path d="M4 5v10c0 1.3 2.7 2.3 6 2.3s6-1 6-2.3V5M4 10c0 1.3 2.7 2.3 6 2.3s6-1 6-2.3" />
  </svg>
);

export const UserIcon = (p) => (
  <svg {...base} {...p}>
    <circle cx="10" cy="6.5" r="3.2" />
    <path d="M3.8 16.5c.7-3.1 3.1-4.8 6.2-4.8s5.5 1.7 6.2 4.8" />
  </svg>
);
export const StarIcon = (p) => (
  <svg {...base} {...p}>
    <path d="m10 2.8 2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7L10 2.8Z" />
  </svg>
);
export const AlertIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M10 3 2.8 15.5h14.4L10 3Z" />
    <path d="M10 8v3.5M10 13.6h.01" />
  </svg>
);

/** The site's mark: the seedling from the favicon (public/favicon.svg), minus its tile, so
 *  the element around it decides the background. */
export const Seedling = (p) => (
  <svg viewBox="12 14 40 46" {...p}>
    <path d="M32 40 C32 34 32 30 32 24" stroke="#4d975e" strokeWidth="3.2" strokeLinecap="round" fill="none" />
    <ellipse cx="24.5" cy="27" rx="8.5" ry="4.8" fill="#4d975e" transform="rotate(-34 24.5 27)" />
    <ellipse cx="39.5" cy="21" rx="8.5" ry="4.8" fill="#5fae70" transform="rotate(34 39.5 21)" />
    <ellipse cx="32" cy="40" rx="14" ry="3.2" fill="#6b3d0c" />
    <path d="M19.5 41.5 L44.5 41.5 L41.5 57 Q41.2 59 39.2 59 L24.8 59 Q22.8 59 22.5 57 Z" fill="#925612" />
    <rect x="17" y="37" width="30" height="6" rx="3" fill="#b5722a" />
  </svg>
);

/** The research guide's face: a small, friendly robot. The head takes currentColor; the
 *  eyes and smile take `eyes`, so it can sit on any background. */
export const BotIcon = ({ eyes = "var(--accent)", ...p }) => (
  <svg viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M12 6V4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="12" cy="2.9" r="1.4" fill="currentColor" />
    <rect x="4.5" y="6.2" width="15" height="12.3" rx="4.2" fill="currentColor" />
    <rect x="2.2" y="10.6" width="2.3" height="3.6" rx="1.15" fill="currentColor" />
    <rect x="19.5" y="10.6" width="2.3" height="3.6" rx="1.15" fill="currentColor" />
    <rect x="8.3" y="10" width="2.2" height="3.8" rx="1.1" fill={eyes} />
    <rect x="13.5" y="10" width="2.2" height="3.8" rx="1.1" fill={eyes} />
    <path d="M9.6 15.6c.7.9 1.5 1.3 2.4 1.3s1.7-.4 2.4-1.3" stroke={eyes} strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

/* ----- financed goods ----- */

const PhoneIcon = (p) => (
  <svg {...base} {...p}>
    <rect x="6" y="2.5" width="8" height="15" rx="1.8" />
    <path d="M9 15h2" />
  </svg>
);
const TvIcon = (p) => (
  <svg {...base} {...p}>
    <rect x="2.5" y="4" width="15" height="10" rx="1.5" />
    <path d="M7 17h6" />
  </svg>
);
const LaptopIcon = (p) => (
  <svg {...base} {...p}>
    <rect x="4" y="4" width="12" height="8.5" rx="1.2" />
    <path d="M2.5 15.5h15" />
  </svg>
);
const HeadphonesIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M4 11.5V10a6 6 0 0 1 12 0v1.5" />
    <rect x="3" y="11" width="3.5" height="5" rx="1" />
    <rect x="13.5" y="11" width="3.5" height="5" rx="1" />
  </svg>
);
const SofaIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M4 10V7.5A1.5 1.5 0 0 1 5.5 6h9A1.5 1.5 0 0 1 16 7.5V10" />
    <path d="M2.5 11.5A1.5 1.5 0 0 1 4 10h12a1.5 1.5 0 0 1 1.5 1.5V14h-15v-2.5ZM4 14v1.5M16 14v1.5" />
  </svg>
);
const CameraIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h2l1-1.5h5l1 1.5h2A1.5 1.5 0 0 1 17 7.5V15a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15V7.5Z" />
    <circle cx="10" cy="11" r="2.8" />
  </svg>
);
const HammerIcon = (p) => (
  <svg {...base} {...p}>
    <path d="m11 8 5.5 5.5-1.5 1.5L9.5 9.5M6.5 3.5 12 5l1 2-3 3-2-1-4-2.5 2.5-3Z" />
  </svg>
);
const ShirtIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M7 3.5 3 6l1.5 3 2-1V17h7V8l2 1L17 6l-4-2.5a3 3 0 0 1-6 0Z" />
  </svg>
);

export const GOODS_ICONS = {
  Mobile: PhoneIcon,
  "Consumer Electronics": TvIcon,
  Computers: LaptopIcon,
  "Audio/Video": HeadphonesIcon,
  Furniture: SofaIcon,
  "Photo / Cinema Equipment": CameraIcon,
  "Construction Materials": HammerIcon,
  "Clothing and Accessories": ShirtIcon,
};
