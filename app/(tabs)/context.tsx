import React from 'react';
import {
  View,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Share,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { TextInput } from '@/components/ui/TextInput';
import { Text } from '@/components/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { AnimatePresence, MotiView } from 'moti';
import { formatDistanceToNow } from 'date-fns';

import { NAV_CLEARANCE } from '@/components/ui/FloatingTabBar';
import { Button, IconButton } from '@/components/ui/Button';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Icon } from '@/components/ui/Icon';
import { DoneCheck } from '@/components/ui/DoneCheck';
import { ThreadList, ThreadRow } from '@/components/ui/ThreadRow';
import { CategoryPicker } from '@/components/ui/CategoryPicker';
import { TagEditor } from '@/components/ui/TagEditor';
import { LabeledInput } from '@/components/ui/LabeledInput';
import { noFocusRing } from '@/utils/web';
import { DetailSkeleton } from '@/components/ui/NoteListSkeleton';
import { DueDatePicker, DueDateLabel } from '@/components/ui/DueDatePicker';
import { ThreadRing } from '@/components/ui/ThreadRing';
import { EntryCard } from '@/components/thread/EntryCard';
import { ThreadMenu, type ThreadMenuItem } from '@/components/thread/ThreadMenu';
import { OrganiseOffer, OverviewCard } from '@/components/thread/OverviewCard';
import { NumbersSection, type MetricFix } from '@/components/thread/Measures';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useRebrief } from '@/hooks/use-rebrief';
import { useUndoToast } from '@/hooks/use-undo-toast';
import { useThemeColors } from '@/hooks/use-theme';
import { organiseNotes } from '@/lib/gemini';
import { canOrganise, cleanOverview, notesSince, notesToOrganise, overviewText } from '@/lib/overview';
import { aiEnabled } from '@/lib/ai-mode';
import { classifyAiError, KEY_PROBLEM_TEXT } from '@/lib/api-key';
import { usePreferences } from '@/lib/preferences';
import { structurePendingEntry } from '@/lib/capture';
import { relatedThreads, type RelatedThread } from '@/lib/search';
import { entryText } from '@/lib/threads';
import { matchEntries } from '@/lib/find';
import { quietDays as quietFor, STILL_ON_IT_DAYS } from '@/lib/review';
import { openStepsOf } from '@/lib/wrapup';
import { afterReminder, formatReminder, quickTimes, rescheduled } from '@/lib/when';
import { celebrate, doneSummary, isRealTask } from '@/lib/done';
import { confirmAction } from '@/utils/confirm';
import { metricKey, summarizeMeasures, type MetricSummary } from '@/lib/measures';
import { useCategories, useStatusConfig } from '@/utils/categories';
import { DUR_BASE, EASE_IN_OUT, useEnter } from '@/utils/motion';
import { freshness } from '@/utils/time';
import { reportFlightTarget } from '@/lib/card-flight';

/**
 * ThreadScreen — one thread: where you are (left off, next step), what to
 * do about it (resume, pause, done), and its timeline of entries, newest
 * first. The capture button in the tab bar adds to this thread while it's
 * open. Route stays `context` so existing links and notifications work.
 */
