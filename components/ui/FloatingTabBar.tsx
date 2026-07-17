import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Home, Search, Library } from 'lucide-react-native';
import { MotiView } from 'moti';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, usePathname } from 'expo-router';

import { Glass } from '@/components/ui/Glass';
import { useThemeColors, useThemeName } from '@/hooks/use-theme';
import { EASE_OUT } from '@/utils/motion';

const TABS = [
  { name: 'Home', icon: Home, route: '/' },
  { name: 'Search', icon: Search, route: '/(tabs)/search' },
  { name: 'Library', icon: Library, route: '/(tabs)/library' },
] as const;

/**
 * FloatingTabBar — the navigation pill, rendered in the app's Glass
 * material (native Liquid Glass on iOS 26+, layered blur elsewhere).
 * Glass supplies its own shadow and materialize-in, so this only lays
 * out the tab row itself.
 */
export function FloatingTabBar() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  return (
    <View
      className="absolute bottom-0 left-0 right-0 items-center justify-center z-50 pointer-events-box-none"
      style={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
    >
      <MotiView
        from={{ translateY: 100, opacity: 0 }}
        animate={{ translateY: 0, opacity: 1 }}
        transition={{ type: 'spring', damping: 20, delay: 500 }}
      >
        <Glass radius={34} intensity={60} interactive>
          <View style={styles.content}>
            {TABS.map((item) => {
              const isActive =
                (item.route === '/' && pathname === '/') ||
                (item.route !== '/' &&
                  pathname.includes(item.route.replace('/(tabs)/', '')));

              return (
                <TabButton
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
        </Glass>
      </MotiView>
    </View>
  );
}

function TabButton({
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
  const theme = useThemeName();
  const colors = useThemeColors();
  // Owns its own shared value so press feedback is instant and smoothly
  // interruptible — a hard style-array swap on `pressed` has no easing
  // at all, which reads as a snap rather than a press.
  const pressed = useSharedValue(0);
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.08 }],
  }));

  return (
    <Pressable
      onPressIn={() => {
        pressed.value = withTiming(1, { duration: 100, easing: EASE_OUT });
      }}
      onPressOut={() => {
        pressed.value = withTiming(0, { duration: 160, easing: EASE_OUT });
      }}
      onPress={onPress}
      style={styles.tabButton}
      accessibilityLabel={name}
    >
      <Animated.View style={[styles.tabButtonInner, pressStyle]}>
        {/* Always mounted and interpolated by `isActive`, rather than
            conditionally rendered — mount/unmount restarts from scratch
            on every rapid tab switch, the RN equivalent of a keyframe
            animation that can't be interrupted mid-flight. */}
        <MotiView
          style={[
            styles.activeGlow,
            {
              backgroundColor:
                theme === 'dark'
                  ? 'rgba(255,255,255,0.12)'
                  : 'rgba(10,15,20,0.07)',
            },
          ]}
          animate={{ opacity: isActive ? 1 : 0, scale: isActive ? 1 : 0.5 }}
          transition={{ type: 'timing', duration: 220, easing: EASE_OUT }}
        />

        <Icon
          size={20}
          color={isActive ? colors.fg : colors.fgTertiary}
          strokeWidth={isActive ? 2.2 : 1.5}
        />

        <MotiView
          style={[styles.activeDot, { backgroundColor: colors.accent }]}
          animate={{ opacity: isActive ? 1 : 0, scale: isActive ? 1 : 0.5 }}
          transition={{ type: 'timing', duration: 220, delay: isActive ? 100 : 0, easing: EASE_OUT }}
        />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 20,
  },
  tabButton: {
    width: 44,
    height: 44,
    borderRadius: 9999,
  },
  tabButtonInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 9999,
  },
  activeDot: {
    position: 'absolute',
    bottom: 2,
    width: 4,
    height: 4,
    borderRadius: 2,
  },
});
