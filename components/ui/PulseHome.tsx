import React from 'react';
import { View, ScrollView, Pressable } from 'react-native';
import { Text } from '@/components/ui/Text';
import { MotiView } from 'moti';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card } from '@/components/ui/Card';
import { ReminderSetupPrompt } from '@/components/ReminderSetupPrompt';
import { BackupPrompt } from '@/components/BackupPrompt';
import { Button, IconButton } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { ThreadList, ThreadRow } from '@/components/ui/ThreadRow';
import { OpenRing } from '@/components/ui/ThreadRing';
import { formatReminder, nextOccurrence, resumeOrder, resumeReason, type ResumeReason } from '@/lib/when';
import { CONTENT_BOTTOM_CLEARANCE } from '@/components/ui/FloatingTabBar';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import { useAiProblem, type AiProblem } from '@/lib/ai-mode';
import { usePreferences } from '@/lib/preferences';
import { formatCompactDistance, DAY_MS } from '@/utils/time';
import { CATEGORY_LIST, useCategories } from '@/utils/categories';
import { useEnter } from '@/utils/motion';
import type { MnemoItem } from '@/types/mnemo';

/** How far ahead "Coming up" looks for due dates. */
const COMING_UP_DAYS = 7;
/** Threads after the resume card, in the same order, under "Up next". */
const UP_NEXT_LIMIT = 3;
/** Rows under "Coming up" before deferring to the Library. */
const COMING_UP_LIMIT = 3;

const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
/** Small counts read better spelled out in a sentence. */
const numberWord = (n: number) => NUMBER_WORDS[n] ?? String(n);

const openItem = (id: string) => router.push(`/(tabs)/context?id=${id}`);

/** What the resume card's chip says: why this thread is first. */
function reasonChip(reason: NonNullable<ResumeReason>, repeats: boolean): { icon: IconName; label: string } {
  switch (reason.kind) {
    case 'missed':
      return { icon: 'clock', label: `Missed · ${formatReminder(reason.at)}` };
    case 'due':
      return { icon: repeats ? 'repeat' : 'clock', label: `Due ${formatReminder(reason.at).replace(/^(Today|Tomorrow)/, (w) => w.toLowerCase())}` };
    case 'starred':
      return { icon: 'star', label: 'Starred' };
    case 'focus':
      return { icon: 'pin', label: 'Capturing here' };
    case 'recent':
      return { icon: 'pencil', label: 'You were just here' };
  }
}

/**
 * ResumeCard — the one inverted surface on the page: the thread to pick
 * back up, why it's first, and its next step. Kept short so what's next
 * shows without scrolling.
 */
