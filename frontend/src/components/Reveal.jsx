import { EASE } from "../lib/motion.js";

/**
 * Opens and closes its content by animating the height, so whatever sits below glides
 * instead of jumping. Used for the optional sections of the preapproval form and for the
 * research guide's sources. Closed content stays mounted but is inert, so it can't be
 * tabbed into.
 */
export default function Reveal({ open, children }) {
  return (
    <div
      className="grid"
      style={{
        gridTemplateRows: open ? "1fr" : "0fr",
        opacity: open ? 1 : 0,
        transition: `grid-template-rows 450ms ${EASE}, opacity 300ms ease`,
      }}
      inert={open ? undefined : ""}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
