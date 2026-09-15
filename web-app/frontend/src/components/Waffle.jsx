import useInView from "../lib/useInView.js";

/**
 * "N in 100" waffle: a 10x10 grid of people, the first `count` of them lit in `color`.
 * The plainest way to make a base rate feel like people rather than a percentage.
 *
 * Dots fade in row by row on first view, then the highlighted ones colour in a beat
 * later, so the eye lands on the population first and the exception second.
 */
export default function Waffle({ count, color = "var(--critical)", label, caption }) {
  const [ref, visible] = useInView();
  const cells = Array.from({ length: 100 }, (_, i) => i);

  return (
    <div ref={ref} className="flex flex-col items-center gap-3 sm:items-end">
      <div
        className="grid grid-cols-10 gap-[5px]"
        role="img"
        aria-label={`${count} of every 100 applicants highlighted`}
      >
        {cells.map((i) => {
          const hit = i < count;
          const row = Math.floor(i / 10);
          return (
            <span
              key={i}
              className="h-[13px] w-[13px] rounded-full sm:h-[14px] sm:w-[14px]"
              style={{
                background: hit && visible ? color : "var(--gridline)",
                opacity: visible ? 1 : 0,
                transform: visible ? "scale(1)" : "scale(0.4)",
                boxShadow: hit && visible ? `0 0 0 3px color-mix(in srgb, ${color} 18%, transparent)` : "none",
                transition: `opacity 400ms ease ${row * 45}ms, transform 500ms cubic-bezier(.16,1,.3,1) ${row * 45}ms, background 500ms ease ${520 + i * 50}ms, box-shadow 500ms ease ${520 + i * 50}ms`,
              }}
            />
          );
        })}
      </div>
      <div className="text-center sm:text-right">
        <div className="text-[0.95rem] font-semibold leading-snug text-ink-primary">{label}</div>
        {caption ? <div className="mt-0.5 text-[0.75rem] text-ink-muted">{caption}</div> : null}
      </div>
    </div>
  );
}