function ResumeCard({ item, reason }: { item: MnemoItem; reason: ResumeReason }) {
  const colors = useThemeColors();
  const categories = useCategories();
  const category = categories[item.category];
  const checklist = item.type === 'checklist' ? item.checklistItems ?? [] : [];
  const done = checklist.filter((c) => c.checked).length;
  const chip = reason ? reasonChip(reason, !!item.repeat) : null;
  const chipTone = reason?.kind === 'missed' ? colors.onHero : colors.heroAccent;
  // A reminder further off than the chip covers still shows, in place of the age.
  const dueAt = item.dueDate ? nextOccurrence(item.dueDate, item.repeat) : undefined;
  const aside =
    dueAt !== undefined && reason?.kind !== 'due' && reason?.kind !== 'missed'
      ? formatReminder(dueAt)
      : `${item.status === 'paused' ? 'Paused' : category.label} · ${formatCompactDistance(item.updatedAt)}`;

  return (
    <Pressable
      onPress={() => openItem(item.id)}
      accessibilityRole="button"
      accessibilityLabel={`Resume ${item.title}${chip ? `. ${chip.label}` : ''}`}
      className="overflow-hidden mb-7 active:opacity-95"
      style={{ backgroundColor: colors.hero, borderRadius: 30 }}
    >
      {/* The mark, oversized and cropped off the corner. */}
      <View pointerEvents="none" style={{ position: 'absolute', top: -40, right: -36, opacity: 0.1 }}>
        <OpenRing size={160} color={colors.onHero} core={false} weight={0.11} />
      </View>

      <View className="p-5">
        <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
          {chip ? (
            <View className="flex-row items-center rounded-full px-3 h-7 shrink" style={{ backgroundColor: colors.heroSoft }}>
              <Icon name={chip.icon} size={13} color={chipTone} stroke={2} />
              <Text className="font-sans-semi text-sm ml-1.5" style={{ color: chipTone }} numberOfLines={1}>
                {chip.label}
              </Text>
            </View>
          ) : (
            <View />
          )}
          <Text className="font-sans text-sm shrink" style={{ color: colors.onHeroMuted }} numberOfLines={1}>
            {aside}
          </Text>
        </View>

        <Text className="font-display leading-tight mt-3.5" style={{ color: colors.onHero, fontSize: 24 }} numberOfLines={2}>
          {item.title}
        </Text>

        <View className="flex-row items-center pt-3.5 mt-4" style={{ borderTopWidth: 1, borderTopColor: colors.heroSoft, gap: 12 }}>
          <View className="flex-1" style={{ minWidth: 0 }}>
            {item.nextStep ? (
              <>
                <Text className="font-sans-semi text-xs uppercase tracking-caps mb-0.5" style={{ color: colors.heroAccent }}>
                  Next
                </Text>
                <Text className="font-sans-medium text-body leading-snug" style={{ color: colors.onHero }} numberOfLines={2}>
                  {item.nextStep}
                </Text>
              </>
            ) : checklist.length > 0 ? (
              <>
                <View className="h-1.5 rounded-full overflow-hidden mb-2" style={{ backgroundColor: colors.heroSoft }}>
                  <View className="h-full rounded-full" style={{ width: `${(done / checklist.length) * 100}%`, backgroundColor: colors.heroAccent }} />
                </View>
                <Text className="font-sans text-xs" style={{ color: colors.onHeroMuted }}>
                  {done} of {checklist.length} done
                </Text>
              </>
            ) : item.whereLeftOff ? (
              <Text className="font-quote text-body leading-snug" style={{ color: colors.onHeroMuted }} numberOfLines={2}>
                “{item.whereLeftOff}”
              </Text>
            ) : (
              <Text className="font-sans-semi text-body" style={{ color: colors.onHero }}>
                Resume
              </Text>
            )}
          </View>
          <View className="w-12 h-12 rounded-full items-center justify-center" style={{ backgroundColor: colors.onHero }}>
            <Icon name="play" size={18} stroke={2.2} color={colors.hero} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const AI_PROBLEM_TEXT: Record<AiProblem, string> = {
  invalid: "Gemini isn't accepting your key. Notes are saved as you wrote them.",
  quota: "Your Gemini key's daily limit is used up. Notes are saved and tidied up later.",
};

export function PulseHome() {
  const enter = useEnter();
  const aiProblem = useAiProblem();
  const insets = useSafeAreaInsets();
  const { items, getActiveItems, focusThreadId, setFocusThread } = useMnemoStore();
  const focusThread = focusThreadId ? items.find((i) => i.id === focusThreadId) : undefined;
  const colors = useThemeColors();
  const categories = useCategories();

  const activeItems = resumeOrder(getActiveItems(), { focusId: focusThreadId });
  const latestItem = activeItems[0];
  const reason = latestItem ? resumeReason(latestItem, { focusId: focusThreadId }) : null;

  const now = Date.now();
  // The next few of the same ranking, so the order is visible, not just its winner.
  const upNext = activeItems.slice(1, 1 + UP_NEXT_LIMIT);
  const shownIds = new Set([latestItem?.id, ...upNext.map((i) => i.id)]);
  const comingUp = activeItems
    .filter((i) => !shownIds.has(i.id) && i.dueDate && i.dueDate < now + COMING_UP_DAYS * DAY_MS)
    .sort((a, b) => (a.dueDate ?? 0) - (b.dueDate ?? 0));
  const dueSoon = (i: MnemoItem) => !!i.dueDate && i.dueDate < now + COMING_UP_DAYS * DAY_MS;

  const categoryCounts = CATEGORY_LIST.map((key) => ({
    key,
    count: items.filter((i) => i.category === key && i.status !== 'archived').length,
  })).filter((c) => c.count > 0);

  const openCount = activeItems.length;
  const dueThisWeek = activeItems.filter((i) => i.dueDate && i.dueDate < now + COMING_UP_DAYS * DAY_MS).length;
  const summary =
    openCount === 0
      ? ''
      : `${openCount === 1 ? 'One thread' : numberWord(openCount)} open` +
        (dueThisWeek > 0 ? `, ${numberWord(dueThisWeek).toLowerCase()} due this week.` : '.');

  const { name } = usePreferences();
  const greeting = React.useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 5) return name ? `Still up, ${name}?` : 'Still up?';
    const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    return name ? `${part}, ${name}` : part;
  }, [name]);
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
        className="px-6 mb-5"
        style={{ paddingTop: Math.max(insets.top + 8, 20) }}
      >
        <View className="flex-row items-center justify-between mb-1">
          <Text className="font-sans-medium text-sm" style={{ color: colors.fgTertiary }}>
            {today}
          </Text>
          <IconButton icon="settings" label="Open settings" variant="bare" onPress={() => router.push('/modal')} />
        </View>
        <Text
          className="font-display leading-tight"
          style={{ color: colors.fg, fontSize: 30, letterSpacing: -0.4 }}
          numberOfLines={2}
        >
          {greeting}
        </Text>
        {/* How much is open, and one tap to the week. */}
        {summary || items.length > 0 ? (
          <View className="flex-row items-center justify-between mt-1" style={{ gap: 12 }}>
            <Text className="font-quote text-body leading-relaxed shrink" style={{ color: colors.fgSecondary }} numberOfLines={1}>
              {summary}
            </Text>
            {items.length > 0 ? (
              <Pressable
                onPress={() => router.push('/review')}
                accessibilityRole="button"
                accessibilityLabel="Your week"
                hitSlop={8}
                className="flex-row items-center h-11 active:opacity-70"
              >
                <Text className="font-sans-semi text-sm" style={{ color: colors.accent }}>
                  Your week
                </Text>
                <Icon name="chevronRight" size={14} color={colors.accent} stroke={2} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {/* Where quick captures are going, while a focus thread is set */}
        {focusThread ? (
          <View
            className="flex-row items-center self-start rounded-full pl-3 pr-1.5 h-10 mt-4"
            style={{ backgroundColor: colors.accentSoft, maxWidth: '100%' }}
          >
            <Pressable
              onPress={() => router.push(`/(tabs)/context?id=${focusThread.id}`)}
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
        {/* No backup in a while, or automatic backups stopped working. */}
        <BackupPrompt />
        {/* Gemini stopped answering for a reason the person can fix. */}
        {aiProblem ? (
          <Pressable
            onPress={() => router.push('/modal')}
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
            <ResumeCard item={latestItem} reason={reason} />
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
                <Button variant="primary" icon="mic" className="flex-1" onPress={() => router.push('/dump')}>
                  Record
                </Button>
                <Button variant="quiet" icon="pencil" className="flex-1" onPress={() => router.push('/capture')}>
                  Write
                </Button>
              </View>
            </Card>
          </MotiView>
        )}

        {/* Up next: the rest of the same ranking */}
        {upNext.length > 0 && (
          <MotiView {...enter.rise(2)} className="mb-7">
            <Eyebrow
              action={openCount > 1 + upNext.length ? `See all ${openCount}` : undefined}
              onAction={() => router.push('/(tabs)/library')}
            >
              Up next
            </Eyebrow>
            <ThreadList>
              {upNext.map((item, i, shown) => (
                <ThreadRow
                  key={item.id}
                  item={item}
                  index={i}
                  onPress={() => openItem(item.id)}
                  trailing={dueSoon(item) ? formatReminder(item.dueDate!) : undefined}
                  trailingTone={dueSoon(item) ? ((item.dueDate ?? 0) < now ? colors.error : colors.accent) : undefined}
                  last={i === shown.length - 1}
                />
              ))}
            </ThreadList>
          </MotiView>
        )}

        {/* Coming up: dates not already shown above */}
        {comingUp.length > 0 && (
          <MotiView {...enter.rise(3)} className="mb-8">
            <Eyebrow
              action={comingUp.length > COMING_UP_LIMIT ? `All ${comingUp.length}` : undefined}
              onAction={() => router.push('/(tabs)/library')}
            >
              Coming up
            </Eyebrow>
            <ThreadList>
              {comingUp.slice(0, COMING_UP_LIMIT).map((item, i, shown) => {
                const overdue = (item.dueDate ?? 0) < now;
                return (
                  <ThreadRow
                    key={item.id}
                    item={item}
                    index={i}
                    onPress={() => openItem(item.id)}
                    trailing={formatReminder(item.dueDate!)}
                    trailingTone={overdue ? colors.error : colors.accent}
                    last={i === shown.length - 1}
                  />
                );
              })}
            </ThreadList>
          </MotiView>
        )}

        {/* Browse — only categories that hold something */}
        {categoryCounts.length > 0 && (
          <MotiView {...enter.rise(4)}>
            <Eyebrow action="Library" onAction={() => router.push('/(tabs)/library')}>
              Browse
            </Eyebrow>
            <View className="flex-row flex-wrap gap-2">
              {categoryCounts.map(({ key, count }) => {
                const config = categories[key];
                const CategoryIcon = config.icon;
                return (
                  <Pressable
                    key={key}
                    onPress={() => router.push(`/(tabs)/library?category=${key}`)}
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
