import React from 'react';
import { View, ScrollView, Pressable } from 'react-native';
import { Text } from '@/components/ui/Text';
import { MotiView } from 'moti';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Card, useSurfaceStyle } from '@/components/ui/Card';
import { FocusPill } from '@/components/ui/FocusPill';
import { ReminderSetupPrompt } from '@/components/ReminderSetupPrompt';
import { PlaceReminderPrompt } from '@/components/PlaceReminderPrompt';
import { BackupPrompt } from '@/components/BackupPrompt';
import { Button, IconButton } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { ThreadList, ThreadRow } from '@/components/ui/ThreadRow';
import { OpenRing } from '@/components/ui/ThreadRing';
import { formatReminder, nextOccurrence, resumeOrder, resumeReason, type ResumeReason } from '@/lib/when';
import { NAV_CLEARANCE } from '@/components/ui/nav-layout';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import { useAiNotice, useAiProblem, useAiProblemDetail, type AiProblem } from '@/lib/ai-mode';
import { usePreferences } from '@/lib/preferences';
import { formatCompactDistance, DAY_MS } from '@/utils/time';
import { sameWords } from '@/utils/text';
import { useCategories } from '@/hooks/use-categories';
import { useEnter } from '@/hooks/use-enter';
import { useReduceMotion } from '@/hooks/use-accessibility-motion';
import { flightsEnabled, launchFlight } from '@/lib/card-flight';
import { awayDigest, awayFor, shortWhen, type AwayRow } from '@/lib/away';
import { useAwaySince } from '@/hooks/use-away';
import { CATEGORIES, type MnemoItem } from '@/types/mnemo';
import { captureHref, dumpHref, libraryHref, reviewHref, settingsHref, welcomeHref } from '@/lib/routes';
import { openThread } from '@/lib/navigation';

/** How far ahead "Coming up" looks for due dates. */
const COMING_UP_DAYS = 7;
/** Threads after the resume card, in the same order, under "Up next". */
const UP_NEXT_LIMIT = 3;
/** Rows under "Coming up" before deferring to the Library. */
const COMING_UP_LIMIT = 3;

const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
/** Small counts read better spelled out in a sentence. */
const numberWord = (n: number) => NUMBER_WORDS[n] ?? String(n);

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
  const reduceMotion = useReduceMotion();
  const cardRef = React.useRef<View>(null);
  const titleRef = React.useRef<View>(null);

  // Opens the thread with the card growing into it (CardFlightHost), on
  // phones that keep up; otherwise the thread's usual entrance.
  const open = () => {
    const card = cardRef.current;
    const title = titleRef.current;
    if (reduceMotion || !flightsEnabled() || !card || !title) return openThread(item.id);
    card.measureInWindow((x, y, width, height) => {
      title.measureInWindow((tx, ty, tw, th) => {
        launchFlight({
          threadId: item.id,
          from: { x, y, width, height },
          titleFrom: { x: tx, y: ty, width: tw, height: th },
          title: item.title,
          chip: chip?.label,
        });
        openThread(item.id);
      });
    });
  };
  // Under the title, only what adds to it.
  const nextStep = item.nextStep && !sameWords(item.nextStep, item.title) ? item.nextStep : undefined;
  const whereLeftOff = item.whereLeftOff && !sameWords(item.whereLeftOff, item.title) ? item.whereLeftOff : undefined;
  const chipTone = reason?.kind === 'missed' ? colors.onHero : colors.heroAccent;
  // A reminder further off than the chip covers still shows, in place of the age.
  const dueAt = item.dueDate ? nextOccurrence(item.dueDate, item.repeat) : undefined;
  const aside =
    dueAt !== undefined && reason?.kind !== 'due' && reason?.kind !== 'missed'
      ? formatReminder(dueAt)
      : `${item.status === 'paused' ? 'Paused' : category.label} · ${formatCompactDistance(item.updatedAt)}`;

  return (
    // Lifted off the page by a shadow in its own colour; the card inside clips.
    <View
      ref={cardRef}
      collapsable={false}
      className="mb-7"
      style={{
        borderRadius: 30,
        // Android draws elevation only under a filled view.
        backgroundColor: colors.hero,
        shadowColor: colors.hero,
        shadowOpacity: 0.35,
        shadowRadius: 22,
        shadowOffset: { width: 0, height: 12 },
        elevation: 10,
      }}
    >
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`Resume ${item.title}${chip ? `. ${chip.label}` : ''}`}
        className="overflow-hidden active:opacity-95"
        style={{ backgroundColor: colors.hero, borderRadius: 30, borderWidth: 1, borderColor: colors.heroSoft }}
      >
        {/* Light in the room: a soft glow from the top left, so the card
            reads as lit rather than as a flat slab. */}
        <Svg pointerEvents="none" width="100%" height="100%" style={{ position: 'absolute' }}>
          <Defs>
            <RadialGradient id="resume-glow" cx="12%" cy="0%" rx="95%" ry="110%">
              <Stop offset="0" stopColor={colors.heroAccent} stopOpacity={0.22} />
              <Stop offset="0.55" stopColor={colors.heroAccent} stopOpacity={0.05} />
              <Stop offset="1" stopColor={colors.heroAccent} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#resume-glow)" />
        </Svg>

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

          <View ref={titleRef} className="mt-3.5" collapsable={false}>
            <Text className="font-display leading-tight" style={{ color: colors.onHero, fontSize: 24 }} numberOfLines={2}>
              {item.title}
            </Text>
          </View>

          <View className="flex-row items-center pt-3.5 mt-4" style={{ borderTopWidth: 1, borderTopColor: colors.heroSoft, gap: 12 }}>
            <View className="flex-1" style={{ minWidth: 0 }}>
              {nextStep ? (
                <>
                  <Text className="font-sans-semi text-xs uppercase tracking-caps mb-0.5" style={{ color: colors.heroAccent }}>
                    Next
                  </Text>
                  <Text className="font-sans-medium text-body leading-snug" style={{ color: colors.onHero }} numberOfLines={2}>
                    {nextStep}
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
              ) : whereLeftOff ? (
                <Text className="font-quote text-body leading-snug" style={{ color: colors.onHeroMuted }} numberOfLines={2}>
                  “{whereLeftOff}”
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
    </View>
  );
}

