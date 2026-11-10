import { Link, NavLink, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useIndicator, EASE } from "../lib/motion.js";

const LINKS = [
  { to: "/", label: "Findings" },
  { to: "/preapproval", label: "Preapproval" },
  { to: "/guide", label: "Research guide", short: "Guide" },
  { to: "/about", label: "About me" },
];

// Light and dark as a two-way switch, with the same sliding thumb as the page links.
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

  const option = (isDark, label, icon) => (
    <button
      type="button"
      onClick={() => setDark(isDark)}
      aria-pressed={dark === isDark}
      aria-label={label}
      className={`relative z-[1] flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-300 ${
        dark === isDark ? "text-ink-primary" : "text-ink-muted hover:text-ink-primary"
      }`}
    >
      <svg viewBox="0 0 20 20" fill="none" className="h-[16px] w-[16px]" aria-hidden>
        {icon}
      </svg>
    </button>
  );

  return (
    <div role="group" aria-label="Theme" className="seg-track relative flex shrink-0">
      <span
        aria-hidden
        className="glass-lens absolute top-1 h-8 w-8 rounded-full"
        style={{ left: dark ? "calc(4px + 2rem)" : "4px", transition: `left 420ms ${EASE}` }}
      />
      {option(
        false,
        "Light theme",
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
      {option(true, "Dark theme", <path d="M17 11.5A7 7 0 0 1 8.5 3 7 7 0 1 0 17 11.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />)}
    </div>
  );
}

export default function Nav() {
  const { pathname } = useLocation();
  const listRef = useRef(null);
  // one glass thumb that glides to the current page instead of each link drawing its own
  const box = useIndicator(listRef, pathname);
  // no glide on the very first placement, only between pages
  const placed = useRef(false);
  useEffect(() => {
    if (box) requestAnimationFrame(() => (placed.current = true));
  }, [box]);
  return (
    // Floats over the page as a sheet of glass, so content scrolls underneath it.
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-4">
      <div className="glass mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 rounded-[26px] p-2 lg:rounded-full">
        <Link to="/" className="flex items-baseline gap-2 rounded-full py-1.5 pl-3 text-ink-primary">
          <span className="text-[1rem] font-[680] tracking-[-0.01em]">Consumer loan risk</span>
          <span className="hidden text-[0.8125rem] text-ink-muted sm:inline">an honors research project</span>
        </Link>

        <div className="ml-auto lg:hidden">
          <ThemeToggle />
        </div>

        {/* Labels stay visible at every width; on a phone the row sits under the title. */}
        <nav aria-label="Main" className="no-scrollbar order-last w-full overflow-x-auto lg:order-none lg:ml-auto lg:w-auto">
          <ul ref={listRef} className="seg-track relative flex min-w-max">
            <li
              aria-hidden
              className="glass-lens pointer-events-none absolute rounded-full"
              style={{
                left: box?.left ?? 0,
                top: box?.top ?? 0,
                width: box?.width ?? 0,
                height: box?.height ?? 0,
                opacity: box ? 1 : 0,
                transition: placed.current ? `left 480ms ${EASE}, width 480ms ${EASE}` : "none",
              }}
            />
            {LINKS.map(({ to, label, short }) => (
              <li key={to} className="flex-1">
                <NavLink
                  to={to}
                  end={to === "/"}
                  data-active={to === "/" ? pathname === "/" : pathname.startsWith(to)}
                  className={({ isActive }) =>
                    `relative z-[1] block whitespace-nowrap rounded-full px-2.5 py-1.5 text-center text-[0.875rem] transition-colors duration-300 sm:px-4 sm:text-[0.9375rem] ${
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
          </ul>
        </nav>

        <div className="hidden lg:block">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
