import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * One floating tooltip for the whole site: chart hovers, the form's "?" tips, anything
 * else that needs a little text to hang off an element.
 *
 * Rendered into document.body with position: fixed, so it is never clipped by a chart's
 * overflow, a card's rounded corners, or the sticky header. It sits above the anchor
 * with a small gap, flips below when there is no room, and is clamped to the viewport
 * horizontally so it can't run off screen on a phone. It ignores the pointer, so it can
 * never trap a hover or block a click on whatever happens to be under it.
 *
 * Two ways to use it:
 *
 *   const tip = useTooltip();
 *   <rect onMouseEnter={(e) => tip.show(e.currentTarget, "…")} onMouseLeave={tip.hide} />
 *   {tip.element}
 *
 * for charts (works on SVG and HTML anchors alike), or
 *
 *   <Tooltip content="…"><span>hover me</span></Tooltip>
 *
 * for a single HTML element.
 */

const VIEWPORT_MARGIN = 8; // never closer than this to a screen edge
const GAP = 7; // between the anchor and the tooltip (arrow lives in here)
const ARROW = 7; // arrow square size, px

export function useTooltip() {
  const [state, setState] = useState(null);

  const show = useCallback((anchor, content) => {
    if (!anchor || content == null) return;
    setState({ rect: anchor.getBoundingClientRect(), content });
  }, []);
  const hide = useCallback(() => setState(null), []);

  // A fixed-position box drifts away from its anchor if the page scrolls or the window
  // resizes mid-hover, so just dismiss it; the next hover re-measures.
  useEffect(() => {
    if (!state) return undefined;
    const off = () => setState(null);
    window.addEventListener("scroll", off, { passive: true, capture: true });
    window.addEventListener("resize", off);
    return () => {
      window.removeEventListener("scroll", off, { capture: true });
      window.removeEventListener("resize", off);
    };
  }, [state]);

  const element = state ? <TooltipLayer rect={state.rect} content={state.content} /> : null;
  return { show, hide, element, visible: state !== null };
}

function TooltipLayer({ rect, content }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Prefer above; go below only when above would poke past the top of the screen.
    let placement = "top";
    let top = rect.top - GAP - height;
    if (top < VIEWPORT_MARGIN) {
      placement = "bottom";
      top = rect.bottom + GAP;
      if (top + height > vh - VIEWPORT_MARGIN) top = Math.max(VIEWPORT_MARGIN, vh - VIEWPORT_MARGIN - height);
    }

    const anchorX = rect.left + rect.width / 2;
    const maxLeft = Math.max(VIEWPORT_MARGIN, vw - VIEWPORT_MARGIN - width);
    const left = Math.min(Math.max(VIEWPORT_MARGIN, anchorX - width / 2), maxLeft);
    // The arrow keeps pointing at the anchor even when the box has been shoved sideways.
    const arrowX = Math.min(Math.max(ARROW + 6, anchorX - left), width - ARROW - 6);

    setPos({ top, left, placement, arrowX });
  }, [rect, content]);

  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className={`pointer-events-none fixed z-50 max-w-[min(18rem,calc(100vw-16px))] rounded-lg border border-border bg-card px-2.5 py-1.5 text-[0.74rem] leading-snug text-ink-secondary shadow-tip ${
        pos ? "animate-tip-in" : "invisible"
      }`}
      style={{ top: pos?.top ?? 0, left: pos?.left ?? 0 }}
    >
      {content}
      {pos ? (
        <span
          aria-hidden
          className="absolute h-[7px] w-[7px] rotate-45 border-border bg-card"
          style={{
            left: pos.arrowX - ARROW / 2,
            ...(pos.placement === "top"
              ? { bottom: -ARROW / 2 - 0.5, borderRightWidth: 1, borderBottomWidth: 1 }
              : { top: -ARROW / 2 - 0.5, borderLeftWidth: 1, borderTopWidth: 1 }),
          }}
        />
      ) : null}
    </div>,
    document.body
  );
}

/** Wraps one HTML element and shows `content` while it is hovered or focused. */
export function Tooltip({ content, children, className = "" }) {
  const tip = useTooltip();
  return (
    <span
      className={`inline-flex ${className}`}
      onMouseEnter={(e) => tip.show(e.currentTarget, content)}
      onMouseLeave={tip.hide}
      onFocus={(e) => tip.show(e.currentTarget, content)}
      onBlur={tip.hide}
    >
      {children}
      {tip.element}
    </span>
  );
}

/** Small helpers so every chart's hover reads the same way. */
export function TipTitle({ children }) {
  return <div className="font-semibold text-ink-primary">{children}</div>;
}
export function TipRow({ children }) {
  return <div className="whitespace-nowrap tabular-nums">{children}</div>;
}