/** The right-hand word on a "while you were away" row: why it's listed. */
function awayTrailing(row: AwayRow): { label: string; tone?: 'error' | 'accent' } {
  switch (row.reason.kind) {
    // Short, so the title and step beside it keep their room.
    case 'missed':
      return { label: shortWhen(row.reason.at), tone: 'error' };
    case 'due':
      return { label: shortWhen(row.reason.at), tone: 'accent' };
    case 'step':
      return { label: 'Next' };
    case 'leftOff':
      return { label: 'Left off' };
  }
}

const AI_PROBLEM_TEXT: Record<AiProblem, string> = {
  invalid: "Your key isn't being accepted. Notes are saved as you wrote them.",
  quota: "Your key's limit is used up. Notes are saved and tidied up later.",
};

export function PulseHome() {
  const enter = useEnter();
  const aiProblem = useAiProblem();
  const aiProblemText = useAiProblemDetail() ?? (aiProblem ? AI_PROBLEM_TEXT[aiProblem] : '');
  const aiNotice = useAiNotice();
  const insets = useSafeAreaInsets();
  const { items, entries, getActiveItems, focusThreadId, setFocusThread } = useMnemoStore();
  const focusThread = focusThreadId ? items.find((i) => i.id === focusThreadId) : undefined;
  const colors = useThemeColors();
  const surface = useSurfaceStyle();
  const categories = useCategories();

  const activeItems = resumeOrder(getActiveItems(), { focusId: focusThreadId });
  const latestItem = activeItems[0];
  const reason = latestItem ? resumeReason(latestItem, { focusId: focusThreadId }) : null;

  const now = Date.now();
  // Back after days away: what came and went, and what's waiting (lib/away.ts).
  const { since: awaySince, presented: awayPresented, markPresented, dismiss: dismissAway } = useAwaySince();
  // Cheap (a pass over the threads); the React Compiler memoizes it.
  const away = awaySince !== null && items.length > 0 ? awayDigest(items, entries, awaySince, now, latestItem?.id) : null;
  // The first time Home shows after a return, the full welcome page opens
  // over it, once. Closing it leaves the short version here.
  const hasAway = away !== null;
  React.useEffect(() => {
    if (!hasAway || awayPresented) return;
    markPresented();
    router.push(welcomeHref);
  }, [hasAway, awayPresented, markPresented]);
  // The next few of the same ranking, so the order is visible, not just its
  // winner. While "while you were away" lists what's waiting, it takes their place.
  const upNext = away ? [] : activeItems.slice(1, 1 + UP_NEXT_LIMIT);
  const shownIds = new Set([latestItem?.id, ...upNext.map((i) => i.id), ...(away?.rows.map((r) => r.item.id) ?? [])]);
  const comingUp = activeItems
    .flatMap((i): { item: MnemoItem; at: number; step?: string }[] => [
      ...(!shownIds.has(i.id) && i.dueDate ? [{ item: i, at: i.repeat ? nextOccurrence(i.dueDate, i.repeat, now) : i.dueDate }] : []),
      ...(i.laterSteps ?? []).filter((l) => l.at > now).map((l) => ({ item: i, at: l.at, step: l.step })),
    ])
    .filter((r) => r.at < now + COMING_UP_DAYS * DAY_MS)
    .sort((a, b) => a.at - b.at);
  const dueSoon = (i: MnemoItem) => !!i.dueDate && i.dueDate < now + COMING_UP_DAYS * DAY_MS;

  const categoryCounts = CATEGORIES.map((key) => ({
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
    if (hasAway) return name ? `Welcome back, ${name}` : 'Welcome back';
    const hour = new Date().getHours();
    if (hour < 5) return name ? `Still up, ${name}?` : 'Still up?';
    const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    return name ? `${part}, ${name}` : part;
  }, [name, hasAway]);
  const today = React.useMemo(
    () => new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
    [],
  );

  return (
    <ScrollView
      className="flex-1"
      showsVerticalScrollIndicator={false}
      // Clear the edge-to-edge nav bar plus the FAB stack floating above it.
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + NAV_CLEARANCE }}
    >
      <MotiView
        {...enter.rise(0)}
        className="px-6 mb-5"
        style={{ paddingTop: Math.max(insets.top + 8, 20) }}
      >
        <View className="flex-row items-center justify-between mb-1">
          <Text className="font-sans-medium text-sm" style={{ color: colors.fgTertiary }}>
            {today}
          </Text>
          <IconButton icon="settings" label="Open settings" variant="bare" onPress={() => router.push(settingsHref)} />
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
            <Text
              className="font-quote text-body leading-relaxed shrink"
              style={{ color: colors.fgSecondary }}
              numberOfLines={away ? 3 : 1}
            >
              {away ? `Away ${awayFor(away.days)}. ${away.line}` : summary}
            </Text>
            {items.length > 0 ? (
              <Pressable
                onPress={() => router.push(reviewHref)}
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
        {focusThread ? (
          <FocusPill
            className="mt-4"
            onPress={() => openThread(focusThread.id)}
            label={`Quick captures go to ${focusThread.title}. Open it.`}
            onStop={() => setFocusThread(null)}
            stopLabel="Stop sending quick captures there"
          >
            Capturing into <Text className="font-sans-semi">{focusThread.title}</Text>
          </FocusPill>
        ) : null}
        {/* Strict phones: a one-time nudge to check reminders will arrive. */}
        <ReminderSetupPrompt />
        {/* A place reminder waiting that may not go off, and why. */}
        <PlaceReminderPrompt />
        {/* No backup in a while, or automatic backups stopped working. */}
        <BackupPrompt />
        {/* Gemini stopped answering for a reason the person can fix. */}
        {aiProblem ? (
          <Pressable
            onPress={() => router.push(settingsHref)}
            accessibilityRole="button"
            accessibilityLabel={`${aiProblemText} Open settings.`}
            className="flex-row items-center rounded-lg px-4 py-3 mt-4 active:opacity-80"
            style={surface}
          >
            <Icon name="sparkles" size={16} color={colors.accentWarm} />
            <Text className="flex-1 font-sans text-sm leading-snug mx-3" style={{ color: colors.fgSecondary }}>
              {aiProblemText}
            </Text>
            <Text className="font-sans-semi text-sm" style={{ color: colors.accent }}>
              Fix
            </Text>
          </Pressable>
        ) : null}
        {/* Every Flash model is resting: notes are being written by Flash-Lite. */}
        {aiNotice && !aiProblem ? (
          <View
            accessibilityRole="alert"
            className="flex-row items-center rounded-lg px-4 py-3 mt-4"
            style={surface}
          >
            <Icon name="sparkles" size={16} color={colors.accentWarm} />
            <Text className="flex-1 font-sans text-sm leading-snug ml-3" style={{ color: colors.fgSecondary }}>
              {aiNotice}
            </Text>
          </View>
        ) : null}
      </MotiView>

      <View className="px-5">
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
                <Button variant="primary" icon="mic" className="flex-1" onPress={() => router.push(dumpHref())}>
                  Record
                </Button>
                <Button variant="quiet" icon="pencil" className="flex-1" onPress={() => router.push(captureHref())}>
                  Write
                </Button>
              </View>
            </Card>
          </MotiView>
        )}

        {/* While you were away: what's waiting, across everything */}
        {away && (away.rows.length > 0 || away.ideas > 0) ? (
          <MotiView {...enter.rise(2)} {...enter.reflow()} className="mb-7">
            <Eyebrow
              action={away.total > away.rows.length ? `All ${away.total + (away.ideas > 0 ? away.ideas : 0)}` : 'See all'}
              onAction={() => router.push(welcomeHref)}
            >
              While you were away
            </Eyebrow>
            {away.rows.length > 0 ? (
              <ThreadList>
                {away.rows.map((row, i, shown) => {
                  const t = awayTrailing(row);
                  return (
                    <ThreadRow
                      key={row.item.id}
                      item={row.item}
                      index={i}
                      onPress={() => openThread(row.item.id)}
                      detail={row.text}
                      trailing={t.label}
                      trailingTone={t.tone === 'error' ? colors.error : t.tone === 'accent' ? colors.accent : undefined}
                      last={i === shown.length - 1}
                    />
                  );
                })}
              </ThreadList>
            ) : null}
            {away.ideas > 0 ? (
              <Pressable
                onPress={() => router.push(libraryHref('ideas'))}
                accessibilityRole="button"
                accessibilityLabel={`${away.ideas} ${away.ideas === 1 ? 'idea' : 'ideas'} kept. Open them.`}
                className="flex-row items-center h-11 mt-2 active:opacity-70"
              >
                <Icon name="sparkles" size={15} color={colors.accentWarm} />
                <Text className="flex-1 font-sans text-sm ml-2" style={{ color: colors.fgSecondary }}>
                  {away.ideas === 1 ? 'One idea' : `${numberWord(away.ideas)} ideas`} kept for later
                </Text>
                <Icon name="chevronRight" size={14} color={colors.accent} stroke={2} />
              </Pressable>
            ) : null}
            <Pressable
              onPress={dismissAway}
              accessibilityRole="button"
              accessibilityLabel="Got it. Put away what's waiting until next time."
              hitSlop={8}
              className="self-start flex-row items-center h-11 active:opacity-70"
            >
              <Icon name="check" size={15} color={colors.accent} stroke={2.2} />
              <Text className="font-sans-semi text-sm ml-1.5" style={{ color: colors.accent }}>
                Got it
              </Text>
            </Pressable>
          </MotiView>
        ) : null}

        {/* Up next: the rest of the same ranking */}
        {upNext.length > 0 && (
          <MotiView {...enter.rise(2)} {...enter.reflow()} className="mb-7">
            <Eyebrow
              action={openCount > 1 + upNext.length ? `See all ${openCount}` : undefined}
              onAction={() => router.push(libraryHref())}
            >
              Up next
            </Eyebrow>
            <ThreadList>
              {upNext.map((item, i, shown) => (
                <ThreadRow
                  key={item.id}
                  item={item}
                  index={i}
                  onPress={() => openThread(item.id)}
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
          <MotiView {...enter.rise(3)} {...enter.reflow()} className="mb-8">
            <Eyebrow
              action={comingUp.length > COMING_UP_LIMIT ? `All ${comingUp.length}` : undefined}
              onAction={() => router.push(libraryHref())}
            >
              Coming up
            </Eyebrow>
            <ThreadList>
              {comingUp.slice(0, COMING_UP_LIMIT).map(({ item, at, step }, i, shown) => (
                <ThreadRow
                  key={`${item.id}:${at}`}
                  item={item}
                  index={i}
                  onPress={() => openThread(item.id)}
                  detail={step}
                  trailing={formatReminder(at)}
                  trailingTone={at < now ? colors.error : colors.accent}
                  last={i === shown.length - 1}
                />
              ))}
            </ThreadList>
          </MotiView>
        )}

        {/* Browse — only categories that hold something */}
        {categoryCounts.length > 0 && (
          <MotiView {...enter.rise(4)} {...enter.reflow()}>
            <Eyebrow action="Library" onAction={() => router.push(libraryHref())}>
              Browse
            </Eyebrow>
            <View className="flex-row flex-wrap gap-2">
              {categoryCounts.map(({ key, count }) => {
                const config = categories[key];
                const CategoryIcon = config.icon;
                return (
                  <Pressable
                    key={key}
                    onPress={() => router.push(libraryHref(key))}
                    accessibilityRole="button"
                    accessibilityLabel={`${config.label}, ${count} ${count === 1 ? 'note' : 'notes'}`}
                    className="flex-row items-center rounded-full pl-2 pr-3.5 h-10 active:opacity-70"
                    style={surface}
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
