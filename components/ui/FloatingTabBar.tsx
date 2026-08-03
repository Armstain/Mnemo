import React from 'react';
import { View, Pressable, StyleSheet, Text } from 'react-native';
import { Home, Search, Library } from 'lucide-react-native';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, usePathname } from 'expo-router';

import { useThemeColors } from '@/hooks/use-theme';
import { useReduceMotion } from '@/hooks/use-accessibility-motion';
import { EASE_OUT } from '@/utils/motion';

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

/**
 * FloatingTabBar — Floaty, minimal pill navigation bar.
 * Elevated off the bottom edge with rounded capsule styling, subtle shadow,
 * and compact minimal tabs.
 */
export function FloatingTabBar() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const colors = useThemeColors();

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
      {TABS.map((item) => {
        const isActive =
          (item.route === '/' && pathname === '/') ||
          (item.route !== '/' &&
            pathname.includes(item.route.replace('/(tabs)/', '')));

        return (
          <NavItem
            key={item.name}
            name={item.name}
            icon={item.icon}
            isActive={isActive}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push(item.route as any);
            }}
          />
        );
      })}
    </View>
  );
}

function NavItem({
  name,
  icon: Icon,
  isActive,
  onPress,
}: {
  name: string;
  icon: typeof Home;
  isActive: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const reduceMotion = useReduceMotion();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: isActive }}
      accessibilityLabel={name}
      android_ripple={{ color: colors.border, borderless: true, radius: 28 }}
      style={styles.item}
    >
      <View style={styles.indicatorWrap}>
        {/* Pill active indicator */}
        <MotiView
          style={[styles.indicator, { backgroundColor: colors.primaryContainer }]}
          animate={{
            opacity: isActive ? 1 : 0,
            // ponytail: skip scaleX when user prefers reduced motion — only
            // opacity should change per accessibility guidelines.
            scaleX: reduceMotion ? 1 : (isActive ? 1 : 0.6),
          }}
          transition={{ type: 'timing', duration: reduceMotion ? 120 : 240, easing: EASE_OUT }}
        />
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
    gap: 2,
    paddingVertical: 4,
  },
  indicatorWrap: {
    width: 48,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicator: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 14,
  },
  label: {
    fontSize: 11,
    letterSpacing: 0.1,
  },
});
