import { useEffect, useRef, useState } from "react";

// Motion on this site is there to show what changed or to bring a chart in once. Anyone
// who has asked their OS for less motion gets the end state straight away: the CSS rule
// in index.css handles transitions and animations, and these hooks skip their own
// JavaScript-driven easing.
export const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** True once the element has scrolled into view, then stays true. */
export function useInView(threshold = 0.25) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          obs.disconnect();
        }
      },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, inView];
}

/** Counts from 0 to `to` once `start` is true, easing out. */
export function useCountUp(to, start, duration = 900) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!start) return undefined;
    if (prefersReducedMotion()) {
      setValue(to);
      return undefined;
    }
    let frame;
    const t0 = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      setValue(to * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to, start, duration]);
  return value;
}

/**
 * Where a sliding indicator should sit: the box of the child marked `data-active` inside
 * `containerRef`, re-measured when `key` changes and when the container resizes.
 */
export function useIndicator(containerRef, key) {
  const [box, setBox] = useState(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const measure = () => {
      const active = el.querySelector("[data-active='true']");
      setBox(active ? { left: active.offsetLeft, top: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight } : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // the web font arriving changes every label's width
    document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, [containerRef, key]);
  return box;
}
