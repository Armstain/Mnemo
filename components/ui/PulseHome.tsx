import React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Settings, Mic, BookOpen, Layers, ArrowUpRight } from 'lucide-react-native';
import { MotiView } from 'moti';
import { BlurView } from 'expo-blur';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glass } from '@/components/ui/Glass';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors, useThemeName } from '@/hooks/use-theme';
import { formatCompactDistance } from '@/utils/time';
import { useCategories } from '@/utils/categories';
import { EASE_OUT, enterUp } from '@/utils/motion';
import type { MnemoItem } from '@/types/mnemo';

/**
 * PulseMic - The animated central microphone interface.
 */
function AnimatedRings() {
  return (
    <>
      {[1, 2].map((i) => (
        <MotiView
          key={i}
          from={{ scale: 1, opacity: 0.28 }}
          animate={{ scale: 1.8 + i * 0.18, opacity: 0 }}
          transition={{ type: 'timing', duration: 2600, loop: true, delay: i * 700 }}
          className="absolute w-40 h-40 rounded-full border border-border"
        />
      ))}
    </>
  );
}

const MemoizedAnimatedRings = React.memo(AnimatedRings);

function PulseMic() {
  const theme = useThemeName();
  const colors = useThemeColors();

  return (
    <View className="items-center justify-center py-6">
      <View className="relative items-center justify-center">
        <MemoizedAnimatedRings />

        {/* Outer halo */}
        <View className="absolute w-44 h-44 rounded-full bg-surface border border-border/60" />

        {/* Central Button — glass chrome, accent mic */}
        <Pressable
          onPress={() => router.push('/dump' as any)}
          accessibilityLabel="Open quick dump"
          className="w-32 h-32 rounded-full items-center justify-center overflow-hidden active:scale-95 transition-transform border border-border"
        >
          <BlurView
            intensity={30}
            tint={theme === 'dark' ? 'light' : 'default'}
            experimentalBlurMethod="dimezisBlurView"
            className="absolute inset-0"
          />
          <View className="absolute inset-0 bg-surface-warm rounded-full" />

          <Mic size={32} color={colors.accent} strokeWidth={1.5} />
        </Pressable>
      </View>

      {/* Quick Action Buttons */}
      <View className="flex-row gap-3 mt-10">
        <Pressable
          onPress={() => router.push('/capture?mode=note' as any)}
          accessibilityLabel="Quick note"
          className="bg-surface border border-border rounded-full px-6 py-3 flex-row items-center active:bg-surface-warm"
        >
          <MotiView animate={{ opacity: [0.5, 1, 0.5] }} transition={{ type: 'timing', duration: 2000, loop: true }}>
            <View className="w-1.5 h-1.5 rounded-full bg-accent mr-2" />
          </MotiView>
          <Text className="text-fg-secondary font-sans-medium text-[10px] uppercase tracking-widest">Quick Note</Text>
        </Pressable>

        <Pressable
          onPress={() => router.push('/(tabs)/library' as any)}
          accessibilityLabel="Search library"
          className="bg-surface border border-border rounded-full px-6 py-3 flex-row items-center active:bg-surface-warm"
        >
          <BookOpen size={12} color={colors.fgTertiary} className="mr-2" />
          <Text className="text-fg-secondary font-sans-medium text-[10px] uppercase tracking-widest">Search</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * PulseResumeCard - The hero glass card. The only glass card in the
 * home scroll — glass is for heroes.
 */
function PulseResumeCard({ item }: { item: MnemoItem }) {
  const categories = useCategories();
  const colors = useThemeColors();
  const categoryConfig = categories[item.category];

  return (
    <MotiView
      from={{ opacity: 0, translateY: 20 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 600, easing: EASE_OUT }}
      className="mb-8"
    >
      <Pressable
        onPress={() => router.push(`/(tabs)/context?id=${item.id}` as any)}
        className="active:scale-[0.99]"
      >
        <Glass radius={32} interactive>
          <View className="p-6">
            <View className="flex-row justify-between items-center mb-4">
              <View className="bg-surface-warm border border-border rounded-md px-2 py-1">
                <Text className="text-fg-secondary font-sans-semi text-[9px] uppercase tracking-wider">
                  {item.status === 'active' ? 'In Progress Note' : 'Paused Context'}
                </Text>
              </View>
              <Text className="text-fg-tertiary font-sans text-[10px]">
                {formatCompactDistance(item.updatedAt)}
              </Text>
            </View>

            <Text className="text-fg text-2xl font-sans-medium leading-tight mb-3">
              {item.title}
            </Text>

            <Text className="text-fg-secondary font-sans text-sm leading-relaxed mb-6" numberOfLines={2}>
              {item.nextStep || item.whereLeftOff || 'Pick up exactly where you left off...'}
            </Text>

            <View className="h-px bg-border w-full mb-6" />

            {/* Action Buttons */}
            <View className="gap-2">
              <Pressable
                className="bg-surface border border-border rounded-xl p-4 flex-row items-center justify-between active:bg-surface-warm"
                onPress={() => router.push(`/(tabs)/context?id=${item.id}` as any)}
              >
                <View className="flex-row items-center">
                  <categoryConfig.icon size={16} color={categoryConfig.color} strokeWidth={2} />
                  <Text className="text-fg font-sans-medium text-xs ml-3">Resume This Session</Text>
                </View>
                <ArrowUpRight size={14} color={colors.fgTertiary} />
              </Pressable>

              <Pressable
                className="bg-surface border border-border rounded-xl p-4 flex-row items-center active:bg-surface-warm"
                onPress={() => router.push(`/(tabs)/library?category=${item.category}` as any)}
              >
                <Layers size={16} color={colors.accent} strokeWidth={2} />
                <Text className="text-fg font-sans-medium text-xs ml-3">View Related Thoughts</Text>
              </Pressable>
            </View>
          </View>
        </Glass>
      </Pressable>
    </MotiView>
  );
}

/**
 * PulseHome - The main screen component.
 */
export function PulseHome() {
  const insets = useSafeAreaInsets();
  const { items, getActiveItems } = useMnemoStore();
  const colors = useThemeColors();
  const categories = useCategories();
  const activeItems = getActiveItems();
  const latestItem = activeItems[0];

  // Two most-used categories, for the quiet links below the resume card.
  const topCategories = React.useMemo(() => {
    const counts = new Map<MnemoItem['category'], number>();
    for (const i of items) {
      if (i.status === 'archived') continue;
      counts.set(i.category, (counts.get(i.category) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
  }, [items]);

  return (
    <ScrollView
      className="flex-1"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 12) + 120 }}
    >
      {/* Header */}
      <View
        className="flex-row justify-between items-center px-6 mb-4"
        style={{ paddingTop: Math.max(insets.top, 16) }}
      >
        <View className="flex-row items-center">
          <View
            accessible
            accessibilityLabel="Mnemo logo"
            className="w-8 h-8 rounded-full bg-accent/20 items-center justify-center border border-accent/40 mr-3"
          >
            <Mic size={14} color={colors.accent} strokeWidth={2} />
          </View>
          <Text className="text-fg font-sans-medium text-xl tracking-widest uppercase">Mnemo</Text>
        </View>
        <Pressable
          onPress={() => router.push('/modal' as any)}
          accessibilityLabel="Open settings"
          className="w-10 h-10 rounded-full bg-surface items-center justify-center border border-border active:bg-surface-warm"
        >
          <Settings size={20} color={colors.fgSecondary} strokeWidth={1.5} />
        </Pressable>
      </View>

      <PulseMic />

      <View className="px-6 mt-4">
        {/* Resume Section */}
        <Text className="text-fg font-sans-medium text-base mb-4">Resume your thought</Text>

        {latestItem ? (
          <PulseResumeCard item={latestItem} />
        ) : (
          <View className="rounded-4xl border border-dashed border-border p-8 items-center mb-8">
            <Text className="text-fg-secondary font-sans text-sm text-center">No active thoughts to resume.{'\n'}Start a new one above.</Text>
          </View>
        )}

        {/* Category links — quiet flat rows, not more glass */}
        {topCategories.length > 0 && (
          <View className="border-t border-border/60">
            {topCategories.map(([category, count], index) => {
              const config = categories[category];
              const Icon = config.icon;
              return (
                <MotiView key={category} {...enterUp(index)}>
                  <Pressable
                    onPress={() => router.push(`/(tabs)/library?category=${category}` as any)}
                    className="flex-row items-center py-3.5 border-b border-border/60 active:bg-surface rounded-md"
                  >
                    <View
                      className="w-9 h-9 rounded-full items-center justify-center mr-3"
                      style={{ backgroundColor: config.bgTint }}
                    >
                      <Icon size={15} color={config.color} strokeWidth={2} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-fg font-sans-medium text-sm">{config.label}</Text>
                      <Text className="text-fg-tertiary font-sans text-[11px]">
                        {count} {count === 1 ? 'note' : 'notes'}
                      </Text>
                    </View>
                    <ArrowUpRight size={15} color={colors.fgTertiary} />
                  </Pressable>
                </MotiView>
              );
            })}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
