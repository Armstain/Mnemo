import React from 'react';
import { View, ScrollView, Pressable } from 'react-native';
import { Text } from '@/components/ui/Text';
import { MotiView } from 'moti';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card } from '@/components/ui/Card';
import { ReminderSetupPrompt } from '@/components/ReminderSetupPrompt';
import { Button, IconButton } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { ThreadList, ThreadRow } from '@/components/ui/ThreadRow';
import { OpenRing, ThreadRing } from '@/components/ui/ThreadRing';
import { formatReminder, resumeOrder } from '@/lib/when';
import { shortLine, weekReview } from '@/lib/review';
import { CONTENT_BOTTOM_CLEARANCE } from '@/components/ui/FloatingTabBar';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import { useAiProblem, type AiProblem } from '@/lib/ai-mode';
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
          <View className="ml-3 flex-1">
            <Text className="font-sans-semi text-sm" style={{ color: colors.onHero }}>
              {category.label}
            </Text>
            <Text className="font-sans text-sm" style={{ color: colors.onHeroMuted }}>
              {item.status === 'paused' ? 'Paused' : 'Away'} {formatCompactDistance(item.updatedAt)}
            </Text>
          </View>
          {item.starred ? <Icon name="star" size={16} color={colors.heroAccent} stroke={2} /> : null}
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
            <Text className="font-sans-semi text-xs uppercase tracking-caps mt-1 mr-3" style={{ color: colors.heroAccent }}>
              Next
            </Text>
            <Text className="flex-1 font-sans-medium text-body leading-snug" style={{ color: colors.onHero }} numberOfLines={2}>
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

/** PulseHome — the Home tab: greeting, one resume hero, what's due, what else is open. */
const AI_PROBLEM_TEXT: Record<AiProblem, string> = {
  invalid: "Gemini isn't accepting your key. Notes are saved as you wrote them.",
  quota: "Your Gemini key's daily limit is used up. Notes are saved and tidied up later.",
};

export function PulseHome() {
  const enter = useEnter();
  const aiProblem = useAiProblem();
  const insets = useSafeAreaInsets();
  const { items, entries, getActiveItems, focusThreadId, setFocusThread } = useMnemoStore();
  const weekLine = React.useMemo(() => shortLine(weekReview(items, entries)), [items, entries]);
  const focusThread = focusThreadId ? items.find((i) => i.id === focusThreadId) : undefined;
  const colors = useThemeColors();
  const categories = useCategories();

  const activeItems = resumeOrder(getActiveItems(), { focusId: focusThreadId });
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
          <Text className="font-sans-medium text-sm" style={{ color: colors.fgTertiary }}>
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
        {/* The weekly review: one tap to see the week. */}
        {items.length > 0 ? (
          <Pressable
            onPress={() => router.push('/review' as any)}
            accessibilityRole="button"
            accessibilityLabel={`Your week. ${weekLine}`}
            className="flex-row items-center self-start rounded-full pl-3 pr-2.5 h-9 mt-3 active:opacity-70"
            style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, maxWidth: '100%' }}
          >
            <Icon name="calendar" size={14} color={colors.accent} stroke={2} />
            <Text className="font-sans-semi text-sm ml-2" style={{ color: colors.fg }}>
              Your week
            </Text>
            <Text className="font-sans text-sm ml-1.5 shrink" style={{ color: colors.fgTertiary }} numberOfLines={1}>
              {weekLine}
            </Text>
            <Icon name="chevronRight" size={14} color={colors.fgTertiary} />
          </Pressable>
        ) : null}
        {/* Where quick captures are going, while a focus thread is set */}
        {focusThread ? (
          <View
            className="flex-row items-center self-start rounded-full pl-3 pr-1.5 h-10 mt-4"
            style={{ backgroundColor: colors.accentSoft, maxWidth: '100%' }}
          >
            <Pressable
              onPress={() => router.push(`/(tabs)/context?id=${focusThread.id}` as any)}
              accessibilityRole="button"
              accessibilityLabel={`Quick captures go to ${focusThread.title}. Open it.`}
              className="flex-row items-center shrink h-10 active:opacity-70"
            >
              <Icon name="pin" size={15} color={colors.accent} stroke={2.2} />
              <Text className="font-sans-medium text-sm ml-2 mr-2 shrink" style={{ color: colors.fg }} numberOfLines={1}>
                Capturing into <Text className="font-sans-semi">{focusThread.title}</Text>
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setFocusThread(null)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Stop sending quick captures there"
              className="rounded-full px-3 h-7 items-center justify-center active:opacity-70"
              style={{ backgroundColor: colors.surfaceLowest }}
            >
              <Text className="font-sans-semi text-sm" style={{ color: colors.accent }}>
                Stop
              </Text>
            </Pressable>
          </View>
        ) : null}
        {/* Strict phones: a one-time nudge to check reminders will arrive. */}
        <ReminderSetupPrompt />
        {/* Gemini stopped answering for a reason the person can fix. */}
        {aiProblem ? (
          <Pressable
            onPress={() => router.push('/modal' as any)}
            accessibilityRole="button"
            accessibilityLabel={`${AI_PROBLEM_TEXT[aiProblem]} Open settings.`}
            className="flex-row items-center rounded-lg px-4 py-3 mt-4 active:opacity-80"
            style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
          >
            <Icon name="sparkles" size={16} color={colors.accentWarm} />
            <Text className="flex-1 font-sans text-sm leading-snug mx-3" style={{ color: colors.fgSecondary }}>
              {AI_PROBLEM_TEXT[aiProblem]}
            </Text>
            <Text className="font-sans-semi text-sm" style={{ color: colors.accent }}>
              Fix
            </Text>
          </Pressable>
        ) : null}
      </MotiView>

      <View className="px-5">
        {/* Hero */}
        {latestItem ? (
          <MotiView {...enter.rise(1)}>
            <Eyebrow>Pick up where you left off</Eyebrow>
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
            <Eyebrow>Coming up</Eyebrow>
            <ThreadList>
              {comingUp.map((item, i) => {
                const overdue = (item.dueDate ?? 0) < now;
                return (
                  <ThreadRow
                    key={item.id}
                    item={item}
                    index={i}
                    onPress={() => openItem(item.id)}
                    trailing={formatReminder(item.dueDate!)}
                    trailingTone={overdue ? colors.error : colors.accent}
                    last={i === comingUp.length - 1}
                  />
                );
              })}
            </ThreadList>
          </MotiView>
        )}

        {/* Also in progress */}
        {inProgress.length > 0 && (
          <MotiView {...enter.rise(3)} className="mb-8">
            <Eyebrow
              action={inProgress.length > IN_PROGRESS_LIMIT ? `All ${inProgress.length}` : undefined}
              onAction={() => router.push('/(tabs)/library' as any)}
            >
              Also in progress
            </Eyebrow>
            <ThreadList>
              {inProgress.slice(0, IN_PROGRESS_LIMIT).map((item, i, shown) => (
                <ThreadRow
                  key={item.id}
                  item={item}
                  index={i}
                  onPress={() => openItem(item.id)}
                  last={i === shown.length - 1}
                />
              ))}
            </ThreadList>
          </MotiView>
        )}

        {/* Browse — only categories that hold something */}
        {categoryCounts.length > 0 && (
          <MotiView {...enter.rise(4)}>
            <Eyebrow action="Library" onAction={() => router.push('/(tabs)/library' as any)}>
              Browse
            </Eyebrow>
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
