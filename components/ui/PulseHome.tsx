import React from 'react';
import { View, Text, ScrollView, Image } from 'react-native';
import { MotiView } from 'moti';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';
import { Button, IconButton } from '@/components/ui/Button';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Icon } from '@/components/ui/Icon';
import { CONTENT_BOTTOM_CLEARANCE } from '@/components/ui/FloatingTabBar';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors, useThemeName } from '@/hooks/use-theme';
import { formatCompactDistance } from '@/utils/time';
import { useCategories } from '@/utils/categories';
import { useEnter } from '@/utils/motion';
import type { MnemoItem } from '@/types/mnemo';

/** PulseResumeCard — the one raised hero card on the homepage: zero-friction re-entry into your most recent thought. */
function PulseResumeCard({ item }: { item: MnemoItem }) {
  const categories = useCategories();
  const colors = useThemeColors();
  const categoryConfig = categories[item.category];

  return (
    <Card variant="raised" pad="lg" className="mb-8">
      <View className="flex-row justify-between items-center mb-3">
        <Pill tone={colors.accent}>{item.status === 'active' ? 'Active thought' : 'Paused context'}</Pill>
        <View className="flex-row items-center gap-1">
          <Icon name="clock" size={12} color={colors.fgTertiary} />
          <Text className="text-fg-tertiary font-sans text-xs">{formatCompactDistance(item.updatedAt)}</Text>
        </View>
      </View>

      <Text className="text-fg font-display text-heading leading-tight mb-1">{item.title}</Text>

      <Text className="text-fg-secondary font-sans text-sm leading-relaxed mb-4" numberOfLines={2}>
        {item.nextStep || item.whereLeftOff || 'Pick up exactly where you left off...'}
      </Text>

      <View className="flex-row gap-2">
        <Button
          variant="primary"
          size="sm"
          icon="play"
          className="flex-1"
          onPress={() => router.push(`/(tabs)/context?id=${item.id}` as any)}
        >
          Resume
        </Button>
        <Button
          variant="quiet"
          size="sm"
          icon="layers"
          className="flex-1"
          onPress={() => router.push(`/(tabs)/library?category=${item.category}` as any)}
        >
          {categoryConfig.label}
        </Button>
      </View>
    </Card>
  );
}

/** PulseHome — the Home tab. One raised hero, then paused threads, then categories. */
export function PulseHome() {
  const enter = useEnter();
  const insets = useSafeAreaInsets();
  const { items, getActiveItems } = useMnemoStore();
  const colors = useThemeColors();
  const theme = useThemeName();
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
            source={
              theme === 'dark'
                ? require('@/assets/Mnemo_logo_dark.png')
                : require('@/assets/Mnemo_logo_light.png')
            }
            style={{ width: 40, height: 40, marginRight: 12 }}
            resizeMode="contain"
            accessibilityLabel="Mnemo logo"
          />
          <View className="justify-center">
            <Text className="text-fg font-display text-heading tracking-wide leading-tight">Mnemo</Text>
            <Text className="text-fg-tertiary font-sans text-xs mt-0.5">{greeting}</Text>
          </View>
        </View>

        <IconButton
          icon="settings"
          label="Open settings"
          onPress={() => router.push('/modal' as any)}
        />
      </View>

      {/* Main Content Area */}
      <View className="px-6">
        <SectionHeader
          title="Resume your thought"
          icon="sparkles"
          meta={
            activeItems.length > 0
              ? `${activeItems.length} active ${activeItems.length === 1 ? 'thread' : 'threads'}`
              : undefined
          }
          className="mb-4"
        />

        {/* Hero Resume Card */}
        {latestItem ? (
          <PulseResumeCard item={latestItem} />
        ) : (
          <Card variant="dashed" pad="lg" className="items-center justify-center mb-8">
            <View
              className="w-12 h-12 rounded-full items-center justify-center mb-3"
              style={{ backgroundColor: colors.primaryContainer }}
            >
              <Icon name="check" size={22} color={colors.onPrimaryContainer} />
            </View>
            <Text className="text-fg font-sans-medium text-body text-center mb-1">All caught up!</Text>
            <Text className="text-fg-secondary font-sans text-xs text-center leading-relaxed">
              No paused thoughts waiting.{'\n'}Use the Record button at the bottom-right, or Note, to capture a new thought.
            </Text>
          </Card>
        )}

        {/* Paused threads */}
        {secondaryItems.length > 0 && (
          <View className="mb-8">
            <SectionHeader
              title="Paused threads"
              eyebrow
              action="View all"
              onAction={() => router.push('/(tabs)/library' as any)}
              className="mb-3"
            />
            <View className="gap-1.5">
              {secondaryItems.map((item, index) => {
                const config = categories[item.category];
                const CategoryIcon = config.icon;
                const preview = item.nextStep || item.whereLeftOff || item.content?.trim() || '';
                return (
                  <MotiView key={item.id} {...enter.row(index)}>
                    <Card
                      pad="sm"
                      interactive
                      animated={false}
                      className="flex-row items-center"
                      onPress={() => router.push(`/(tabs)/context?id=${item.id}` as any)}
                    >
                      <View
                        className="w-9 h-9 rounded-full items-center justify-center mr-3"
                        style={{ backgroundColor: config.bgTint }}
                      >
                        <CategoryIcon size={15} color={config.color} strokeWidth={2} />
                      </View>
                      <View className="flex-1 mr-3">
                        <Text className="text-fg font-sans-medium text-sm" numberOfLines={1}>
                          {item.title}
                        </Text>
                        {preview ? (
                          <Text className="text-fg-tertiary font-sans text-xs" numberOfLines={1}>
                            {preview}
                          </Text>
                        ) : null}
                      </View>
                      <Text className="text-fg-tertiary font-sans text-xs">
                        {formatCompactDistance(item.updatedAt)}
                      </Text>
                    </Card>
                  </MotiView>
                );
              })}
            </View>
          </View>
        )}

        {/* Categories */}
        <View>
          <SectionHeader
            title="Categories"
            eyebrow
            action="View all"
            onAction={() => router.push('/(tabs)/library' as any)}
            className="mb-3"
          />

          <View className="flex-row flex-wrap gap-2.5">
            {Object.entries(categories).map(([key, config]) => {
              const CategoryIcon = config.icon;
              const count = items.filter((i) => i.category === key && i.status !== 'archived').length;

              return (
                <Card
                  key={key}
                  pad="sm"
                  interactive
                  className="flex-1 min-w-35 flex-row items-center"
                  onPress={() => router.push(`/(tabs)/library?category=${key}` as any)}
                >
                  <View
                    className="w-8 h-8 rounded-full items-center justify-center mr-2.5"
                    style={{ backgroundColor: config.bgTint }}
                  >
                    <CategoryIcon size={14} color={config.color} strokeWidth={2} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-fg font-sans-medium text-xs" numberOfLines={1}>
                      {config.label}
                    </Text>
                    <Text className="text-fg-tertiary font-sans text-micro">
                      {count} {count === 1 ? 'note' : 'notes'}
                    </Text>
                  </View>
                </Card>
              );
            })}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}
