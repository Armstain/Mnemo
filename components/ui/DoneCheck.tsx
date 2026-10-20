import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { Icon } from '@/components/ui/Icon';
import { useReduceMotion } from '@/hooks/use-accessibility-motion';
import { useThemeColors } from '@/hooks/use-theme';
import { playDone } from '@/utils/done-haptics';
import { EASE_OUT } from '@/utils/motion';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** How long the ring takes to close; the step is marked done once it has. */
const CLOSE_MS = 260;
/** A beat after closing, so the filled check is seen before the step moves on. */
const SETTLE_MS = 140;
const OPEN = 294 / 360;
const EASE_CLOSE = Easing.bezier(0.6, 0, 0.4, 1);

/**
 * The check that marks a next step done. Tapped, it fills, a thin ring
 * closes around it (the mark's open loop, closing) with a tick and a
 * confirm in the hand, and only then calls `onDone`, so the step leaves
 * after you've seen it land.
 */
export function DoneCheck({
  onDone,
  label,
  size = 40,
  restColor,
}: {
  onDone: () => void;
  label: string;
  size?: number;
  /** The button's colour before it's tapped. */
  restColor: string;
}) {
  const colors = useThemeColors();
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(0);
  const pop = useSharedValue(1);
  const busy = React.useRef(false);

  const ring = size + 10;
  const stroke = 2.5;
  const r = ring / 2 - stroke;
  const circ = 2 * Math.PI * r;

  const press = () => {
    if (busy.current) return;
    busy.current = true;
    playDone({ start: 0, duration: reduceMotion ? 0 : CLOSE_MS, ticks: 1, reduceMotion });
    if (reduceMotion) {
      progress.value = 1;
    } else {
      progress.value = withTiming(1, { duration: CLOSE_MS, easing: EASE_CLOSE });
      pop.value = withSequence(
        withTiming(0.9, { duration: 90, easing: EASE_OUT }),
        withTiming(1.12, { duration: CLOSE_MS - 90, easing: EASE_OUT }),
        withTiming(1, { duration: SETTLE_MS, easing: EASE_OUT }),
      );
    }
    setTimeout(
      () => {
        busy.current = false;
        onDone();
        progress.value = 0;
      },
      reduceMotion ? 0 : CLOSE_MS + SETTLE_MS,
    );
  };

  const buttonStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const fillStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, progress.value * 2),
    transform: [{ scale: 0.4 + 0.6 * Math.min(1, progress.value * 1.6) }],
  }));
  const ringStyle = useAnimatedStyle(() => ({ opacity: progress.value === 0 ? 0 : 1 }));
  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: circ * (1 - (OPEN + (1 - OPEN) * progress.value)),
  }));

  return (
    <Pressable
      onPress={press}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ width: size, height: size }}
    >
      <Animated.View style={[styles.center, { width: size, height: size }, buttonStyle]}>
        <Animated.View pointerEvents="none" style={[styles.ring, { width: ring, height: ring, margin: -5 }, ringStyle]}>
          <Svg width={ring} height={ring}>
            <AnimatedCircle
              cx={ring / 2}
              cy={ring / 2}
              r={r}
              stroke={colors.accent}
              strokeWidth={stroke}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${circ} ${circ}`}
              transform={`rotate(-12 ${ring / 2} ${ring / 2})`}
              animatedProps={ringProps}
            />
          </Svg>
        </Animated.View>
        <View style={[styles.disc, { width: size, height: size, backgroundColor: restColor }]}>
          <Icon name="check" size={size * 0.45} stroke={2.2} color={colors.accent} />
        </View>
        <Animated.View style={[styles.disc, styles.over, { width: size, height: size, backgroundColor: colors.accent }, fillStyle]}>
          <Icon name="check" size={size * 0.45} stroke={2.6} color={colors.accentInk} />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', left: 0, top: 0 },
  disc: { borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  over: { position: 'absolute', left: 0, top: 0 },
});
