import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, usePathname } from 'expo-router';

import { useThemeColors, useThemeName } from '@/hooks/use-theme';
import { useReduceMotion } from '@/hooks/use-accessibility-motion';
import { closeCapture, useCaptureActive } from '@/hooks/use-capture-active';
import { Icon, type IconName } from '@/components/ui/Icon';

// Two tabs either side of the capture button (ActionCluster), which sits in
// a notch in the middle of the bar. Search lives inside Library.
const TABS = [
  { name: 'Home', icon: 'home' as IconName, route: '/' },
  { name: 'Library', icon: 'layers' as IconName, route: '/(tabs)/library' },
] as const;

// ─── Geometry ───────────────────────────────────────────────────
// Shared with ActionCluster so the button lands exactly in the notch.

/** Bar height (excludes the gap below it, see navBottom). */
export const NAV_BAR_HEIGHT = 64;
/** Diameter of the capture button. */
export const CAPTURE_BUTTON_SIZE = 56;
/** Diameter of the brand ring around it; the notch is shaped for this. */
export const CAPTURE_RING_SIZE = CAPTURE_BUTTON_SIZE + 14;
const CORNER = 28;
/** Half the notch's opening along the bar's top edge. */
const NOTCH_HALF = 62;
/** How deep the notch dips below the top edge. */
const NOTCH_DEPTH = 34;
/** Space between the ring and the bottom of the notch. */
const NOTCH_GAP = 4;
/** Centre of the button, measured down from the bar's top edge (negative: above it). */
const BUTTON_CENTER_Y = NOTCH_DEPTH - NOTCH_GAP - CAPTURE_RING_SIZE / 2;
/** How far the capture button rises above the bar's top edge. */
export const CENTER_BUTTON_RISE = CAPTURE_BUTTON_SIZE / 2 - BUTTON_CENTER_Y;

/**
 * Distance from the screen's bottom edge to the bar: clear of the system
 * gesture bar / home indicator with room to breathe, so the bar floats
 * instead of resting on it. Everything stacked on the bar uses this too.
 */
export function navBottom(insetBottom: number): number {
  return Math.max(insetBottom + 12, 20);
}

// Scroll-content bottom padding (added to the safe inset) that clears the
// floating bar, its gap above the inset, the button rising out of it, and
// a standard 16dp margin.
export const NAV_CLEARANCE = NAV_BAR_HEIGHT + CENTER_BUTTON_RISE + 12 + 16;
// Kept as its own name for Home.
export const CONTENT_BOTTOM_CLEARANCE = NAV_CLEARANCE;

/** The bar's outline: a rounded rectangle with a smooth bowl in the middle of the top edge. */
function barPath(w: number, h: number): string {
  const cx = w / 2;
  const x1 = cx - NOTCH_HALF;
  const x2 = cx + NOTCH_HALF;
  const bowl = CAPTURE_RING_SIZE / 2 + 2;
  const r = CORNER;
  return [
    `M ${r} 0`,
    `L ${x1} 0`,
    `C ${x1 + 14} 0, ${cx - bowl} ${NOTCH_DEPTH}, ${cx} ${NOTCH_DEPTH}`,
    `C ${cx + bowl} ${NOTCH_DEPTH}, ${x2 - 14} 0, ${x2} 0`,
    `L ${w - r} 0`,
    `A ${r} ${r} 0 0 1 ${w} ${r}`,
    `L ${w} ${h - r}`,
    `A ${r} ${r} 0 0 1 ${w - r} ${h}`,
    `L ${r} ${h}`,
    `A ${r} ${r} 0 0 1 0 ${h - r}`,
    `L 0 ${r}`,
    `A ${r} ${r} 0 0 1 ${r} 0`,
    'Z',
  ].join(' ');
}

/** Each tab sits in the middle of its side of the notch. */
function tabCenters(w: number): [number, number] {
  const left = (w / 2 - NOTCH_HALF) / 2;
  return [left, w - left];
}

// The last tab a real tab route resolved to. Screens outside the tabs (a
// thread) keep the tab you came from marked, rather than snapping to Home.
let lastTabIndex = 0;

/** Which tab a pathname belongs to; for non-tab routes, the tab you were last on. */
function onTab(item: (typeof TABS)[number], pathname: string): boolean {
  return item.route === '/' ? pathname === '/' : pathname.includes(item.route.replace('/(tabs)/', ''));
}

export function activeTabIndex(pathname: string): number {
  const found = TABS.findIndex((item) => onTab(item, pathname));
  if (found !== -1) lastTabIndex = found;
  return lastTabIndex;
}

const DOT = 6;
const DOT_STRETCH = 14;
const ICON_Y = NAV_BAR_HEIGHT / 2 - 5;
const DOT_Y = NAV_BAR_HEIGHT - 15;
const TOUCH = 64;

/**
 * BottomFade: the page dissolving into its own colour behind the bar, so
 * content scrolling under it fades out instead of showing through the
 * notch around the capture button. Under the capture menu's scrim (40).
 */
export function BottomFade() {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const above = CENTER_BUTTON_RISE + 24;
  const height = navBottom(insets.bottom) + NAV_BAR_HEIGHT + above;
  // Solid from the bar's top edge down, so nothing shows in the notch.
  const solidAt = above / height;
  return (
    <View pointerEvents="none" style={[styles.fade, { height }]}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="bottom-fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.bg} stopOpacity={0} />
            <Stop offset={solidAt * 0.55} stopColor={colors.bg} stopOpacity={0.7} />
            <Stop offset={solidAt} stopColor={colors.bg} stopOpacity={1} />
            <Stop offset="1" stopColor={colors.bg} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#bottom-fade)" />
      </Svg>
    </View>
  );
}

