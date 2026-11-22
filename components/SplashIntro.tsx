import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { Text } from '@/components/ui/Text';
import { useThemeName } from '@/hooks/use-theme';
import { PALETTE } from '@/utils/palette';
import { useReduceMotion } from '@/hooks/use-accessibility-motion';
import { EASE_IN_OUT, EASE_OUT } from '@/utils/motion';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const RING = 'M58.32 10.87 A40 40 0 1 0 89.13 41.68';
const RING_LENGTH = 206;
const DOT = { light: '#63AA8F', dark: '#A9F0CC' };
const POP = Easing.bezier(0.34, 1.56, 0.64, 1);

export function SplashIntro() {
  const theme = useThemeName();
  const reduce = useReduceMotion();
  const [done, setDone] = useState(Platform.OS === 'web');
  const ring = useSharedValue(0);
  const core = useSharedValue(0);
  const moon = useSharedValue(0);
  const word = useSharedValue(0);
  const line = useSharedValue(0);
  const fade = useSharedValue(1);

  useEffect(() => {
    if (done) return;
    const finish = (f?: boolean) => {
      'worklet';
      if (f) runOnJS(setDone)(true);
    };
    if (reduce) {
      ring.value = core.value = moon.value = word.value = line.value = 1;
      fade.value = withDelay(600, withTiming(0, { duration: 200 }, finish));
      return;
    }
    ring.value = withTiming(1, { duration: 700, easing: EASE_OUT });
    core.value = withDelay(280, withTiming(1, { duration: 420, easing: POP }));
    moon.value = withDelay(520, withTiming(1, { duration: 380, easing: POP }));
    word.value = withDelay(560, withTiming(1, { duration: 460, easing: EASE_OUT }));
    line.value = withDelay(700, withTiming(1, { duration: 460, easing: EASE_OUT }));
    fade.value = withDelay(1450, withTiming(0, { duration: 300, easing: EASE_IN_OUT }, finish));
  }, []);

  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: RING_LENGTH * (1 - ring.value) }));
  const coreProps = useAnimatedProps(() => ({ r: 16 * core.value }));
  const moonProps = useAnimatedProps(() => ({ r: 8 * moon.value }));
  const root = useAnimatedStyle(() => ({ opacity: fade.value }));
  const logo = useAnimatedStyle(() => ({ transform: [{ rotate: `${-60 * (1 - ring.value)}deg` }] }));
  const wordStyle = useAnimatedStyle(() => ({ opacity: word.value, transform: [{ translateY: 12 * (1 - word.value) }] }));
  const lineStyle = useAnimatedStyle(() => ({ opacity: line.value, transform: [{ translateY: 10 * (1 - line.value) }] }));

  if (done) return null;
  const c = PALETTE[theme];

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: c.bg }, root]}>
      <Animated.View style={logo}>
        <Svg width={88} height={88} viewBox="0 0 100 100">
          <AnimatedPath
            d={RING}
            stroke={c.accent}
            strokeWidth={16}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={RING_LENGTH}
            animatedProps={ringProps}
          />
          <AnimatedCircle cx={50} cy={50} fill={DOT[theme]} animatedProps={coreProps} />
          <AnimatedCircle cx={80} cy={20} fill={DOT[theme]} animatedProps={moonProps} />
        </Svg>
      </Animated.View>
      <View style={styles.words}>
        <Animated.View style={wordStyle}>
          <Text className="font-display" style={[styles.name, { color: c.fg }]}>Mnemo</Text>
        </Animated.View>
        <Animated.View style={lineStyle}>
          <Text className="font-sans-medium" style={[styles.tagline, { color: c.fgTertiary }]}>RESUME YOUR LIFE</Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center', zIndex: 1000, elevation: 1000 },
  words: { alignItems: 'center', marginTop: 28 },
  name: { fontSize: 34, lineHeight: 42, letterSpacing: -0.5 },
  tagline: { fontSize: 11, letterSpacing: 2.4, marginTop: 6 },
});