export default function ThreadScreen() {
  const enter = useEnter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useMnemoStore();
  const {
    items,
    updateItem,
    deleteItem,
    undoDelete,
    resumeItem,
    pauseItem,
    completeItem,
    archiveItem,
    restoreItem,
    getEntries,
    isLoaded,
    focusThreadId,
    setFocusThread,
    moveEntry,
    removeThreadNow,
    snapshot,
  } = store;
  const { showUndoToast } = useUndoToast();
  const rebrief = useRebrief();
  const colors = useThemeColors();
  const statusColors = useStatusConfig();
  const categories = useCategories();

  const thread = items.find((c) => c.id === id);
  const threadId = thread?.id;
  // getEntries is rebuilt whenever any entry changes, so this follows new notes.
  const entries = React.useMemo(() => (threadId ? getEntries(threadId) : []), [threadId, getEntries]);
  usePreferences(); // re-render when AI is switched on or off
  // Finding one note in a long thread.
  const [finding, setFinding] = React.useState(false);
  const [findQuery, setFindQuery] = React.useState('');
  const shownEntries = React.useMemo(
    () => (finding && findQuery.trim() ? matchEntries(entries, findQuery, entryText) : entries),
    [entries, finding, findQuery],
  );
  const ai = aiEnabled();
  // Offline digest: next steps and unticked items from the notes, newest first.
  const openSteps = React.useMemo(() => openStepsOf(entries).slice(0, 5), [entries]);
  const numbers = React.useMemo(() => summarizeMeasures(entries), [entries]);
  // Same rule as the weekly review: active, untouched a week, no reminder still to come.
  const quietDays = React.useMemo(() => (thread ? quietFor(thread, entries) : null), [thread, entries]);
  const isFocus = !!thread && focusThreadId === thread.id;
  // An entry auto-filing thought might belong elsewhere (lib/filing.ts).
  const suggestion = entries.find((e) => e.filing.by === 'suggested');
  const suggestedThread =
    suggestion && suggestion.filing.by === 'suggested'
      ? items.find((i) => i.id === (suggestion.filing as { threadId: string }).threadId)
      : undefined;

  const [isEditing, setIsEditing] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const titleRef = React.useRef<React.ComponentRef<typeof Text>>(null);
  // Where the Resume card's title should land when it opens this thread.
  // Measured again once the header's entrance has risen into place, since
  // it starts a little low.
  const reportTitlePlace = () => {
    const report = () =>
      titleRef.current?.measureInWindow((x, y, width, height) => reportFlightTarget(id, { x, y, width, height }));
    report();
    setTimeout(report, DUR_BASE + 20);
  };
  // Height of the nav row, where the ⋯ menu drops from.
  const [navBottom, setNavBottom] = React.useState(64);
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [organising, setOrganising] = React.useState(false);
  const [editTitle, setEditTitle] = React.useState('');
  const [editNextStep, setEditNextStep] = React.useState('');
  const [editWhereLeftOff, setEditWhereLeftOff] = React.useState('');

  const startEditing = () => {
    if (!thread) return;
    setEditTitle(thread.title);
    setEditNextStep(thread.nextStep ?? '');
    setEditWhereLeftOff(thread.whereLeftOff ?? '');
    setIsEditing(true);
  };

  // Nearest threads by meaning — a supplementary section that stays empty
  // until this thread has a vector, and on any failure.
  const [related, setRelated] = React.useState<RelatedThread[]>([]);
  React.useEffect(() => {
    if (!thread) {
      setRelated([]);
      return;
    }
    let cancelled = false;
    relatedThreads(thread.id, items).then((found) => {
      if (!cancelled) setRelated(found);
    });
    return () => {
      cancelled = true;
    };
  }, [thread?.id, items]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isLoaded) {
    return (
      <View className="flex-1 px-6" style={{ paddingTop: Math.max(insets.top, 16) + 20 }}>
        <DetailSkeleton />
      </View>
    );
  }

  if (!thread) {
    return (
      <View className="flex-1 items-center justify-center p-10">
        <View
          className="w-14 h-14 rounded-full items-center justify-center mb-4"
          style={{ backgroundColor: colors.surface }}
        >
          <Icon name="search" size={24} color={colors.fgTertiary} />
        </View>
        <Text className="font-display text-title text-fg mb-2">Not found</Text>
        <Text className="font-sans text-body text-fg-secondary mb-8 text-center">
          This thread may have been deleted.
        </Text>
        <Button onPress={() => router.back()} variant="quiet">
          Go back
        </Button>
      </View>
    );
  }

  const category = categories[thread.category];
  const CategoryIcon = category.icon;
  const status = statusColors[thread.status];
  const pendingEntries = entries.filter((e) => e.pending);

  // ─── Actions ───────────────────────────────────────────────

  const handleSaveEdit = () => {
    const nextStep = editNextStep.trim();
    const whereLeftOff = editWhereLeftOff.trim();
    // A value the user wrote here is pinned, so new entries don't
    // overwrite it; clearing it hands the field back to the entries.
    const latestNext = entries.find((e) => e.nextStep)?.nextStep;
    const latestLeftOff = entries.find((e) => e.leftOff)?.leftOff;
    const title = editTitle.trim() || thread.title;
    updateItem(thread.id, {
      title,
      nextStep: nextStep || latestNext,
      whereLeftOff: whereLeftOff || latestLeftOff,
      pinned: {
        // A name the person gave stays: the AI won't rename it.
        title: title !== thread.title || !!thread.pinned?.title,
        nextStep: nextStep ? nextStep !== thread.nextStep || !!thread.pinned?.nextStep : false,
        whereLeftOff: whereLeftOff
          ? whereLeftOff !== thread.whereLeftOff || !!thread.pinned?.whereLeftOff
          : false,
      },
    });
    setIsEditing(false);
  };

  // A correction to one tracked number across the thread: a new name (the
  // same name as another merges them) or a different way of adding up.
  const fixMetric = (summary: MetricSummary, fix: MetricFix) => {
    for (const entry of entries) {
      let touched = false;
      const blocks = entry.blocks.map((b) => {
        if (b.kind !== 'measures') return b;
        return {
          ...b,
          items: b.items.map((m) => {
            if (metricKey(m.metric) !== summary.key) return m;
            touched = true;
            return { ...m, ...(fix.metric ? { metric: fix.metric } : {}), ...(fix.rollup ? { rollup: fix.rollup } : {}) };
          }),
        };
      });
      if (touched) store.updateEntry(entry.id, { blocks });
    }
  };

  // A thread with some history gets a wrap-up card first; a one-liner is just done.
  const hasHistory = entries.length >= 3 || numbers.length > 0;
  const handleDone = () => {
    if (hasHistory) {
      router.push(`/wrapup?id=${thread.id}`);
      return;
    }
    const before = thread;
    const wasFocus = isFocus;
    // Something that was to be done gets its moment; a note filed away doesn't.
    if (isRealTask(thread, entries)) celebrate({ title: thread.title, detail: doneSummary(thread, entries) });
    completeItem(thread.id);
    showUndoToast(`"${thread.title}" is done`, () => {
      restoreItem(before);
      if (wasFocus) setFocusThread(before.id);
    });
  };

  const handleStepDone = () => {
    // DoneCheck has already played the moment (ring, haptics) by now.
    const step = thread.nextStep;
    const undo = store.completeNextStep(thread.id);
    showUndoToast(`Done: ${step}`, undo);
  };

  const showDue = !!thread.dueDate && (thread.status === 'active' || thread.status === 'paused');
  const missed = showDue && !thread.repeat && thread.dueDate! < Date.now();
  const waiting = (thread.laterSteps ?? []).filter((l) => !thread.repeat || l.at > Date.now());

  const handleReminderDone = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (thread.nextStep) return handleStepDone();
    const { dueDate, laterSteps, nextStep, pinned } = thread;
    updateItem(thread.id, afterReminder(thread));
    showUndoToast('Reminder done', () => updateItem(thread.id, { dueDate, laterSteps, nextStep, pinned }));
  };

  const handleReminderLater = () => {
    Haptics.selectionAsync();
    updateItem(thread.id, rescheduled(thread, quickTimes().find((q) => q.key === 'tomorrow')!.at));
  };

  const handleDelete = () => {
    const remove = () => {
      deleteItem(thread.id);
      showUndoToast(`"${thread.title}" deleted`, () => undoDelete(thread.id));
      router.back();
    };
    // One note is undone from the toast; a whole history deserves a question first.
    if (entries.length <= 1) return remove();
    confirmAction({
      title: 'Delete thread?',
      message: `All ${entries.length} entries in "${thread.title}" will be deleted.`,
      confirmLabel: 'Delete',
      onConfirm: remove,
    });
  };

  const handleRetryProcessing = async () => {
    setIsGenerating(true);
    try {
      // A voice note whose sound is gone is written out from its words instead.
      for (const entry of pendingEntries) await structurePendingEntry(entry, store);
    } catch (e) {
      const problem = classifyAiError(e);
      Alert.alert(
        problem === 'offline' ? 'Still offline?' : 'Gemini had a problem',
        `${KEY_PROBLEM_TEXT[problem]} It's tried again by itself.`,
      );
    } finally {
      setIsGenerating(false);
    }
  };

  // Groups the thread's notes by theme, when the person asks.
  const handleOrganise = async () => {
    setOrganising(true);
    try {
      const notes = notesToOrganise(entries);
      const overview = cleanOverview(await organiseNotes(thread.title, notes), notes.length, Date.now());
      if (!overview) throw new Error('Nothing to organise');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      updateItem(thread.id, { overview });
    } catch (e) {
      Alert.alert('Could not organise the notes', KEY_PROBLEM_TEXT[classifyAiError(e)]);
    } finally {
      setOrganising(false);
    }
  };
  const newSinceOverview = thread.overview ? notesSince(thread.overview, entries) : 0;
  const noteSpanDays = entries.length
    ? Math.round((Math.max(...entries.map((e) => e.createdAt)) - Math.min(...entries.map((e) => e.createdAt))) / 86_400_000)
    : 0;

  // What's shared: the overview, or offline the steps still open.
  const shareText = thread.overview
    ? overviewText(thread.title, thread.overview)
    : openSteps.map((step, i) => `${i + 1}. ${step}`).join('\n');
  const onShare = async () => {
    try {
      await Share.share({ message: shareText });
    } catch {
      // Share sheet dismissed or unavailable — nothing to do.
    }
  };

  /** After an entry moved out: follow it if this thread is now gone. */
  const followMove = (toThreadId: string) => {
    if (!snapshot().items.some((i) => i.id === thread.id)) {
      router.replace(`/(tabs)/context?id=${toThreadId}`);
    }
  };

  const acceptSuggestion = () => {
    if (!suggestion || !suggestedThread) return;
    moveEntry(suggestion.id, suggestedThread.id, { by: 'user' });
    if (!snapshot().entries.some((e) => e.threadId === thread.id)) removeThreadNow(thread.id);
    followMove(suggestedThread.id);
  };

  const addUpdate = (mode: 'write' | 'record') =>
    router.push(`/${mode === 'write' ? 'capture' : 'dump'}?threadId=${thread.id}`);

  // Now-and-then actions, out of the way in the ⋯ menu.
  const open = thread.status === 'active' || thread.status === 'paused';
  const menuItems: ThreadMenuItem[] = [
    { icon: 'pencil', label: 'Edit thread', onPress: startEditing },
    ...(shareText
      ? [{ icon: 'share' as const, label: thread.overview ? 'Share overview' : "Share what's still open", onPress: onShare }]
      : []),
    ...(open
      ? [
          {
            icon: 'pin' as const,
            label: isFocus ? 'Stop sending captures here' : 'Send quick captures here',
            onPress: () => setFocusThread(isFocus ? null : thread.id),
          },
        ]
      : []),
    ...(thread.status === 'active' ? [{ icon: 'pause' as const, label: 'Pause', onPress: () => pauseItem(thread.id) }] : []),
    ...(thread.status !== 'archived' ? [{ icon: 'archive' as const, label: 'Archive', onPress: () => archiveItem(thread.id) }] : []),
    { icon: 'trash', label: 'Delete thread', onPress: handleDelete, danger: true },
  ];

  // ─── Render ────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View className="flex-1">
        {/* Nav */}
        <View
          className="flex-row justify-between items-center px-5 pb-2"
          style={{ paddingTop: Math.max(insets.top, 12) + 4 }}
          onLayout={(e) => setNavBottom(e.nativeEvent.layout.height)}
        >
          <IconButton
            icon={isEditing ? 'x' : 'chevronLeft'}
            label={isEditing ? 'Cancel editing' : 'Back'}
            onPress={isEditing ? () => setIsEditing(false) : () => router.back()}
          />
          {isEditing ? (
            <Button onPress={handleSaveEdit} variant="primary" size="sm" icon="check">
              Save
            </Button>
          ) : (
            <View className="flex-row">
              <IconButton
                icon="star"
                label={thread.starred ? 'Unpin from Home' : 'Pin to Home'}
                variant="bare"
                active={!!thread.starred}
                onPress={() => {
                  Haptics.selectionAsync();
                  updateItem(thread.id, { starred: !thread.starred });
                }}
              />
              <IconButton
                icon="more"
                label="Thread options"
                variant="bare"
                active={menuOpen}
                onPress={() => {
                  Haptics.selectionAsync();
                  setMenuOpen((v) => !v);
                }}
              />
            </View>
          )}
        </View>

        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 20) + NAV_CLEARANCE }}
        >
          {/* ─── Header ─────────────────────────────────── */}
          <MotiView {...enter.rise(0)} className="px-6 pt-3">
            <View className="flex-row items-center mb-4">
              <ThreadRing
                size={40}
                progress={freshness(thread.updatedAt)}
                color={category.color}
                trackColor={category.bgTint}
              >
                <CategoryIcon size={15} color={category.color} strokeWidth={2} />
              </ThreadRing>
              <View className="ml-3 flex-1">
                <Text className="font-sans-semi text-sm" style={{ color: colors.fg }}>
                  {category.label}
                  <Text className="font-sans-medium" style={{ color: status.color }}>
                    {'  ·  '}
                    {status.label}
                  </Text>
                </Text>
                <Text className="font-sans text-sm" style={{ color: colors.fgTertiary }}>
                  {entries.length} {entries.length === 1 ? 'entry' : 'entries'} · updated{' '}
                  {formatDistanceToNow(thread.updatedAt)} ago
                </Text>
              </View>
            </View>

            {isEditing ? (
              <View className="gap-5 mb-2">
                <TextInput
                  value={editTitle}
                  onChangeText={setEditTitle}
                  multiline
                  selectionColor={colors.accent}
                  placeholder="Title"
                  placeholderTextColor={colors.fgTertiary}
                  className="font-display text-fg pb-2"
                  style={[{ fontSize: 30, lineHeight: 36, borderBottomWidth: 1, borderBottomColor: colors.border }, noFocusRing]}
                />
                <View>
                  <Eyebrow className="mb-2">Category</Eyebrow>
                  <CategoryPicker value={thread.category} onChange={(cat) => updateItem(thread.id, { category: cat })} />
                </View>
                <View>
                  <Eyebrow className="mb-2">Tags</Eyebrow>
                  <TagEditor tags={thread.tags} onChange={(tags) => updateItem(thread.id, { tags })} />
                </View>
                <View>
                  <Eyebrow className="mb-2">Remind me</Eyebrow>
                  <DueDatePicker
                    value={thread.dueDate}
                    onChange={(d) => updateItem(thread.id, d ? rescheduled(thread, d) : { dueDate: undefined, laterSteps: undefined })}
                    repeat={thread.repeat}
                    onRepeatChange={(r) => updateItem(thread.id, { repeat: r })}
                  />
                </View>
                <LabeledInput
                  label="Where you left off"
                  value={editWhereLeftOff}
                  onChangeText={setEditWhereLeftOff}
                  placeholder="Halfway through chapter 3…"
                />
                <LabeledInput label="Next step" value={editNextStep} onChangeText={setEditNextStep} placeholder="Call the plumber…" />
              </View>
            ) : (
              <>
                <Text
                  ref={titleRef}
                  // Where the Resume card's title lands when it opens this thread.
                  onLayout={reportTitlePlace}
                  className="font-display text-fg leading-tight"
                  style={{ fontSize: 32, letterSpacing: -0.4 }}
                >
                  {thread.title}
                </Text>
                {thread.tags.length > 0 || (showDue && !missed) ? (
                  <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1 mt-2.5">
                    {showDue && !missed ? <DueDateLabel dueDate={thread.dueDate!} repeat={thread.repeat} /> : null}
                    {thread.tags.length > 0 ? (
                      <Text className="font-sans text-sm" style={{ color: colors.fgTertiary }}>
                        {thread.tags.map((t) => `#${t}`).join('  ')}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
                {missed ? (
                  <View
                    className="flex-row items-center rounded-md mt-3 pl-3.5 pr-2 py-2 gap-2"
                    style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
                  >
                    <View className="flex-1" style={{ minWidth: 0 }}>
                      <Text className="font-sans text-sm" style={{ color: colors.fgTertiary }}>
                        {formatReminder(thread.dueDate!)}
                      </Text>
                      <Text className="font-sans-medium text-sm" style={{ color: colors.fg }} numberOfLines={2}>
                        {thread.nextStep ? `${thread.nextStep}?` : 'Done with this?'}
                      </Text>
                    </View>
                    <Button size="sm" variant="quiet" onPress={handleReminderLater}>
                      Tomorrow
                    </Button>
                    <Button size="sm" variant="primary" icon="check" onPress={handleReminderDone}>
                      Done
                    </Button>
                  </View>
                ) : null}
                {showDue && waiting.length > 0 ? (
                  <View className="mt-2 gap-1">
                    {waiting.slice(0, 3).map((l) => (
                      <Text key={l.at} className="font-sans text-sm" style={{ color: colors.fgTertiary }} numberOfLines={1}>
                        Then {formatReminder(l.at)}
                        {l.step ? ` · ${l.step}` : ''}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </>
            )}
          </MotiView>

          {!isEditing && suggestion && suggestedThread && (
            <MotiView {...enter.rise(1)} className="mx-6 mt-5 rounded-lg p-4" style={{ backgroundColor: colors.accentSoft }}>
              <Text className="font-sans-semi text-body" style={{ color: colors.fg }}>
                Part of {suggestedThread.title}?
              </Text>
              <Text className="font-sans text-sm mt-1" style={{ color: colors.fgSecondary }}>
                This looks like it continues that thread. Move it there to keep everything together.
              </Text>
              <View className="flex-row gap-2 mt-3">
                <Button variant="primary" size="sm" icon="arrowRight" onPress={acceptSuggestion}>
                  Move there
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => store.updateEntry(suggestion.id, { filing: { by: 'user' } })}
                >
                  Keep separate
                </Button>
              </View>
            </MotiView>
          )}

          {!isEditing && (
            <>
              {/* ─── Where you are ──────────────────────── */}
              {thread.whereLeftOff || thread.nextStep ? (
                <MotiView {...enter.rise(1)} className="px-6 mt-6 gap-4">
                  {thread.whereLeftOff ? (
                    <View className="pl-4" style={{ borderLeftWidth: 2, borderLeftColor: category.color }}>
                      <Eyebrow className="mb-1.5">Where you left off</Eyebrow>
                      <Text className="font-quote text-heading leading-relaxed" style={{ color: colors.fgSecondary }}>
                        “{thread.whereLeftOff}”
                      </Text>
                    </View>
                  ) : null}
                  {thread.nextStep ? (
                    <View className="flex-row items-center rounded-md p-4" style={{ backgroundColor: colors.accentSoft }}>
                      <View className="w-9 h-9 rounded-full items-center justify-center" style={{ backgroundColor: colors.accent }}>
                        <Icon name="arrowRight" size={16} stroke={2.2} color={colors.accentInk} />
                      </View>
                      <View className="flex-1 ml-3">
                        <Eyebrow tone={colors.accent} className="mb-0.5">Next step</Eyebrow>
                        <Text className="font-sans-medium text-body leading-snug" style={{ color: colors.fg }}>
                          {thread.nextStep}
                        </Text>
                      </View>
                      <View className="ml-2">
                        <DoneCheck onDone={handleStepDone} label="Mark next step done" restColor={colors.surfaceLowest} />
                      </View>
                    </View>
                  ) : null}
                </MotiView>
              ) : null}

              {/* ─── Gone quiet: keep going, pause or wrap up ─── */}
              {!isEditing && quietDays !== null ? (
                <MotiView {...enter.fade(1)} className="mx-6 mt-5 rounded-lg p-4" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
                  <Text className="font-sans-semi text-body" style={{ color: colors.fg }}>
                    Nothing new for {quietDays} days
                  </Text>
                  <Text className="font-sans text-sm mt-0.5" style={{ color: colors.fgSecondary }}>
                    Still going, or is it over?
                  </Text>
                  <View className="flex-row gap-2 mt-3">
                    <Button variant="tonal" size="sm" icon="check" onPress={() => router.push(`/wrapup?id=${thread.id}`)}>
                      Wrap it up
                    </Button>
                    <Button
                      variant="quiet"
                      size="sm"
                      onPress={() => {
                        const before = thread;
                        // Not activity: it shouldn't jump to the top of Home.
                        updateItem(thread.id, { quietUntil: Date.now() + STILL_ON_IT_DAYS * 86_400_000 }, { touch: false });
                        showUndoToast(`Won't ask about it for a month`, () => restoreItem(before));
                      }}
                    >
                      Still on it
                    </Button>
                    <Button variant="ghost" size="sm" icon="pause" onPress={() => pauseItem(thread.id)}>
                      Pause
                    </Button>
                  </View>
                </MotiView>
              ) : null}

              {/* ─── What to do now: one row, the rest is in the ⋯ menu ─── */}
              <MotiView {...enter.fade(1)} className="px-6 mt-5 flex-row gap-2">
                {thread.status === 'active' ? (
                  <Button
                    variant="quiet"
                    size="sm"
                    icon={rebrief.state === 'idle' ? 'volume' : 'x'}
                    className="flex-1"
                    onPress={() => (rebrief.state === 'idle' ? rebrief.start(thread) : rebrief.stop())}
                  >
                    {rebrief.state === 'idle' ? 'Listen back' : 'Stop'}
                  </Button>
                ) : thread.status === 'paused' ? (
                  <Button
                    variant="tonal"
                    size="sm"
                    icon="play"
                    className="flex-1"
                    onPress={() => {
                      // Speak the re-brief before flipping status, so the
                      // script reflects how long the thread sat untouched.
                      rebrief.start(thread);
                      resumeItem(thread.id);
                    }}
                  >
                    Resume
                  </Button>
                ) : (
                  // Finished or archived: bringing it back isn't a return to
                  // work, so no briefing starts.
                  <Button variant="tonal" size="sm" icon="play" className="flex-1" onPress={() => resumeItem(thread.id)}>
                    Reopen
                  </Button>
                )}
                {thread.status !== 'completed' ? (
                  <Button variant="quiet" size="sm" icon="check" className="flex-1" onPress={handleDone}>
                    Done
                  </Button>
                ) : hasHistory ? (
                  <Button variant="quiet" size="sm" icon="share" className="flex-1" onPress={() => router.push(`/wrapup?id=${thread.id}`)}>
                    Summary card
                  </Button>
                ) : null}
              </MotiView>

              {/* Re-brief player */}
              {rebrief.state !== 'idle' && (
                <View className="px-6 mt-3">
                  <Pressable
                    onPress={rebrief.stop}
                    accessibilityLabel="Stop re-brief"
                    className="flex-row items-center rounded-md px-4 py-3 active:opacity-70"
                    style={{ backgroundColor: colors.accentSoft }}
                  >
                    {rebrief.state === 'preparing' ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : (
                      <MotiView
                        animate={{ opacity: [0.4, 1, 0.4] }}
                        transition={{ type: 'timing', duration: 1400, loop: true, easing: EASE_IN_OUT }}
                      >
                        <Icon name="volume" size={16} color={colors.accent} />
                      </MotiView>
                    )}
                    <Text className="flex-1 font-sans-medium text-sm ml-3" style={{ color: colors.accent }}>
                      {rebrief.state === 'preparing' ? 'Preparing your re-brief…' : 'Briefing you back in. Tap to stop.'}
                    </Text>
                  </Pressable>
                </View>
              )}

              {/* ─── Focus: quick captures land here (switched on from the ⋯ menu) ─── */}
              {isFocus && (thread.status === 'active' || thread.status === 'paused') && (
                <MotiView {...enter.fade(1)} className="px-6 mt-3">
                  <View
                    className="flex-row items-center self-start rounded-full pl-3 pr-1.5 h-10"
                    style={{ backgroundColor: colors.accentSoft, maxWidth: '100%' }}
                  >
                    <Icon name="pin" size={15} color={colors.accent} stroke={2.2} />
                    <Text className="font-sans-medium text-sm ml-2 mr-2 shrink" style={{ color: colors.fg }} numberOfLines={1}>
                      Quick captures land here
                    </Text>
                    <Pressable
                      onPress={() => setFocusThread(null)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Stop sending quick captures here"
                      className="rounded-full px-3 h-7 items-center justify-center active:opacity-70"
                      style={{ backgroundColor: colors.surfaceLowest }}
                    >
                      <Text className="font-sans-semi text-sm" style={{ color: colors.accent }}>
                        Stop
                      </Text>
                    </Pressable>
                  </View>
                </MotiView>
              )}

              {/* ─── Numbers it tracks ──────────────────── */}
              {numbers.length > 0 && (
                <MotiView {...enter.rise(2)} className="px-6 mt-9">
                  <NumbersSection summaries={numbers} onFix={fixMetric} />
                </MotiView>
              )}

              {/* ─── Organise: once there are enough loose notes ─── */}
              {ai && !finding && canOrganise(entries, thread.overview) && (
                <MotiView {...enter.rise(2)} className="px-6 mt-7">
                  <OrganiseOffer count={entries.length} spanDays={noteSpanDays} busy={organising} onOrganise={handleOrganise} />
                </MotiView>
              )}

              {/* ─── Timeline ───────────────────────────── */}
              <MotiView {...enter.rise(2)} className="px-6 mt-9">
                <View className="flex-row items-center justify-between">
                  <Eyebrow>Timeline</Eyebrow>
                  {entries.length > 3 ? (
                    <Pressable
                      onPress={() => {
                        setFinding((v) => !v);
                        setFindQuery('');
                      }}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={finding ? 'Stop searching this thread' : 'Search this thread'}
                      className="mb-3 active:opacity-60"
                    >
                      <Icon name={finding ? 'x' : 'search'} size={16} color={colors.fgTertiary} />
                    </Pressable>
                  ) : null}
                </View>
                {finding ? (
                  <View
                    className="flex-row items-center rounded-full px-4 h-11 mb-4"
                    style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
                  >
                    <Icon name="search" size={15} color={colors.fgTertiary} />
                    <TextInput
                      value={findQuery}
                      onChangeText={setFindQuery}
                      autoFocus
                      placeholder="Find in this thread"
                      placeholderTextColor={colors.fgTertiary}
                      accessibilityLabel="Find in this thread"
                      selectionColor={colors.accent}
                      className="flex-1 font-sans text-body ml-2"
                      style={[{ color: colors.fg }, noFocusRing]}
                    />
                    {findQuery ? (
                      <Text className="font-sans text-sm" style={{ color: colors.fgTertiary }}>
                        {shownEntries.length}/{entries.length}
                      </Text>
                    ) : null}
                  </View>
                ) : null}

                {/* One way in: tap to write, or the mic to say it. */}
                <View
                  className="flex-row items-center rounded-full mb-4 pl-5 pr-1.5 h-14"
                  style={{ backgroundColor: colors.surfaceLowest, borderWidth: 1, borderColor: colors.border }}
                >
                  <Pressable
                    onPress={() => addUpdate('write')}
                    accessibilityRole="button"
                    accessibilityLabel="Write an update to this thread"
                    className="flex-1 h-full justify-center active:opacity-60"
                  >
                    <Text className="font-sans text-body" style={{ color: colors.fgTertiary }}>
                      Add to this thread…
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => addUpdate('record')}
                    accessibilityRole="button"
                    accessibilityLabel="Record an update to this thread"
                    className="w-11 h-11 rounded-full items-center justify-center active:opacity-80"
                    style={{ backgroundColor: colors.accent }}
                  >
                    <Icon name="mic" size={18} color={colors.accentInk} stroke={2.2} />
                  </Pressable>
                </View>

                <View className="gap-3">
                  {thread.overview && !finding ? (
                    <OverviewCard
                      overview={thread.overview}
                      newNotes={newSinceOverview}
                      busy={organising}
                      onRedo={ai ? handleOrganise : undefined}
                    />
                  ) : null}
                  <AnimatePresence initial={false}>
                    {shownEntries.map((entry, i) => (
                      <MotiView key={entry.id} {...enter.row(i)} {...enter.rowExit()}>
                        <EntryCard
                          entry={entry}
                          onRetry={entry.pending && !isGenerating ? () => handleRetryProcessing() : undefined}
                          onMoved={followMove}
                          onDeleted={(threadRemoved) => threadRemoved && router.back()}
                        />
                      </MotiView>
                    ))}
                  </AnimatePresence>
                </View>
              </MotiView>

              {/* Offline: what's still open, gathered from the notes on the phone. */}
              {!ai && !thread.aiSummary && openSteps.length > 0 && (
                <View className="px-6 mt-9">
                  <Eyebrow>Still open</Eyebrow>
                  <View className="gap-3">
                    {openSteps.map((step, i) => (
                      <View key={i} className="flex-row items-start">
                        <View
                          className="w-1.5 h-1.5 rounded-full mr-3 mt-2.5"
                          style={{ backgroundColor: colors.accent }}
                        />
                        <Text className="flex-1 font-sans text-body leading-relaxed" style={{ color: colors.fg }}>
                          {step}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
              {/* ─── Related ────────────────────────────── */}
              {related.length > 0 && (
                <View className="px-6 mt-9">
                  <Eyebrow>Related threads</Eyebrow>
                  <ThreadList>
                    {related.map(({ item: r, reason }, i) => (
                      <ThreadRow
                        key={r.id}
                        item={r}
                        detail={reason}
                        index={i}
                        last={i === related.length - 1}
                        onPress={() => router.push(`/(tabs)/context?id=${r.id}`)}
                      />
                    ))}
                  </ThreadList>
                </View>
              )}
            </>
          )}
        </ScrollView>

        <ThreadMenu open={menuOpen && !isEditing} onClose={() => setMenuOpen(false)} items={menuItems} top={navBottom} />
      </View>
    </KeyboardAvoidingView>
  );
}
