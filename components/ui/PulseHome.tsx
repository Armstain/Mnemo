import React from 'react';
import { View, Text, Pressable, ScrollView, Image } from 'react-native';
import { Settings, Mic, Layers, ArrowUpRight, Sparkles, Clock, CheckCircle2 } from 'lucide-react-native';
import { MotiView } from 'moti';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glass } from '@/components/ui/Glass';
import { CONTENT_BOTTOM_CLEARANCE } from '@/components/ui/FloatingTabBar';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import { formatCompactDistance } from '@/utils/time';
import { useCategories } from '@/utils/categories';
import { EASE_OUT, enterUp } from '@/utils/motion';
import type { MnemoItem } from '@/types/mnemo';

/**
 * PulseResumeCard — the hero Material 3 elevated card on the homepage.
 * Zero-friction re-entry into your most recent thought.
 */
function PulseResumeCard({ item }: { item: MnemoItem }) {
  const categories = useCategories();
  const colors = useThemeColors();
  const categoryConfig = categories[item.category];

  return (
    <MotiView
      from={{ opacity: 0, translateY: 15 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 400, easing: EASE_OUT }}
      className="mb-10"
    >
      <Glass radius={28}>
        <View className="p-6">
          <View className="flex-row justify-between items-center mb-4">
            <View
              className="rounded-full px-3 py-1 flex-row items-center"
              style={{ backgroundColor: colors.primaryContainer }}
            >
              <View
                className="w-1.5 h-1.5 rounded-full mr-1.5"
                style={{ backgroundColor: colors.onPrimaryContainer }}
              />
              <Text
                className="font-sans-semi text-[10px] uppercase tracking-wider"
                style={{ color: colors.onPrimaryContainer }}
              >
                {item.status === 'active' ? 'Active Thought' : 'Paused Context'}
              </Text>
            </View>

            <View className="flex-row items-center">
              <Clock size={11} color={colors.fgTertiary} />
              <Text className="text-fg-tertiary font-sans text-[11px] ml-1">
                {formatCompactDistance(item.updatedAt)}
              </Text>
            </View>
          </View>

          <Text className="text-fg text-2xl font-serif leading-tight mb-3">
            {item.title}
          </Text>

          <Text className="text-fg-secondary font-sans text-sm leading-relaxed mb-5" numberOfLines={2}>
            {item.nextStep || item.whereLeftOff || 'Pick up exactly where you left off...'}
          </Text>

          <View className="h-px w-full mb-5" style={{ backgroundColor: colors.border }} />

          {/* Material 3 buttons: filled primary + tonal */}
          <View className="gap-2.5">
            <Pressable
              android_ripple={{ color: 'rgba(255,255,255,0.18)' }}
              className="rounded-full py-3.5 px-5 flex-row items-center justify-between overflow-hidden"
              style={{ backgroundColor: colors.accent }}
              onPress={() => router.push(`/(tabs)/context?id=${item.id}` as any)}
            >
              <View className="flex-row items-center">
                <categoryConfig.icon size={17} color={colors.accentInk} strokeWidth={2} />
                <Text className="font-sans-semi text-sm ml-3" style={{ color: colors.accentInk }}>
                  Resume Session
                </Text>
              </View>
              <ArrowUpRight size={16} color={colors.accentInk} />
            </Pressable>

            <Pressable
              android_ripple={{ color: colors.border }}
              className="rounded-full py-3 px-5 flex-row items-center justify-between overflow-hidden"
              style={{ backgroundColor: colors.surfaceHighest }}
              onPress={() => router.push(`/(tabs)/library?category=${item.category}` as any)}
            >
              <View className="flex-row items-center">
                <Layers size={15} color={colors.fgSecondary} strokeWidth={1.8} />
                <Text className="text-fg-secondary font-sans-medium text-xs ml-3">
                  Explore {categoryConfig.label}
                </Text>
              </View>
              <ArrowUpRight size={14} color={colors.fgTertiary} />
            </Pressable>
          </View>
        </View>
      </Glass>
    </MotiView>
  );
}

/**
 * PulseHome — Material 3 homepage. Cleaner hierarchy, generous spacing,
 * solid tonal surfaces (no glass/glow).
 */
