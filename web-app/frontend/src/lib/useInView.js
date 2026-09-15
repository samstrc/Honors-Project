import { useEffect, useRef, useState } from "react";

/**
 * True once the element has scrolled into view, then stays true. Used by the chart
 * components to animate bars/lines in on first reveal instead of on every re-render.
 *
 * Pulled out because RateBarChart, FactorChart and DistributionChart each had an
 * identical copy of this useState + useEffect + IntersectionObserver block.
 */
export default function useInView(threshold = 0.2) {
  const [visible, setVisible] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const obs = new IntersectionObserver(([entry]) => entry.isIntersecting && setVisible(true), {
      threshold,
    });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [ref, visible];
}
