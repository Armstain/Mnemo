import { Easing } from 'react-native-reanimated';

/**
 * Strong ease-out for anything entering or exiting. Reanimated's own default
 * for `withTiming` is `inOut(quad)`, which starts slow like an ease-in — that
 * delays the exact moment the user is watching. Every timing transition in
 * this app therefore passes an easing explicitly; none rely on the default.
 */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/** Symmetric ease for on-screen movement that isn't an entrance/exit. */
export const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);

/** Named duration scale. UI motion stays under 300ms. */
export const DUR_FAST = 140;
export const DUR_BASE = 240;

/** Toggles, chips, disclosures — a small state change the user just caused. */
export const DUR_TOGGLE = 200;

/** Breathing-halo cadence for the record affordance — idle vs. actively recording. */
export const RECORD_HALO_IDLE_MS = 3200;
export const RECORD_HALO_ACTIVE_MS = 1400;

/**
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
