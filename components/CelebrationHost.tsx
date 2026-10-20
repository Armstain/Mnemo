import React from 'react';
import { AccessibilityInfo, Pressable, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { Text } from '@/components/ui/Text';
import { useReduceMotion } from '@/hooks/use-accessibility-motion';
import { useThemeColors } from '@/hooks/use-theme';
import { onCelebrate, type Celebration } from '@/lib/done';
import { playDone } from '@/utils/done-haptics';
import { EASE_OUT } from '@/utils/motion';

// A task finished. Mnemo's mark is an open ring, a loop not yet closed;
// finishing something closes it. The ring's two ends meet (with ticks in
// the hand as they near and one firm confirm as they touch), a check draws
// inside, and a ripple and a few sparks leave the edge. Then it gets out of
// the way: the whole thing is under two seconds, and a tap ends it sooner.

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

// The ring, drawn the way OpenRing draws the mark.
const SIZE = 136;
const C = SIZE / 2;
const STROKE = SIZE * 0.11;
const R = C - STROKE / 2 - SIZE * 0.02;
const CIRC = 2 * Math.PI * R;
/** The open mark's arc covers 294° of the circle, starting at -12°. */
const OPEN = 294 / 360;
/** The dot that escaped the ring, sitting in its opening. */
const DOT_ANGLE = (-45 * Math.PI) / 180;
const DOT_OUT = STROKE * 0.15;

const CHECK_POINTS = [
  [C - R * 0.42, C + R * 0.02],
  [C - R * 0.1, C + R * 0.34],
  [C + R * 0.46, C - R * 0.3],
];
const CHECK = `M ${CHECK_POINTS.map((p) => p.join(' ')).join(' L ')}`;
const CHECK_LEN = CHECK_POINTS.slice(1).reduce(
  (sum, [x, y], i) => sum + Math.hypot(x - CHECK_POINTS[i][0], y - CHECK_POINTS[i][1]),
  0,
);

// The timeline, in ms from the moment the task is done.
const ENTER_MS = 160;
const CLOSE_AT = 120;
const CLOSE_MS = 440;
const LANDED = CLOSE_AT + CLOSE_MS;
const CHECK_MS = 260;
const BURST_MS = 650;
const TEXT_AT = LANDED + 80;
const LEAVE_AT = 1900;
const LEAVE_MS = 220;

/** Closing feels deliberate: slow start, quick into the join. */
const EASE_CLOSE = Easing.bezier(0.6, 0, 0.4, 1);

const SPARKS = Array.from({ length: 10 }, (_, i) => ({
  angle: ((i * 36 + 9) * Math.PI) / 180,
  distance: SIZE * (0.62 + 0.1 * (i % 3)),
  size: 5 + (i % 2) * 2,
}));

/** Mounted once at the app root, above everything; plays when lib/done's celebrate() is called. */
export function CelebrationHost() {
  const [current, setCurrent] = React.useState<(Celebration & { id: number }) | null>(null);
  React.useEffect(() => onCelebrate((c) => setCurrent({ ...c, id: Date.now() })), []);
  if (!current) return null;
  return <CelebrationView key={current.id} celebration={current} onGone={() => setCurrent(null)} />;
}

function CelebrationView({ celebration, onGone }: { celebration: Celebration; onGone: () => void }) {
  const colors = useThemeColors();
  const reduceMotion = useReduceMotion();
  const veil = useSharedValue(0);
  const close = useSharedValue(reduceMotion ? 1 : 0);
  const check = useSharedValue(reduceMotion ? 1 : 0);
  const burst = useSharedValue(0);
  const text = useSharedValue(reduceMotion ? 1 : 0);
  const leaving = React.useRef(false);

  const leave = React.useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    veil.value = withTiming(0, { duration: LEAVE_MS, easing: EASE_OUT });
    setTimeout(onGone, LEAVE_MS);
  }, [onGone, veil]);

  React.useEffect(() => {
    veil.value = withTiming(1, { duration: ENTER_MS, easing: EASE_OUT });
    if (!reduceMotion) {
      close.value = withDelay(CLOSE_AT, withTiming(1, { duration: CLOSE_MS, easing: EASE_CLOSE }));
      check.value = withDelay(LANDED, withTiming(1, { duration: CHECK_MS, easing: EASE_OUT }));
      burst.value = withDelay(LANDED, withTiming(1, { duration: BURST_MS, easing: EASE_OUT }));
      text.value = withDelay(TEXT_AT, withTiming(1, { duration: 240, easing: EASE_OUT }));
    }
    const stopHaptics = playDone({ start: CLOSE_AT, duration: CLOSE_MS, ticks: 3, reduceMotion });
    AccessibilityInfo.announceForAccessibility(`Done: ${celebration.title}`);
    const timer = setTimeout(leave, LEAVE_AT);
    return () => {
      stopHaptics();
      clearTimeout(timer);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const veilStyle = useAnimatedStyle(() => ({ opacity: veil.value }));
  const markStyle = useAnimatedStyle(() => ({ transform: [{ scale: 0.9 + 0.1 * veil.value }] }));
  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: CIRC * (1 - (OPEN + (1 - OPEN) * close.value)),
  }));
  // The escaped dot drops back onto the ring, where the closing arc takes it in.
  const dotProps = useAnimatedProps(() => {
    const r = R + DOT_OUT * (1 - Math.min(1, close.value * 2));
    return { cx: C + r * Math.cos(DOT_ANGLE), cy: C + r * Math.sin(DOT_ANGLE) };
  });
  const checkProps = useAnimatedProps(() => ({ strokeDashoffset: CHECK_LEN * (1 - check.value) }));
  const rippleStyle = useAnimatedStyle(() => ({
    opacity: burst.value === 0 ? 0 : 0.35 * (1 - burst.value),
    transform: [{ scale: 1 + 0.6 * burst.value }],
  }));
  const textStyle = useAnimatedStyle(() => ({
    opacity: text.value,
    transform: [{ translateY: 8 * (1 - text.value) }],
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.layer, { backgroundColor: colors.hero }, veilStyle]}>
      <Pressable
        onPress={leave}
        accessibilityRole="button"
        accessibilityLabel={`Done: ${celebration.title}. Tap to close.`}
        style={styles.fill}
      >
        <Animated.View style={[styles.mark, markStyle]}>
          {!reduceMotion ? (
            <>
              <Animated.View
                pointerEvents="none"
                style={[styles.ripple, { borderColor: colors.heroAccent }, rippleStyle]}
              />
              {SPARKS.map((s, i) => (
                <Spark key={i} spark={s} burst={burst} color={i % 3 === 2 ? colors.accentWarm : colors.heroAccent} />
              ))}
            </>
          ) : null}
          <Svg width={SIZE} height={SIZE}>
            <AnimatedCircle
              cx={C}
              cy={C}
              r={R}
              stroke={colors.heroAccent}
              strokeWidth={STROKE}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${CIRC} ${CIRC}`}
              transform={`rotate(-12 ${C} ${C})`}
              animatedProps={ringProps}
            />
            <AnimatedCircle r={STROKE / 2} fill={colors.heroAccent} animatedProps={dotProps} />
            <AnimatedPath
              d={CHECK}
              stroke={colors.onHero}
              strokeWidth={STROKE * 0.62}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              strokeDasharray={`${CHECK_LEN} ${CHECK_LEN}`}
              animatedProps={checkProps}
            />
          </Svg>
        </Animated.View>

        <Animated.View style={[styles.words, textStyle]}>
          <Text className="font-sans-semi text-xs uppercase tracking-caps" style={{ color: colors.heroAccent }}>
            Done
          </Text>
          <Text
            className="font-display text-center leading-tight mt-2"
            style={{ color: colors.onHero, fontSize: 26, letterSpacing: -0.3 }}
            numberOfLines={3}
          >
            {celebration.title}
          </Text>
          {celebration.detail ? (
            <Text className="font-sans text-sm mt-2" style={{ color: colors.onHeroMuted }}>
              {celebration.detail}
            </Text>
          ) : null}
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

/** One spark leaving the ring's edge as it closes. */
function Spark({
  spark,
  burst,
  color,
}: {
  spark: (typeof SPARKS)[number];
  burst: SharedValue<number>;
  color: string;
}) {
  const style = useAnimatedStyle(() => {
    const travel = R + (spark.distance - R) * burst.value;
    return {
      opacity: burst.value === 0 ? 0 : 1 - burst.value,
      transform: [
        { translateX: Math.cos(spark.angle) * travel },
        { translateY: Math.sin(spark.angle) * travel },
        { scale: 1 - 0.5 * burst.value },
      ],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.spark,
        { width: spark.size, height: spark.size, marginLeft: -spark.size / 2, marginTop: -spark.size / 2, backgroundColor: color },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  layer: { zIndex: 100, elevation: 100 },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  mark: { width: SIZE, height: SIZE },
  ripple: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 2,
  },
  spark: { position: 'absolute', left: C, top: C, borderRadius: 999 },
  words: { alignItems: 'center', marginTop: 28, maxWidth: 320 },
});
