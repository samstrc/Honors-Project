import { useEffect, useState } from "react";

/** Counts from 0 to `to` over `duration` ms, easing out. Returns the current value. */
function useCountUp(to, duration = 1100) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let frame;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(to * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to, duration]);
  return value;
}

function CountUp({ to, format }) {
  const v = useCountUp(to);
  return <>{format(v)}</>;
}

export function Kicker({ children }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted animate-fade-up">
      {children}
    </div>
  );
}

export function PageTitle({ children }) {
  return (
    <h1 className="mt-1 text-[2rem] font-bold leading-tight tracking-tight text-ink-primary animate-fade-up [animation-delay:60ms]">
      {children}
    </h1>
  );
}

export function PageSubtitle({ children }) {
  return (
    <p className="mt-1.5 max-w-xl text-[0.98rem] leading-relaxed text-ink-secondary animate-fade-up [animation-delay:120ms]">
      {children}
    </p>
  );
}

export function FactsRow({ facts }) {
  return (
    <div className="mt-7 flex flex-wrap gap-2.5 animate-fade-up [animation-delay:180ms]">
      {facts.map((f, i) => (
        <div
          key={i}
          className="flex-1 min-w-[140px] rounded-xl border border-border bg-card px-4 py-3.5 shadow-card transition-transform duration-300 hover:-translate-y-0.5"
        >
          <div className="text-2xl font-bold tracking-tight text-ink-primary tabular-nums">
            {/* a value can be a finished string, or { to, format } to count up on mount */}
            {f.value && typeof f.value === "object" ? <CountUp to={f.value.to} format={f.value.format} /> : f.value}
          </div>
          <div className="mt-0.5 text-[0.75rem] leading-snug text-ink-muted">{f.label}</div>
        </div>
      ))}
    </div>
  );
}

export function SectionTitle({ icon: Icon, children }) {
  return (
    <div className="flex items-center gap-2.5 text-[1.05rem] font-semibold text-ink-primary">
      {Icon ? (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-accent">
          <Icon className="h-4 w-4" />
        </span>
      ) : null}
      <span>{children}</span>
    </div>
  );
}

export function SectionSub({ children }) {
  return <p className="mb-3.5 mt-1 text-[0.89rem] leading-relaxed text-ink-secondary">{children}</p>;
}
