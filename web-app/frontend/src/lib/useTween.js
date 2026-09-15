import { useEffect, useRef, useState } from "react";

/**
 * Eases a number from wherever it currently is to `target` over `duration` ms. Used for
 * figures that change in place (the live estimate) so the eye can follow the move
 * instead of seeing a jump. `null` targets are passed through untouched. If `initial`
 * is a number, the very first real value counts up from it instead of appearing.
 */
export default function useTween(target, duration = 550, initial = null) {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);

  useEffect(() => {
    if (target === null || target === undefined) {
      fromRef.current = target;
      setValue(target);
      return undefined;
    }
    if (fromRef.current === null || fromRef.current === undefined) {
      if (initial === null) {
        fromRef.current = target;
        setValue(target);
        return undefined;
      }
      fromRef.current = initial;
    }
    const from = fromRef.current;
    const start = performance.now();
    let frame;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = from + (target - from) * eased;
      fromRef.current = v;
      setValue(v);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);

  return value;
}
