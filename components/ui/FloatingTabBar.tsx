import React, { useState, useCallback } from 'react';
import { View, Pressable, StyleSheet, Text, type LayoutChangeEvent } from 'react-native';
import { Home, Search, Library } from 'lucide-react-native';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, usePathname } from 'expo-router';

import { useThemeColors } from '@/hooks/use-theme';
import { useReduceMotion } from '@/hooks/use-accessibility-motion';
import { SPRING_NAV, SPRING_PRESS, motion } from '@/utils/motion';

const TABS = [
  { name: 'Home', icon: Home, route: '/' },
  { name: 'Search', icon: Search, route: '/(tabs)/search' },
  { name: 'Library', icon: Library, route: '/(tabs)/library' },
] as const;

// Material 3 navigation bar container height (excludes the bottom safe
// inset, which is added on top). Exported so the FAB and screens can
// reserve clearance without magic numbers.
export const NAV_BAR_HEIGHT = 64;

// Scroll-content bottom padding that clears the floating nav bar + FAB stack.
// Only use on screens that render ActionCluster (Home tab).
export const CONTENT_BOTTOM_CLEARANCE = NAV_BAR_HEIGHT + 130;

// Bottom padding for screens WITHOUT the FAB (Library, Search, Context).
// Clears just the nav bar + standard 16dp M3 margin.
export const NAV_CLEARANCE = NAV_BAR_HEIGHT + 16;

const PILL_WIDTH = 48;
const PILL_HEIGHT = 28;
// Matches styles.item paddingVertical — the pill sits over the icon slot,
// which is the first child inside that padding.
const ITEM_PAD_Y = 4;

/** Which tab a pathname belongs to, or 0 when nothing matches. */
export function activeTabIndex(pathname: string): number {
  const found = TABS.findIndex(
    (item) =>
      (item.route === '/' && pathname === '/') ||
      (item.route !== '/' && pathname.includes(item.route.replace('/(tabs)/', ''))),
  );
  return found === -1 ? 0 : found;
}

type Rect = { x: number; y: number; width: number };

/**
 * FloatingTabBar — Floaty, minimal pill navigation bar.
 *
 * The active pill is a single element owned by the bar, not one per tab, so
 * it *travels* between tabs on a spring instead of cross-fading. Tracking one
 * object through space costs the user far less than re-finding a new one on
 * every screen change — that continuity is the whole point.
 */
export function FloatingTabBar() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const colors = useThemeColors();
  const reduceMotion = useReduceMotion();

  // Measured per-tab geometry, so the pill's travel needs no assumptions
  // about bar padding or how flex divides the row.
  const [rects, setRects] = useState<Record<number, Rect>>({});
  const onItemLayout = useCallback((index: number, e: LayoutChangeEvent) => {
    const { x, y, width } = e.nativeEvent.layout;
    setRects((prev) => {
      const prevRect = prev[index];
      if (prevRect && prevRect.x === x && prevRect.y === y && prevRect.width === width) {
        return prev;
      }
      return { ...prev, [index]: { x, y, width } };
    });
  }, []);

  const activeIndex = activeTabIndex(pathname);
  const activeRect = rects[activeIndex];

  return (
    <View
      className="absolute left-6 right-6 z-40"
      style={[
        styles.bar,
        {
          bottom: Math.max(insets.bottom, 16),
          height: NAV_BAR_HEIGHT,
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      {/* Traveling active indicator — rendered once, behind every tab. */}
      {activeRect && (
        <MotiView
          pointerEvents="none"
          style={[
            styles.indicator,
            {
              backgroundColor: colors.primaryContainer,
              top: activeRect.y + ITEM_PAD_Y,
            },
          ]}
          animate={{
            translateX: activeRect.x + (activeRect.width - PILL_WIDTH) / 2,
            opacity: 1,
          }}
          transition={motion(SPRING_NAV, reduceMotion)}
        />
      )}

      {TABS.map((item, index) => (
        <NavItem
          key={item.name}
          name={item.name}
          icon={item.icon}
          isActive={index === activeIndex}
          onLayout={(e) => onItemLayout(index, e)}
          onPress={() => {
            // Re-tapping the current tab shouldn't fire feedback for a
            // navigation that isn't happening.
            if (index === activeIndex) return;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push(item.route as any);
          }}
        />
      ))}
    </View>
  );
}

function NavItem({
  name,
  icon: Icon,
  isActive,
  onPress,
  onLayout,
}: {
  name: string;
  icon: typeof Home;
  isActive: boolean;
  onPress: () => void;
  onLayout: (e: LayoutChangeEvent) => void;
}) {
  const colors = useThemeColors();
  const reduceMotion = useReduceMotion();
  const [pressed, setPressed] = useState(false);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onLayout={onLayout}
      accessibilityRole="button"
      accessibilityState={{ selected: isActive }}
      accessibilityLabel={name}
      android_ripple={{ color: colors.border, borderless: true, radius: 28 }}
      style={styles.item}
    >
      {/* Finger-down acknowledgement: the target gives before it acts, so
          the tap is confirmed even if navigation takes a frame to land. */}
      <MotiView
        style={styles.itemInner}
        animate={{ scale: reduceMotion ? 1 : pressed ? 0.9 : 1 }}
        transition={motion(SPRING_PRESS, reduceMotion)}
      >
        <View style={styles.indicatorWrap}>
          <Icon
            size={20}
            color={isActive ? colors.onPrimaryContainer : colors.fgSecondary}
            strokeWidth={isActive ? 2.2 : 1.8}
          />
        </View>
        <Text
          numberOfLines={1}
          style={[
            styles.label,
            { color: isActive ? colors.fg : colors.fgSecondary },
          ]}
          className={isActive ? 'font-sans-semi' : 'font-sans-medium'}
        >
          {name}
        </Text>
      </MotiView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderRadius: 32,
    borderWidth: 1,
    paddingHorizontal: 12,
    // Soft floating shadow lift
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 16,
    shadowOpacity: 0.14,
    elevation: 10,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: ITEM_PAD_Y,
  },
  itemInner: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  indicatorWrap: {
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicator: {
    position: 'absolute',
    left: 0,
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    borderRadius: 14,
  },
  label: {
    fontSize: 11,
    letterSpacing: 0.1,
  },
});
