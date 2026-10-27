import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { useReduceMotion } from '@/hooks/use-accessibility-motion';
import { useThemeColors } from '@/hooks/use-theme';
import {
  loadFlightPerformance,
  onFlight,
  onFlightTarget,
  recordFlight,
  type Flight,
} from '@/lib/card-flight';
import { EASE_OUT } from '@/utils/motion';

// The Resume card opening into its thread (see lib/card-flight). A copy of
// the card grows from where it sat to the whole screen, turning from the
// lit green to paper as it goes, while its title glides and grows into the
// thread's title. Near the end the copy fades, and the real screen, which
// mounted underneath, is already in place.

/** The whole flight. Long enough to follow the title, short enough not to wait on. */
const FLIGHT_MS = 480;
/** The card's own size and corner, as PulseHome draws it. */
const CARD_RADIUS = 30;
const CARD_TITLE_SIZE = 24;
const THREAD_TITLE_SIZE = 32;
const THREAD_TITLE_TRACKING = -0.4;

export function CardFlightHost() {
  const [flight, setFlight] = React.useState<(Flight & { key: number }) | null>(null);
  const reduceMotion = useReduceMotion();

  React.useEffect(() => {
    loadFlightPerformance();
    return onFlight((f) => setFlight({ ...f, key: Date.now() }));
  }, []);

  if (!flight || reduceMotion) return null;
  return <FlightView key={flight.key} flight={flight} onGone={() => setFlight(null)} />;
}

function FlightView({ flight, onGone }: { flight: Flight; onGone: () => void }) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  // Where things are (eased: quick to leave, gentle to land) and how far
  // through the flight it is (even), which the fades follow.
  const p = useSharedValue(0);
  const t = useSharedValue(0);
  const finishRef = React.useRef((_total: number, _frames: number) => {});
  // Stable for the UI thread to call back; reads the latest finish.
  const finish = React.useCallback((t: number, f: number) => finishRef.current(t, f), []);
  // Where the thread's title sits: a guess from its layout until the
  // screen says (the header row, then the ring row, then the title).
  const targetX = useSharedValue(24);
  const targetY = useSharedValue(Math.max(insets.top, 12) + 4 + 52 + 12 + 56);
  // How wide the thread's title is, so the landing copy breaks its lines
  // where the real title does.
  const [targetWidth, setTargetWidth] = React.useState(width - 48);

  // Frame pacing while it flies, on the UI thread, to tell a phone that
  // can't keep up (lib/card-flight decides).
  const lastFrame = useSharedValue(0);
  const total = useSharedValue(0);
  const frames = useSharedValue(0);
  const pacing = useFrameCallback((info) => {
    'worklet';
    if (lastFrame.value === 0) {
      // The first frame drawn after the thread screen mounted: start the
      // clock now, so a slow mount delays the flight instead of eating it.
      p.value = withTiming(1, { duration: FLIGHT_MS, easing: EASE_OUT });
      t.value = withTiming(1, { duration: FLIGHT_MS, easing: Easing.linear }, (done) => {
        if (done) runOnJS(finish)(total.value, frames.value);
      });
    } else {
      total.value += info.timestamp - lastFrame.value;
      frames.value += 1;
    }
    lastFrame.value = info.timestamp;
  }, false);

  React.useEffect(() => {
    const off = onFlightTarget((threadId, rect) => {
      if (threadId !== flight.threadId) return;
      targetX.value = rect.x;
      targetY.value = rect.y;
      setTargetWidth(rect.width);
    });
    finishRef.current = (frameTotal: number, frameCount: number) => {
      pacing.setActive(false);
      recordFlight(frameTotal, frameCount);
      onGone();
    };
    pacing.setActive(true);
    return off;
    // One flight per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { from, titleFrom } = flight;
  const hero = colors.hero;
  const paper = colors.bg;

  const cardStyle = useAnimatedStyle(() => ({
    left: interpolate(p.value, [0, 1], [from.x, 0]),
    top: interpolate(p.value, [0, 1], [from.y, 0]),
    width: interpolate(p.value, [0, 1], [from.width, width]),
    height: interpolate(p.value, [0, 1], [from.height, height]),
    borderRadius: interpolate(p.value, [0, 1], [CARD_RADIUS, 0]),
    // Green while it grows, then a quick turn to paper: a slow blend of the
    // two passes through a muddy grey.
    backgroundColor: interpolateColor(t.value, [0.35, 0.6], [hero, paper]),
    // The real screen is in place underneath; hand over to it at the end.
    opacity: interpolate(t.value, [0.7, 1], [1, 0], Extrapolation.CLAMP),
  }));

  const chipStyle = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.25], [1, 0], Extrapolation.CLAMP),
  }));

  const scale = THREAD_TITLE_SIZE / CARD_TITLE_SIZE;
  const titleStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(p.value, [0, 1], [titleFrom.x, targetX.value]) },
      { translateY: interpolate(p.value, [0, 1], [titleFrom.y, targetY.value]) },
      { scale: interpolate(p.value, [0, 1], [1, scale]) },
    ],
    // Fades with the card, onto the real title in the same place.
    opacity: interpolate(t.value, [0.7, 1], [1, 0], Extrapolation.CLAMP),
  }));
  // The title changes ink with the card: light on green, dark on paper.
  const onHeroInk = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0.35, 0.6], [1, 0], Extrapolation.CLAMP),
  }));
  const paperInk = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0.35, 0.6], [0, 1], Extrapolation.CLAMP),
  }));

  const title = (color: string, letterSpacing: number) => (
    <Text className="font-display leading-tight" style={{ color, fontSize: CARD_TITLE_SIZE, letterSpacing }} numberOfLines={2}>
      {flight.title}
    </Text>
  );

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[styles.card, cardStyle]}>
        {flight.chip ? (
          <Animated.View style={[styles.chip, { backgroundColor: colors.heroSoft }, chipStyle]}>
            <Text className="font-sans-semi text-sm" style={{ color: colors.heroAccent }} numberOfLines={1}>
              {flight.chip}
            </Text>
          </Animated.View>
        ) : null}
      </Animated.View>
      {/* Two copies: on the card's line width as it leaves, on the thread
          title's as it lands (before the scale), crossfading on the way. */}
      <Animated.View style={[styles.title, titleStyle]}>
        <Animated.View style={[{ width: titleFrom.width }, onHeroInk]}>{title(colors.onHero, 0)}</Animated.View>
        {/* The thread title's width and tracking, before the scale. */}
        <Animated.View style={[styles.landing, { width: targetWidth / scale }, paperInk]}>
          {title(colors.fg, THREAD_TITLE_TRACKING / scale)}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { position: 'absolute', overflow: 'hidden' },
  chip: {
    position: 'absolute',
    top: 20,
    left: 20,
    height: 28,
    paddingHorizontal: 12,
    borderRadius: 14,
    justifyContent: 'center',
  },
  // Grows from its top left, like the text it becomes.
  title: { position: 'absolute', left: 0, top: 0, transformOrigin: 'top left' },
  landing: { position: 'absolute', left: 0, top: 0 },
});
