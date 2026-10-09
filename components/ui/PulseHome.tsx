import React from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { MotiView } from 'moti';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card } from '@/components/ui/Card';
import { Button, IconButton } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { OpenRing, ThreadRing } from '@/components/ui/ThreadRing';
import { formatDueDate } from '@/components/ui/DueDatePicker';
import { CONTENT_BOTTOM_CLEARANCE } from '@/components/ui/FloatingTabBar';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import { formatCompactDistance, freshness } from '@/utils/time';
import { CATEGORY_LIST, useCategories } from '@/utils/categories';
import { useEnter } from '@/utils/motion';
import type { MnemoItem } from '@/types/mnemo';

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far ahead "Coming up" looks for due dates. */
const COMING_UP_DAYS = 7;
/** Rows shown under "Also in progress" before deferring to the Library. */
const IN_PROGRESS_LIMIT = 4;

const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
/** Small counts read better spelled out in a sentence. */
const numberWord = (n: number) => NUMBER_WORDS[n] ?? String(n);

const openItem = (id: string) => router.push(`/(tabs)/context?id=${id}` as any);

/** Small eyebrow label above a home section. */
function SectionLabel({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const colors = useThemeColors();
  return (
    <View className="flex-row items-center justify-between mb-2.5 px-1">
      <Text className="font-sans-semi text-micro uppercase tracking-caps" style={{ color: colors.fgTertiary }}>
        {title}
      </Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button">
          <Text className="font-sans-semi text-xs" style={{ color: colors.accent }}>
            {action}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** ResumeCard — the one inverted surface on the page: the thread to pick back up. */
function ResumeCard({ item }: { item: MnemoItem }) {
  const colors = useThemeColors();
  const categories = useCategories();
  const category = categories[item.category];
  const CategoryIcon = category.icon;
  const checklist = item.type === 'checklist' ? item.checklistItems ?? [] : [];
  const done = checklist.filter((c) => c.checked).length;

  return (
    <Pressable
      onPress={() => openItem(item.id)}
      accessibilityRole="button"
      accessibilityLabel={`Resume ${item.title}`}
      className="rounded-xl overflow-hidden mb-10 active:opacity-95"
      style={{ backgroundColor: colors.hero }}
    >
      {/* The mark, oversized and cropped off the corner. */}
      <View pointerEvents="none" style={{ position: 'absolute', top: -34, right: -22, opacity: 0.1 }}>
        <OpenRing size={220} color={colors.onHero} core={false} weight={0.11} />
      </View>

      <View className="p-6">
        <View className="flex-row items-center mb-6">
          <ThreadRing
            size={34}
            progress={freshness(item.updatedAt)}
            color={colors.heroAccent}
            trackColor={colors.heroSoft}
            strokeWidth={2}
          >
            <CategoryIcon size={13} color={colors.onHero} strokeWidth={2} />
          </ThreadRing>
          <View className="ml-3">
            <Text className="font-sans-semi text-xs" style={{ color: colors.onHero }}>
              {category.label}
            </Text>
            <Text className="font-sans text-xs" style={{ color: colors.onHeroMuted }}>
              {item.status === 'paused' ? 'Paused' : 'Away'} {formatCompactDistance(item.updatedAt)}
            </Text>
          </View>
        </View>

        <Text className="font-display leading-tight mb-5" style={{ color: colors.onHero, fontSize: 30 }} numberOfLines={3}>
          {item.title}
        </Text>

        {item.whereLeftOff ? (
          <Text className="font-quote text-body leading-relaxed mb-5" style={{ color: colors.onHeroMuted }} numberOfLines={3}>
            “{item.whereLeftOff}”
          </Text>
        ) : null}

        {item.nextStep ? (
          <View className="flex-row items-start pt-4 mb-6" style={{ borderTopWidth: 1, borderTopColor: colors.heroSoft }}>
            <Text className="font-sans-semi text-micro uppercase tracking-caps mt-0.5 mr-3" style={{ color: colors.heroAccent }}>
              Next
            </Text>
            <Text className="flex-1 font-sans-medium text-sm leading-snug" style={{ color: colors.onHero }} numberOfLines={2}>
              {item.nextStep}
            </Text>
          </View>
        ) : checklist.length > 0 ? (
          <View className="pt-4 mb-6" style={{ borderTopWidth: 1, borderTopColor: colors.heroSoft }}>
            <View className="h-1.5 rounded-full overflow-hidden mb-2" style={{ backgroundColor: colors.heroSoft }}>
              <View className="h-full rounded-full" style={{ width: `${(done / checklist.length) * 100}%`, backgroundColor: colors.heroAccent }} />
            </View>
            <Text className="font-sans text-xs" style={{ color: colors.onHeroMuted }}>
              {done} of {checklist.length} done
            </Text>
          </View>
        ) : (
          <View className="mb-1" />
        )}

        <View className="flex-row items-center justify-between rounded-full pl-5 pr-1.5" style={{ backgroundColor: colors.onHero, height: 52 }}>
          <Text className="font-sans-semi text-body" style={{ color: colors.hero }}>
            Resume
          </Text>
          <View className="w-10 h-10 rounded-full items-center justify-center" style={{ backgroundColor: colors.hero }}>
            <Icon name="play" size={16} stroke={2.2} color={colors.onHero} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

/** One row inside a grouped list. `detail` sits under the title; `trailing` on the right. */
function ThreadRow({
  item,
  detail,
  trailing,
  trailingTone,
  last,
}: {
  item: MnemoItem;
  detail?: string;
  trailing: string;
  trailingTone?: string;
  last: boolean;
}) {
  const colors = useThemeColors();
  const categories = useCategories();
  const category = categories[item.category];
  const CategoryIcon = category.icon;

  return (
    <Pressable
      onPress={() => openItem(item.id)}
      accessibilityRole="button"
      style={({ pressed }) => ({ backgroundColor: pressed ? colors.surfaceHigh : 'transparent' })}
    >
      <View className="flex-row items-center px-4 py-3.5">
        <View className="mr-3">
          <ThreadRing size={40} progress={freshness(item.updatedAt)} color={category.color} trackColor={category.bgTint}>
            <CategoryIcon size={15} color={category.color} strokeWidth={2} />
          </ThreadRing>
        </View>
        <View className="flex-1 mr-3" style={{ minWidth: 0 }}>
          <Text className="font-sans-medium text-sm" style={{ color: colors.fg }} numberOfLines={1}>
            {item.title}
          </Text>
          {detail ? (
            <Text className="font-sans text-xs mt-0.5" style={{ color: colors.fgTertiary }} numberOfLines={1}>
              {detail}
            </Text>
          ) : null}
        </View>
        <Text className="font-sans-medium text-xs" style={{ color: trailingTone ?? colors.fgTertiary }}>
          {trailing}
        </Text>
      </View>
      {!last && <View className="mr-4" style={{ marginLeft: 68, height: 1, backgroundColor: colors.border }} />}
    </Pressable>
  );
}

/** PulseHome — the Home tab: greeting, one resume hero, what's due, what else is open. */
export function PulseHome() {
  const enter = useEnter();
  const insets = useSafeAreaInsets();
  const { items, getActiveItems } = useMnemoStore();
  const colors = useThemeColors();
  const categories = useCategories();

  const activeItems = getActiveItems();
  const latestItem = activeItems[0];

  const now = Date.now();
  const comingUp = activeItems
    .filter((i) => i.id !== latestItem?.id && i.dueDate && i.dueDate < now + COMING_UP_DAYS * DAY_MS)
    .sort((a, b) => (a.dueDate ?? 0) - (b.dueDate ?? 0));
  const comingUpIds = new Set(comingUp.map((i) => i.id));
  const inProgress = activeItems.filter((i) => i.id !== latestItem?.id && !comingUpIds.has(i.id));

  const categoryCounts = CATEGORY_LIST.map((key) => ({
    key,
    count: items.filter((i) => i.category === key && i.status !== 'archived').length,
  })).filter((c) => c.count > 0);

  const openCount = activeItems.length;
  const dueThisWeek = activeItems.filter((i) => i.dueDate && i.dueDate < now + COMING_UP_DAYS * DAY_MS).length;
  const summary =
    openCount === 0
      ? ''
      : `${openCount === 1 ? 'One thread' : `${numberWord(openCount)} threads`} open` +
        (dueThisWeek > 0 ? `, ${numberWord(dueThisWeek).toLowerCase()} due this week.` : '.');

  const greeting = React.useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 5) return 'Still up?';
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);
  const today = React.useMemo(
    () => new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
    [],
  );

  return (
    <ScrollView
      className="flex-1"
      showsVerticalScrollIndicator={false}
      // Clear the edge-to-edge nav bar plus the FAB stack floating above it.
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + CONTENT_BOTTOM_CLEARANCE }}
    >
      {/* Header */}
      <MotiView
        {...enter.rise(0)}
        className="px-6 mb-8"
        style={{ paddingTop: Math.max(insets.top + 8, 20) }}
      >
        <View className="flex-row items-center justify-between mb-1">
          <Text className="font-sans-medium text-xs" style={{ color: colors.fgTertiary }}>
            {today}
          </Text>
          <IconButton icon="settings" label="Open settings" variant="bare" onPress={() => router.push('/modal' as any)} />
        </View>
        <Text className="font-display leading-tight" style={{ color: colors.fg, fontSize: 38, letterSpacing: -0.6 }}>
          {greeting}
        </Text>
        {summary ? (
          <Text className="font-quote text-body leading-relaxed mt-1.5" style={{ color: colors.fgSecondary }}>
            {summary}
          </Text>
        ) : null}
      </MotiView>

      <View className="px-5">
        {/* Hero */}
        {latestItem ? (
          <MotiView {...enter.rise(1)}>
            <SectionLabel title="Pick up where you left off" />
            <ResumeCard item={latestItem} />
          </MotiView>
        ) : (
          <MotiView {...enter.rise(1)}>
            <Card variant="surface" pad="lg" animated={false} className="mb-9">
              <Text className="font-display text-title leading-tight mb-2" style={{ color: colors.fg }}>
                Nothing in progress
              </Text>
              <Text className="font-sans text-sm leading-relaxed mb-5" style={{ color: colors.fgSecondary }}>
                Capture a thought with the + button, or hold it to start recording straight away. It lands here, ready to pick back up.
              </Text>
              <View className="flex-row gap-2">
                <Button variant="primary" icon="mic" className="flex-1" onPress={() => router.push('/dump' as any)}>
                  Record
                </Button>
                <Button variant="quiet" icon="pencil" className="flex-1" onPress={() => router.push('/capture' as any)}>
                  Write
                </Button>
              </View>
            </Card>
          </MotiView>
        )}

        {/* Coming up */}
        {comingUp.length > 0 && (
          <MotiView {...enter.rise(2)} className="mb-8">
            <SectionLabel title="Coming up" />
            <Card variant="surface" pad="none" animated={false} className="overflow-hidden">
              {comingUp.map((item, i) => {
                const overdue = (item.dueDate ?? 0) < now;
                return (
                  <ThreadRow
                    key={item.id}
                    item={item}
                    detail={item.nextStep || item.whereLeftOff}
                    trailing={formatDueDate(item.dueDate!).replace(/^Due /, '')}
                    trailingTone={overdue ? colors.error : colors.accent}
                    last={i === comingUp.length - 1}
                  />
                );
              })}
            </Card>
          </MotiView>
        )}

        {/* Also in progress */}
        {inProgress.length > 0 && (
          <MotiView {...enter.rise(3)} className="mb-8">
            <SectionLabel
              title="Also in progress"
              action={inProgress.length > IN_PROGRESS_LIMIT ? `All ${inProgress.length}` : undefined}
              onAction={() => router.push('/(tabs)/library' as any)}
            />
            <Card variant="surface" pad="none" animated={false} className="overflow-hidden">
              {inProgress.slice(0, IN_PROGRESS_LIMIT).map((item, i, shown) => (
                <ThreadRow
                  key={item.id}
                  item={item}
                  detail={
                    (item.status === 'paused' ? 'Paused · ' : '') +
                    (item.nextStep || item.whereLeftOff || item.content?.trim() || '')
                  }
                  trailing={formatCompactDistance(item.updatedAt)}
                  last={i === shown.length - 1}
                />
              ))}
            </Card>
          </MotiView>
        )}

        {/* Browse — only categories that hold something */}
        {categoryCounts.length > 0 && (
          <MotiView {...enter.rise(4)}>
            <SectionLabel title="Browse" action="Library" onAction={() => router.push('/(tabs)/library' as any)} />
            <View className="flex-row flex-wrap gap-2">
              {categoryCounts.map(({ key, count }) => {
                const config = categories[key];
                const CategoryIcon = config.icon;
                return (
                  <Pressable
                    key={key}
                    onPress={() => router.push(`/(tabs)/library?category=${key}` as any)}
                    accessibilityRole="button"
                    accessibilityLabel={`${config.label}, ${count} ${count === 1 ? 'note' : 'notes'}`}
                    className="flex-row items-center rounded-full pl-2 pr-3.5 h-10 active:opacity-70"
                    style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
                  >
                    <View className="w-6 h-6 rounded-full items-center justify-center mr-2" style={{ backgroundColor: config.bgTint }}>
                      <CategoryIcon size={12} color={config.color} strokeWidth={2.2} />
                    </View>
                    <Text className="font-sans-medium text-sm" style={{ color: colors.fg }}>
                      {config.label}
                    </Text>
                    <Text className="font-sans text-sm ml-1.5" style={{ color: colors.fgTertiary }}>
                      {count}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </MotiView>
        )}
      </View>
    </ScrollView>
  );
}
