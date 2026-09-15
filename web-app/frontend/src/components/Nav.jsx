import { NavLink } from "react-router-dom";
import { useEffect, useState } from "react";
import { Seedling } from "./icons.jsx";

const LINKS = [
  { to: "/", label: "What the data says", icon: InsightsIcon },
  { to: "/preapproval", label: "Preapproval tool", icon: CalcIcon },
  { to: "/guide", label: "About the research", icon: ChatIcon },
  { to: "/about", label: "About me", icon: PersonIcon },
];

function InsightsIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" {...props}>
      <path d="M3 15.5 8 9l3.5 3L17 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="17" cy="5" r="1.4" fill="currentColor" />
    </svg>
  );
}
function CalcIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" {...props}>
      <rect x="3.5" y="2.5" width="13" height="15" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6.5 6h7M7 10.5h.01M10 10.5h.01M13 10.5h.01M7 14h.01M10 14h.01M13 14h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function ChatIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" {...props}>
      <path d="M3 5.5A2.5 2.5 0 0 1 5.5 3h9A2.5 2.5 0 0 1 17 5.5v5A2.5 2.5 0 0 1 14.5 13H9l-4 3.2V13H5.5A2.5 2.5 0 0 1 3 10.5v-5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function PersonIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" {...props}>
      <circle cx="10" cy="6.5" r="3.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.8 16.5c.7-3.1 3.1-4.8 6.2-4.8s5.5 1.7 6.2 4.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {
      /* storage blocked: the toggle still works for this visit */
    }
  }, [dark]);

  return (
    <button
      onClick={() => setDark((d) => !d)}
      aria-label="Toggle color theme"
      className="focus-ring group relative flex h-8 w-8 items-center justify-center rounded-full border border-border text-ink-secondary transition-colors hover:text-ink-primary"
    >
      <svg
        viewBox="0 0 20 20"
        fill="none"
        className={`h-4 w-4 transition-transform duration-500 ${dark ? "rotate-180" : "rotate-0"}`}
      >
        {dark ? (
          <path
            d="M17 11.5A7 7 0 0 1 8.5 3 7 7 0 1 0 17 11.5Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        ) : (
          <>
            <circle cx="10" cy="10" r="3.4" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M10 2.5v1.6M10 15.9v1.6M17.5 10h-1.6M4.1 10H2.5M15.3 4.7l-1.1 1.1M5.8 14.2l-1.1 1.1M15.3 15.3l-1.1-1.1M5.8 5.8 4.7 4.7"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </>
        )}
      </svg>
    </button>
  );
}

export default function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card shadow-sm">
            <Seedling className="h-[22px] w-[22px]" />
          </div>
          {/* The header is capped at max-w-6xl, and four labelled tabs + the toggle leave
              room for a short wordmark only. Tab labels wait for md, the wordmark for lg. */}
          <div className="hidden whitespace-nowrap text-sm font-semibold tracking-tight text-ink-primary lg:block">
            Home Credit
          </div>
        </div>

        <nav className="flex items-center gap-1 rounded-full border border-border bg-card p-1 shadow-sm">
          {LINKS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              aria-label={label}
              title={label}
              className={({ isActive }) =>
                `focus-ring group relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  isActive
                    ? "bg-accent text-[var(--card)]"
                    : "text-ink-secondary hover:text-ink-primary"
                }`
              }
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden whitespace-nowrap md:inline">{label}</span>
            </NavLink>
          ))}
        </nav>

        <ThemeToggle />
      </div>
    </header>
  );
}
