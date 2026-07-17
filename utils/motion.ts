import { Easing } from 'react-native-reanimated';

/**
 * Strong ease-out for anything entering or exiting — cubic-bezier(0.23, 1,
 * 0.32, 1). Reanimated's own default for `withTiming` is `inOut(quad)`,
 * which starts slow like an ease-in; that reads as sluggish for content
 * appearing on screen, so entrances/exits should pass this explicitly.
 */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

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
