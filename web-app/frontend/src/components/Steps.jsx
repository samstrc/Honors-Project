import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * The form's step navigation and step container.
 *
 * <StepTabs> is a row of tabs with an accent pill that glides to whichever is active.
 * The pill is a second, accent-coloured copy of the whole row clipped to the active
 * tab's box (an animated clip-path), so the white label is always exactly under the
 * pill -- a label never flashes invisible while the pill is still on its way, which is
 * what happens if the text colour and the pill animate on separate schedules. It
 * measures the buttons, so it still lands correctly when the row wraps on a phone.
 *
 * <StepPanel> holds the active step. When the step changes it animates its height to
 * the new content instead of jumping, and the new content fades in.
 */

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

export function StepTabs({ items, active, onChange, errorAt }) {
  const rowRef = useRef(null);
  const refs = useRef([]);
  const [box, setBox] = useState(null);

  const measure = () => {
    const el = refs.current[active];
    const row = rowRef.current;
    if (!el || !row) return;
    setBox({
      top: el.offsetTop,
      left: el.offsetLeft,
      right: row.offsetWidth - el.offsetLeft - el.offsetWidth,
      bottom: row.offsetHeight - el.offsetTop - el.offsetHeight,
    });
  };
  useLayoutEffect(measure, [active, items.length]);
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const renderRow = (interactive) =>
    items.map(({ label, icon: Icon }, i) => {
      const isActive = i === active;
      const hasError = errorAt?.(i);
      const common = "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[0.82rem] font-medium";
      const inner = (
        <>
          {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
          {label}
          {hasError ? (
            <span
              aria-label="has a problem"
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: interactive ? "var(--critical)" : "var(--card)" }}
            />
          ) : null}
        </>
      );
      return interactive ? (
        <button
          key={label}
          ref={(el) => (refs.current[i] = el)}
          type="button"
          role="tab"
          aria-selected={isActive}
          onClick={() => onChange(i)}
          className={`focus-ring ${common} text-ink-secondary transition-colors hover:text-ink-primary`}
        >
          {inner}
        </button>
      ) : (
        <span key={label} className={common}>
          {inner}
        </span>
      );
    });

  return (
    <div className="relative">
      <div ref={rowRef} role="tablist" className="flex flex-wrap gap-1">
        {renderRow(true)}
      </div>
      {box ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex flex-wrap gap-1 bg-accent text-[var(--card)]"
          style={{
            clipPath: `inset(${box.top}px ${box.right}px ${box.bottom}px ${box.left}px round 999px)`,
            transition: `clip-path 340ms ${EASE}`,
          }}
        >
          {renderRow(false)}
        </div>
      ) : null}
    </div>
  );
}

export function StepPanel({ step, children }) {
  const inner = useRef(null);
  const [height, setHeight] = useState(null);

  // Follow the content's height at all times (fields appear, errors show up, steps
  // change); the CSS transition turns each change into a glide.
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return undefined;
    const update = () => setHeight(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      className="-mx-1 overflow-hidden px-1"
      style={{ height: height ?? "auto", transition: `height 340ms ${EASE}` }}
    >
      <div ref={inner} className="py-1">
        <div key={step} className="step-in">
          {children}
        </div>
      </div>
    </div>
  );
}
