import { useEffect, useRef } from "react";

/**
 * The color behind the About page: the research guide's drifting pools of the palette,
 * spread across the whole window and turned down, so every section on the page reads as
 * glass over it. It is fixed to the window, but each pool also shifts with how far down the
 * page you are, at its own rate and in its own direction, so the colors slide past each
 * other as you scroll instead of sitting still behind moving text.
 *
 * The scroll position goes in as one CSS variable (--about-scroll, 0 at the top and 1 at the
 * bottom), set once per frame, so React never re-renders on scroll. Like the findings
 * painting, App.jsx draws this outside the page wrapper, because that wrapper is transformed
 * while a page animates in and would trap a fixed layer inside it.
 */
export default function AboutBackdrop() {
  const ref = useRef(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const room = document.documentElement.scrollHeight - window.innerHeight;
      const progress = room > 0 ? Math.min(1, Math.max(0, window.scrollY / room)) : 0;
      ref.current?.style.setProperty("--about-scroll", progress.toFixed(4));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={ref} aria-hidden className="guide-aurora about-aurora">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}
