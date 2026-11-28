import { useInView, EASE } from "../lib/motion.js";

/**
 * "N in 100": a 10x10 grid of applicants with the first `count` marked. The plainest way
 * to make a base rate feel like people rather than a percentage.
 *
 * On first view the grid fades in row by row, then the marked dots color in one at a
 * time, so the eye lands on the population first and the exception second. On a phone the
 * caption sits beside the grid rather than under it.
 */
export default function Waffle({ count, label }) {
  const [ref, inView] = useInView(0.3);
  return (
    <figure ref={ref} className="flex items-center gap-5 sm:block">
      <div className="grid w-fit shrink-0 grid-cols-10 gap-[5px]" role="img" aria-label={label}>
        {Array.from({ length: 100 }, (_, i) => {
          const row = Math.floor(i / 10);
          const hit = i < count;
          return (
            <span
              key={i}
              className="h-[11px] w-[11px] rounded-full"
              style={{
                background: hit && inView ? "var(--cat-2)" : "var(--gridline)",
                opacity: inView ? 1 : 0,
                transform: inView ? "scale(1)" : "scale(0.4)",
                transition: `opacity 350ms ease ${row * 40}ms, transform 500ms ${EASE} ${row * 40}ms, background-color 400ms ease ${hit ? 600 + i * 90 : 0}ms`,
              }}
            />
          );
        })}
      </div>
      <figcaption className="max-w-[11rem] text-[0.875rem] sm:mt-3 leading-snug text-ink-secondary">{label}</figcaption>
    </figure>
  );
}
