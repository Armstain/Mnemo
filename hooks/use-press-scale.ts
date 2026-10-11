import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useReduceMotion } from '@/hooks/use-accessibility-motion';

export { Animated };

const DOWN = { damping: 20, stiffness: 420, mass: 0.5 };
const UP = { damping: 12, stiffness: 320, mass: 0.5 };

/**
 * The app's one press feel: a control gives a little under the finger and
 * springs back. Runs on the UI thread (a transform only), and does nothing
 * under Reduce Motion. Spread the handlers on a Pressable and put `style`
 * on the Animated.View that draws the control.
 *
 *   const press = usePressScale();
 *   <Pressable onPressIn={press.onPressIn} onPressOut={press.onPressOut}>
 *     <Animated.View style={[styles.pill, press.style]}>…</Animated.View>
 *   </Pressable>
 */
export function usePressScale(to = 0.96) {
  const reduceMotion = useReduceMotion();
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return {
    style,
    onPressIn: () => {
      if (!reduceMotion) scale.value = withSpring(to, DOWN);
    },
    onPressOut: () => {
      if (!reduceMotion) scale.value = withSpring(1, UP);
    },
    /** A one-off pop, for a state the press just turned on (a chip, a checkbox). */
    pop: () => {
      if (reduceMotion) return;
      scale.value = withSequence(withTiming(0.88, { duration: 80 }), withSpring(1, { damping: 8, stiffness: 300, mass: 0.5 }));
    },
  };
}