export function PulseHome() {
  const insets = useSafeAreaInsets();
  const { items, getActiveItems } = useMnemoStore();
  const colors = useThemeColors();
  const categories = useCategories();

  const activeItems = getActiveItems();
  const latestItem = activeItems[0];
  const secondaryItems = activeItems.slice(1, 4);

  const greeting = React.useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  }, []);

  return (
    <ScrollView
      className="flex-1"
      showsVerticalScrollIndicator={false}
      // Clear the edge-to-edge nav bar plus the FAB stack floating above it.
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + CONTENT_BOTTOM_CLEARANCE }}
    >
      {/* Header */}
      <View
        className="flex-row justify-between items-center px-6 mb-6"
        style={{ paddingTop: Math.max(insets.top + 8, 20) }}
      >
        <View className="flex-row items-center">
          <Image
            source={require('@/assets/Mnemo_logo_dark.png')}
            style={{ width: 40, height: 40, marginRight: 12 }}
            resizeMode="contain"
            accessibilityLabel="Mnemo logo"
          />
          <View className="justify-center">
            <Text className="text-fg font-serif text-xl tracking-wide leading-tight">Mnemo</Text>
            <Text className="text-fg-tertiary font-sans text-[11px] mt-0.5">
              {greeting}
            </Text>
          </View>
        </View>

        <Pressable
          onPress={() => router.push('/modal' as any)}
          accessibilityRole="button"
          accessibilityLabel="Open settings"
          android_ripple={{ color: colors.border, borderless: true, radius: 24 }}
          className="w-10 h-10 rounded-full items-center justify-center overflow-hidden"
          style={{ backgroundColor: colors.surfaceHigh }}
        >
          <Settings size={20} color={colors.fgSecondary} strokeWidth={1.8} />
        </Pressable>
      </View>

      {/* Main Content Area */}
      <View className="px-6">
        {/* Section Header */}
        <View className="flex-row justify-between items-center mb-4">
          <View className="flex-row items-center">
            <Sparkles size={18} color={colors.accent} />
            <Text className="text-fg font-sans-medium text-base ml-2">Resume Your Thought</Text>
          </View>

          {activeItems.length > 0 && (
            <Text className="text-fg-tertiary font-sans text-xs">
              {activeItems.length} active {activeItems.length === 1 ? 'thread' : 'threads'}
            </Text>
          )}
        </View>

        {/* Hero Resume Card */}
        {latestItem ? (
          <PulseResumeCard item={latestItem} />
        ) : (
          <MotiView
            from={{ opacity: 0, translateY: 10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 350 }}
            className="rounded-3xl p-8 items-center justify-center mb-10"
            style={{ borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' }}
          >
            <View
              className="w-12 h-12 rounded-full items-center justify-center mb-3"
              style={{ backgroundColor: colors.primaryContainer }}
            >
              <CheckCircle2 size={22} color={colors.onPrimaryContainer} />
            </View>
            <Text className="text-fg font-sans-medium text-base text-center mb-1">
              All caught up!
            </Text>
            <Text className="text-fg-secondary font-sans text-xs text-center leading-relaxed">
              No paused thoughts waiting.{'\n'}Use the Record button at the bottom-right, or Note, to capture a new thought.
            </Text>
          </MotiView>
        )}

        {/* Other Active Threads */}
        {secondaryItems.length > 0 && (
          <View className="mb-10">
            <Text className="text-fg-secondary font-sans-medium text-xs uppercase tracking-wider mb-3">
              Other Paused Contexts
            </Text>
            <View className="gap-2.5">
              {secondaryItems.map((item, index) => {
                const config = categories[item.category];
                const Icon = config.icon;
                return (
                  <MotiView key={item.id} {...enterUp(index)}>
                    <Pressable
                      onPress={() => router.push(`/(tabs)/context?id=${item.id}` as any)}
                      android_ripple={{ color: colors.border }}
                      className="rounded-2xl p-4 flex-row items-center justify-between overflow-hidden"
                      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
                    >
                      <View className="flex-row items-center flex-1 mr-3">
                        <View
                          className="w-9 h-9 rounded-full items-center justify-center mr-3"
                          style={{ backgroundColor: config.bgTint }}
                        >
                          <Icon size={15} color={config.color} strokeWidth={2} />
                        </View>
                        <View className="flex-1">
                          <Text className="text-fg font-sans-medium text-sm" numberOfLines={1}>
                            {item.title}
                          </Text>
                          <Text className="text-fg-tertiary font-sans text-[11px]">
                            {formatCompactDistance(item.updatedAt)}
                          </Text>
                        </View>
                      </View>
                      <ArrowUpRight size={14} color={colors.fgTertiary} />
                    </Pressable>
                  </MotiView>
                );
              })}
            </View>
          </View>
        )}

        {/* Categories Grid */}
        <View>
          <View className="flex-row justify-between items-center mb-3">
            <Text className="text-fg-secondary font-sans-medium text-xs uppercase tracking-wider">
              Thought Categories
            </Text>
            <Pressable onPress={() => router.push('/(tabs)/library' as any)} hitSlop={8}>
              <Text className="text-accent font-sans-semi text-xs">View All</Text>
            </Pressable>
          </View>

          <View className="flex-row flex-wrap gap-2.5">
            {Object.entries(categories).map(([key, config]) => {
              const Icon = config.icon;
              const count = items.filter((i) => i.category === key && i.status !== 'archived').length;

              return (
                <Pressable
                  key={key}
                  onPress={() => router.push(`/(tabs)/library?category=${key}` as any)}
                  android_ripple={{ color: colors.border }}
                  className="flex-1 min-w-[140px] rounded-2xl p-3.5 flex-row items-center overflow-hidden"
                  style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
                >
                  <View
                    className="w-8 h-8 rounded-full items-center justify-center mr-2.5"
                    style={{ backgroundColor: config.bgTint }}
                  >
                    <Icon size={14} color={config.color} strokeWidth={2} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-fg font-sans-medium text-xs" numberOfLines={1}>{config.label}</Text>
                    <Text className="text-fg-tertiary font-sans text-[10px]">
                      {count} {count === 1 ? 'note' : 'notes'}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}
