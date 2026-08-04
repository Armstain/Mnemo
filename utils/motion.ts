import { Easing } from 'react-native-reanimated';

/**
 * Strong ease-out for anything entering or exiting — cubic-bezier(0.23, 1,
 * 0.32, 1). Reanimated's own default for `withTiming` is `inOut(quad)`,
 * which starts slow like an ease-in; that reads as sluggish for content
 * appearing on screen, so entrances/exits should pass this explicitly.
 */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

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

/** Navigation — tab indicator travel, screen slides. Settles ~280ms. */
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
 * Shared list-entrance preset — one recipe instead of a copy per screen.
 * Usage: <MotiView {...enterUp(index)}>…</MotiView>
 */
export function enterUp(index = 0) {
  return {
    from: { opacity: 0, translateY: 8 },
    animate: { opacity: 1, translateY: 0 },
    transition: {
      type: 'timing' as const,
      duration: 260,
      delay: 40 + index * 40,
      easing: EASE_OUT,
    },
  };
}
