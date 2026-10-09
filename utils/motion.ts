import { useMemo } from 'react';
import { Easing } from 'react-native-reanimated';

import { useReduceMotion } from '@/hooks/use-accessibility-motion';

/**
 * Strong ease-out for anything entering or exiting. Reanimated's own default
 * for `withTiming` is `inOut(quad)`, which starts slow like an ease-in — that
 * delays the exact moment the user is watching. Every timing transition in
 * this app therefore passes an easing explicitly; none rely on the default.
 */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/** Symmetric ease for on-screen movement that isn't an entrance/exit. */
export const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);

/** iOS sheet curve — for anything entering with sheet-like weight. */
export const EASE_SHEET = Easing.bezier(0.32, 0.72, 0, 1);

/**
 * Named duration scale. UI motion stays under 300ms — DUR_SLOW is for
 * *ambient* motion (breathing halos, loops) only, never a screen entrance.
 */
export const DUR_FAST = 140;
export const DUR_BASE = 240;
export const DUR_SLOW = 420;

/** Toggles, chips, disclosures — a small state change the user just caused. */
export const DUR_TOGGLE = 200;

/** Press feedback. 120ms / 3% is the ceiling for something touched all day. */
export const DUR_PRESS = 120;
export const PRESS_SCALE = 0.97;

/** Breathing-halo cadence for the record affordance — idle vs. actively recording. */
export const RECORD_HALO_IDLE_MS = 3200;
export const RECORD_HALO_ACTIVE_MS = 1400;

/**
 * ─── Spring vocabulary ──────────────────────────────────────────
 * Physics beats duration for anything the user directly caused: a spring
 * settles at its own pace, absorbs interruption, and reads as an object
 * moving rather than a value being tweened. Timing curves stay for
 * ambient/entrance motion the user didn't trigger.
 *
 * All three are critically-ish damped — no visible overshoot beyond a few
 * percent. Mnemo is a memory tool; bouncy reads unserious.
 */

/** Navigation — tab indicator travel, menu pops, icon swaps. Settles ~280ms. */
export const SPRING_NAV = {
  type: 'spring' as const,
  damping: 18,
  stiffness: 220,
  mass: 0.6,
};

/** Press/release feedback on a tap target. Snappier than nav. */
export const SPRING_PRESS = {
  type: 'spring' as const,
  damping: 20,
  stiffness: 380,
  mass: 0.5,
};

/** Sheets, toasts, anything with weight entering the screen. */
export const SPRING_SHEET = {
  type: 'spring' as const,
  damping: 22,
  stiffness: 180,
  mass: 0.9,
};

/**
 * Departures are ~20% quicker than arrivals: the user has finished reading,
 * so the arrival deserves the time and the exit doesn't. Timing rather than
 * spring — nothing is being thrown, so there's no velocity to carry.
 */
export const EXIT_QUICK = {
  type: 'timing' as const,
  duration: 190,
  easing: EASE_OUT,
};

/**
 * Reduced-motion fallback: a 120ms fade-equivalent. Accessibility guidance
 * is to cut *movement*, not feedback — the state change still needs to be
 * perceivable, it just shouldn't travel.
 */
export const REDUCED = {
  type: 'timing' as const,
  duration: 120,
  easing: EASE_OUT,
};

/** Picks the spring or the flat fallback. `motion(SPRING_NAV, reduceMotion)`. */
export function motion<T extends object>(preset: T, reduceMotion: boolean) {
  return reduceMotion ? REDUCED : preset;
}

/**
 * Calm breathing loop — ~4s cycle, matching a relaxed respiratory rate
 * (12–15 breaths/min). Anything faster reads as urgency, which is the
 * opposite of what a recording indicator should convey.
 */
export const BREATHE_DURATION = 2000; // half-cycle; repeatReverse makes it 4s

/**
 * ─── Entrances ──────────────────────────────────────────────────
 *
 * One source for every "content appears on screen" animation, because the
 * three things that go wrong are all things a call site shouldn't have to
 * remember: the easing (see EASE_OUT above), the duration budget, and
 * Reduce Motion.
 *
 * Cascade delays are an index into a three-step scale, not a free number —
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
          : timed({ scale: PRESS_SCALE }, { scale: 1 }, delay, DUR_BASE);
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
    }),
    [reduceMotion],
  );
}
