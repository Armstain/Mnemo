import { useEffect, useRef, useState } from 'react';

import { useReduceMotion } from '@/hooks/use-accessibility-motion';

/**
 * A number that eases to its new value (from 0 the first time) instead of
 * jumping. Only runs when `target` changes, for about 600ms; under Reduce
 * Motion it's simply `target`.
 */
export function useCountUp(target: number, durationMs = 600): number {
  const reduceMotion = useReduceMotion();
  const [value, setValue] = useState(reduceMotion ? target : 0);
  const from = useRef(reduceMotion ? target : 0);

  useEffect(() => {
    if (reduceMotion) {
      setValue(target);
      from.current = target;
      return;
    }
    const start = from.current;
    const began = Date.now();
    let frame = 0;
    const tick = () => {
      const t = Math.min(1, (Date.now() - began) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = start + (target - start) * eased;
      setValue(next);
      from.current = next;
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs, reduceMotion]);

  return value;
}
