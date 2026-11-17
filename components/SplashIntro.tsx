import { useEffect, useState } from 'react';
import { Image, Platform, StyleSheet } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { Text } from '@/components/ui/Text';
import { PALETTE, useThemeName } from '@/hooks/use-theme';
import { useReduceMotion } from '@/hooks/use-accessibility-motion';
import { EASE_OUT, EASE_IN_OUT } from '@/utils/motion';

const ICON = { light: require('@/assets/images/splash-icon.png'), dark: require('@/assets/images/splash-icon-dark.png') };

export function SplashIntro() {
  const theme = useThemeName();
  const reduce = useReduceMotion();
  const [done, setDone] = useState(Platform.OS === 'web');
  const lift = useSharedValue(0);
  const word = useSharedValue(0);
  const line = useSharedValue(0);
  const fade = useSharedValue(1);

  useEffect(() => {
    if (done) return;
    if (reduce) {
      fade.value = withDelay(500, withTiming(0, { duration: 200 }, (f) => f && runOnJS(setDone)(true)));
      word.value = 1;
      line.value = 1;
      lift.value = 1;
      return;
    }
    lift.value = withTiming(1, { duration: 520, easing: EASE_OUT });
    word.value = withDelay(140, withTiming(1, { duration: 420, easing: EASE_OUT }));
    line.value = withDelay(260, withTiming(1, { duration: 420, easing: EASE_OUT }));
    fade.value = withDelay(1050, withTiming(0, { duration: 280, easing: EASE_IN_OUT }, (f) => f && runOnJS(setDone)(true)));
  }, []);

  const root = useAnimatedStyle(() => ({ opacity: fade.value }));
  const icon = useAnimatedStyle(() => ({
    transform: [{ translateY: -36 * lift.value }, { scale: 1 - 0.18 * lift.value }],
  }));
  const wordStyle = useAnimatedStyle(() => ({ opacity: word.value, transform: [{ translateY: 10 * (1 - word.value) }] }));
  const lineStyle = useAnimatedStyle(() => ({ opacity: line.value, transform: [{ translateY: 8 * (1 - line.value) }] }));

  if (done) return null;
  const c = PALETTE[theme];

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: c.bg }, root]}>
      <Animated.View style={icon}>
        <Image source={ICON[theme]} style={styles.icon} />
      </Animated.View>
      <Animated.View style={[styles.text, wordStyle]}>
        <Text className="font-display text-display" style={{ color: c.fg }}>Mnemo</Text>
      </Animated.View>
      <Animated.View style={[styles.line, lineStyle]}>
        <Text className="font-sans text-sm" style={{ color: c.fgTertiary }}>Resume your life</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', zIndex: 1000, elevation: 1000 },
  icon: { width: 120, height: 120, resizeMode: 'contain' },
  text: { position: 'absolute', top: '50%', marginTop: 34 },
  line: { position: 'absolute', top: '50%', marginTop: 78 },
});