/**
 * FloatingTabBar: a floating bar with a notch the capture button sits in.
 * The active tab is its accent colour and a dot underneath; the dot is one
 * element that springs between tabs (stretching as it travels), and slides
 * under the capture button while that's in use.
 */
export function FloatingTabBar() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const colors = useThemeColors();
  const dark = useThemeName() === 'dark';
  const reduceMotion = useReduceMotion();
  const captureActive = useCaptureActive();
  const [width, setWidth] = useState(0);

  const activeIndex = activeTabIndex(pathname);
  const centers = width ? tabCenters(width) : null;
  const dotTarget = !centers ? 0 : captureActive ? width / 2 : centers[activeIndex];

  const dotX = useSharedValue(0);
  const dotW = useSharedValue(DOT);
  const placed = React.useRef(false);
  useEffect(() => {
    if (!centers) return;
    if (!placed.current || reduceMotion) {
      // First layout: put the dot in place without travelling there.
      dotX.value = dotTarget;
      placed.current = true;
      return;
    }
    dotX.value = withSpring(dotTarget, { damping: 24, stiffness: 190, mass: 0.8 });
    dotW.value = withSequence(
      withTiming(DOT_STRETCH, { duration: 120 }),
      withSpring(DOT, { damping: 24, stiffness: 240 }),
    );
  }, [dotTarget, width]); // eslint-disable-line react-hooks/exhaustive-deps

  const dotStyle = useAnimatedStyle(() => ({
    width: dotW.value,
    transform: [{ translateX: dotX.value - dotW.value / 2 }],
  }));

  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  const path = width ? barPath(width, NAV_BAR_HEIGHT) : '';

  return (
    <View
      onLayout={onLayout}
      pointerEvents="box-none"
      style={[styles.bar, { bottom: navBottom(insets.bottom), height: NAV_BAR_HEIGHT }]}
    >
      {width > 0 && (
        <Svg
          width={width}
          height={NAV_BAR_HEIGHT + 4}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        >
          {/* A soft shadow that follows the notch (a platform shadow would be a plain rectangle). */}
          <Path d={path} fill="#000" opacity={dark ? 0.4 : 0.07} transform="translate(0 3)" />
          <Path d={path} fill="#000" opacity={dark ? 0.25 : 0.05} transform="translate(0 1.5)" />
          {/* Light: the page's own paper, lifted by its shadow, rather than
              the one stark white surface in a warm palette. */}
          <Path d={path} fill={dark ? colors.surfaceLowest : colors.bg} stroke={colors.border} strokeWidth={1} />
        </Svg>
      )}

      {centers &&
        TABS.map((tab, index) => (
          <TabButton
            key={tab.name}
            name={tab.name}
            icon={tab.icon}
            x={centers[index]}
            active={!captureActive && index === activeIndex}
            reduceMotion={reduceMotion}
            onPress={() => {
              if (captureActive) closeCapture();
              if (onTab(tab, pathname)) return;
              Haptics.selectionAsync();
              router.push(tab.route);
            }}
          />
        ))}

      {centers && (
        <Animated.View
          pointerEvents="none"
          style={[styles.dot, { top: DOT_Y, backgroundColor: colors.accent }, dotStyle]}
        />
      )}
    </View>
  );
}

function TabButton({
  name,
  icon,
  x,
  active,
  reduceMotion,
  onPress,
}: {
  name: string;
  icon: IconName;
  x: number;
  active: boolean;
  reduceMotion: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const scale = useSharedValue(1);
  const lift = useSharedValue(active ? -1 : 0);

  // Becoming active: a quick squash, a springy pop back, and a small lift.
  const wasActive = React.useRef(active);
  useEffect(() => {
    if (active && !wasActive.current && !reduceMotion) {
      scale.value = withSequence(
        withTiming(0.9, { duration: 90 }),
        withSpring(1, { damping: 16, stiffness: 260, mass: 0.6 }),
      );
    }
    lift.value = reduceMotion
      ? active ? -1 : 0
      : withSpring(active ? -1 : 0, { damping: 14, stiffness: 200 });
    wasActive.current = active;
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: lift.value }, { scale: scale.value }],
  }));

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        if (!reduceMotion) scale.value = withSpring(0.86, { damping: 20, stiffness: 400 });
      }}
      onPressOut={() => {
        if (!reduceMotion) scale.value = withSpring(1, { damping: 18, stiffness: 300 });
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={name}
      style={[styles.touch, { left: x - TOUCH / 2, top: ICON_Y - TOUCH / 2 }]}
    >
      <Animated.View style={iconStyle}>
        <Icon
          name={icon}
          size={24}
          color={active ? colors.accent : colors.fgTertiary}
          stroke={active ? 2.2 : 1.8}
        />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 30,
  },
  bar: {
    position: 'absolute',
    left: 16,
    right: 16,
    // Above the capture menu's scrim (40), so the dot can travel under the
    // button while it's open; below the button itself (50).
    zIndex: 45,
  },
  touch: {
    position: 'absolute',
    width: TOUCH,
    height: TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    left: 0,
    height: DOT,
    borderRadius: DOT / 2,
  },
});
