/**
 * The painting behind the top of the findings page: Kano Tsunenobu's "Mount Fuji in the
 * Autumn" (ink and light colour on silk, The Walters Art Museum, via Unsplash), credited in
 * the footer. It fades into the page colour before the first chart, so it never sits behind
 * the data. Decoration only; it ignores the pointer and screen readers.
 *
 * App.jsx draws it outside the page wrapper, because the wrapper is briefly transformed
 * while a page animates in, which would clip a full-width background to the content column.
 */
export default function FindingsBackdrop() {
  return <div aria-hidden className="findings-backdrop pointer-events-none absolute inset-x-0 top-0 -z-10 h-[40rem] sm:h-[46rem]" />;
}
