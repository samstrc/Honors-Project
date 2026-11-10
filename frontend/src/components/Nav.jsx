import { Link, NavLink, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useIndicator, EASE } from "../lib/motion.js";

const LINKS = [
  { to: "/", label: "Findings" },
  { to: "/preapproval", label: "Preapproval" },
  { to: "/guide", label: "Research guide", short: "Guide" },
  { to: "/about", label: "About me" },
];

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
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-secondary transition-colors hover:text-ink-primary"
    >
      <svg viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px]" aria-hidden>
        {dark ? (
          <path d="M17 11.5A7 7 0 0 1 8.5 3 7 7 0 1 0 17 11.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
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
  const { pathname } = useLocation();
  const listRef = useRef(null);
  // one underline that glides to the current page instead of each link drawing its own
  const box = useIndicator(listRef, pathname);
  // no glide on the very first placement, only between pages
  const placed = useRef(false);
  useEffect(() => {
    if (box) requestAnimationFrame(() => (placed.current = true));
  }, [box]);
  return (
    <header className="border-b border-[var(--rule)]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 px-5 sm:px-6 lg:px-8">
        <Link to="/" className="flex items-baseline gap-2 py-4 text-ink-primary">
          <span className="text-[1rem] font-[680] tracking-[-0.01em]">Consumer loan risk</span>
          <span className="hidden text-[0.8125rem] text-ink-muted sm:inline">an honors research project</span>
        </Link>

        <div className="ml-auto lg:hidden">
          <ThemeToggle />
        </div>

        {/* Labels stay visible at every width; on a phone the row sits under the title. */}
        <nav aria-label="Main" className="no-scrollbar order-last -mx-5 w-[calc(100%+2.5rem)] overflow-x-auto sm:mx-0 sm:w-auto sm:overflow-visible lg:order-none lg:ml-auto">
          <ul ref={listRef} className="relative flex gap-5 px-5 sm:gap-6 sm:px-0">
            {LINKS.map(({ to, label, short }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={to === "/"}
                  data-active={to === "/" ? pathname === "/" : pathname.startsWith(to)}
                  className={({ isActive }) =>
                    `relative block whitespace-nowrap py-3 text-[0.9375rem] transition-colors duration-300 lg:py-[1.15rem] ${
                      isActive ? "text-ink-primary" : "text-ink-secondary hover:text-ink-primary"
                    }`
                  }
                >
                  {short ? (
                    <>
                      <span className="sm:hidden">{short}</span>
                      <span className="hidden sm:inline">{label}</span>
                    </>
                  ) : (
                    label
                  )}
                </NavLink>
              </li>
            ))}
            <li
              aria-hidden
              className="pointer-events-none absolute bottom-0 h-[2px] bg-accent"
              style={{
                left: box?.left ?? 0,
                width: box?.width ?? 0,
                opacity: box ? 1 : 0,
                transition: placed.current ? `left 420ms ${EASE}, width 420ms ${EASE}` : "none",
              }}
            />
          </ul>
        </nav>

        <div className="hidden lg:block">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
