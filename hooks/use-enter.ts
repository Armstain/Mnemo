import { useMemo } from 'react';
import { LinearTransition } from 'react-native-reanimated';

import { useReduceMotion } from '@/hooks/use-accessibility-motion';
import { DUR_BASE, EASE_OUT, EXIT_QUICK, REDUCED, SPRING_NAV } from '@/utils/motion';

const POP_SCALE = 0.97;

/**
 * One source for every "content appears on screen" animation, because the
 * three things that go wrong are all things a call site shouldn't have to
 * remember: the easing (see EASE_OUT), the duration budget, and Reduce Motion.
 *
 * Cascade delays are an index into a three-step scale, not a free number:
 * the last step lands at 120ms, so a header/control/body screen is fully
 * settled at DUR_BASE + 120 = 360ms.
 */
const STEP_MS = [0, 60, 120];

function stepDelay(step: number) {
  return STEP_MS[Math.min(Math.max(step, 0), STEP_MS.length - 1)];
}

/** Rows stagger 40ms apart, and stop staggering after the sixth — an
 *  uncapped `index * 40` leaves row 30 waiting 1.2s for its own list. */
const ROW_STAGGER_MS = 40;
const ROW_STAGGER_CAP = 6;

/** Rows sliding to a new place: the nav spring's feel, as a layout transition. */
const ROW_REFLOW = LinearTransition.springify()
  .damping(SPRING_NAV.damping)
  .stiffness(SPRING_NAV.stiffness)
  .mass(SPRING_NAV.mass);

type EnterProps = {
  from: Record<string, number>;
  animate: Record<string, number>;
  transition: Record<string, unknown>;
};

function flat(delay: number): EnterProps {
  return {
    from: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { ...REDUCED, delay },
  };
}

function timed(
  from: Record<string, number>,
  animate: Record<string, number>,
  delay: number,
  duration: number,
): EnterProps {
  return {
    from: { opacity: 0, ...from },
    animate: { opacity: 1, ...animate },
    transition: { type: 'timing' as const, duration, delay, easing: EASE_OUT },
  };
}

/**
 * Entrance builders, Reduce-Motion aware. One hook call per screen:
 *
 *   const enter = useEnter();
 *   <MotiView {...enter.rise(0)}>   // header
 *   <MotiView {...enter.pop(1)}>    // search field
 *   <MotiView {...enter.fade(2)}>   // filters
 *   <MotiView {...enter.row(i)}>    // a list row
 *
 * Under Reduce Motion every builder collapses to the same 120ms opacity
 * fade with no travel and no stagger.
 */
export function useEnter() {
  const reduceMotion = useReduceMotion();

  return useMemo(
    () => ({
      /** Content that rises into place — headers, cards, body sections. */
      rise(step = 0, distance = 12): EnterProps {
        const delay = stepDelay(step);
        return reduceMotion
          ? flat(delay)
          : timed({ translateY: distance }, { translateY: 0 }, delay, DUR_BASE);
      },

      /** Opacity only — filter rows, secondary chrome, anything already in place. */
      fade(step = 0): EnterProps {
        const delay = stepDelay(step);
        return reduceMotion ? flat(delay) : timed({}, {}, delay, DUR_BASE);
      },

      /** A control settling in — search fields, inputs. Never scales from 0. */
      pop(step = 0): EnterProps {
        const delay = stepDelay(step);
        return reduceMotion
          ? flat(delay)
          : timed({ scale: POP_SCALE }, { scale: 1 }, delay, DUR_BASE);
      },

      /**
       * A list row. `stagger: false` for query-driven results — a set that
       * changes on every keystroke has no first paint to stagger, and a row
       * arriving 200ms after the result count reads as lag, not polish.
       */
      row(index = 0, { stagger = true }: { stagger?: boolean } = {}): EnterProps {
        const delay =
          stagger && !reduceMotion ? Math.min(index, ROW_STAGGER_CAP) * ROW_STAGGER_MS : 0;
        return reduceMotion
          ? flat(0)
          : timed({ translateY: 8 }, { translateY: 0 }, delay, DUR_BASE);
      },

      /**
       * How a row leaves when it's deleted. Slides toward the trailing edge
       * rather than reversing its entrance — an entrance is "here it is", a
       * deletion is "it's gone", and those shouldn't look like the same
       * event played backwards. Needs an <AnimatePresence> ancestor.
       */
      rowExit() {
        return reduceMotion
          ? { exit: { opacity: 0 }, exitTransition: REDUCED }
          : { exit: { opacity: 0, translateX: 32 }, exitTransition: EXIT_QUICK };
      },

      /**
       * How a row moves when the list around it changes: it slides to its
       * new place instead of jumping there. Under Reduce Motion it just
       * appears there.
       */
      reflow() {
        return reduceMotion ? {} : { layout: ROW_REFLOW };
      },
    }),
    [reduceMotion],
  );
}
