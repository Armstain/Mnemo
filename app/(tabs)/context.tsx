import React from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Share,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { File } from 'expo-file-system';
import { MotiView } from 'moti';
import { formatDistanceToNow } from 'date-fns';

import { NAV_CLEARANCE } from '@/components/ui/FloatingTabBar';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Icon } from '@/components/ui/Icon';
import { ThreadList, ThreadRow } from '@/components/ui/ThreadRow';
import { CategoryPicker } from '@/components/ui/CategoryPicker';
import { LabeledInput } from '@/components/ui/LabeledInput';
import { noFocusRing } from '@/utils/web';
import { DetailSkeleton } from '@/components/ui/NoteListSkeleton';
import { DueDatePicker, DueDateLabel } from '@/components/ui/DueDatePicker';
import { ThreadRing } from '@/components/ui/ThreadRing';
import { EntryCard } from '@/components/thread/EntryCard';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useRebrief } from '@/hooks/use-rebrief';
import { useUndoToast } from '@/hooks/use-undo-toast';
import { useThemeColors } from '@/hooks/use-theme';
import { summarizeContext } from '@/lib/gemini';
import { structurePendingEntry } from '@/lib/capture';
import { relatedItems } from '@/lib/search';
import { entryText } from '@/lib/threads';
import { useCategories, useStatusConfig } from '@/utils/categories';
import { EASE_IN_OUT, useEnter } from '@/utils/motion';
import { freshness } from '@/utils/time';
import type { MnemoItem } from '@/types/mnemo';

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
    getEntries,
    isLoaded,
  } = store;
  const { showUndoToast } = useUndoToast();
  const rebrief = useRebrief();
  const colors = useThemeColors();
  const statusColors = useStatusConfig();
  const categories = useCategories();

  const thread = items.find((c) => c.id === id);
  const entries = thread ? getEntries(thread.id) : [];

  const [isEditing, setIsEditing] = React.useState(false);
  const [isGenerating, setIsGenerating] = React.useState(false);
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
  const [related, setRelated] = React.useState<MnemoItem[]>([]);
  React.useEffect(() => {
    if (!thread) {
      setRelated([]);
      return;
    }
    let cancelled = false;
    relatedItems(thread.id, items).then((found) => {
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
    updateItem(thread.id, {
      title: editTitle.trim() || thread.title,
      nextStep: nextStep || latestNext,
      whereLeftOff: whereLeftOff || latestLeftOff,
      pinned: {
        nextStep: nextStep ? nextStep !== thread.nextStep || !!thread.pinned?.nextStep : false,
        whereLeftOff: whereLeftOff
          ? whereLeftOff !== thread.whereLeftOff || !!thread.pinned?.whereLeftOff
          : false,
      },
    });
    setIsEditing(false);
  };

  const handleDelete = () => {
    deleteItem(thread.id);
    showUndoToast(`"${thread.title}" deleted`, () => undoDelete(thread.id));
    router.back();
  };

  const handleRetryProcessing = async () => {
    setIsGenerating(true);
    try {
      for (const entry of pendingEntries) {
        if (entry.pendingAudioUri && !new File(entry.pendingAudioUri).exists) {
          store.updateEntry(entry.id, { pending: false, pendingAudioUri: undefined });
          continue;
        }
        await structurePendingEntry(entry, store);
      }
    } catch (e) {
      console.error(e);
      Alert.alert('Still offline?', 'It will be retried automatically next time you open Mnemo.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateDigest = async () => {
    setIsGenerating(true);
    try {
      const summary = await summarizeContext(thread.content, thread.links);
      updateItem(thread.id, {
        aiSummary: summary,
        whereLeftOff: thread.whereLeftOff || summary.leftOff,
        nextStep: thread.nextStep || summary.nextSteps?.[0],
      });
    } catch (e) {
      console.error(e);
      Alert.alert('Could not generate a digest', 'Check your connection and try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const onShare = async () => {
    const text = [
      thread.title,
      thread.whereLeftOff ? `Where I left off: ${thread.whereLeftOff}` : '',
      thread.nextStep ? `Next step: ${thread.nextStep}` : '',
      ...entries.map((e) => entryText(e)),
    ]
      .filter(Boolean)
      .join('\n\n');
    try {
      await Share.share({ message: text });
    } catch {
      // Share sheet dismissed or unavailable — nothing to do.
    }
  };

  const addUpdate = (mode: 'write' | 'record') =>
    router.push(`/${mode === 'write' ? 'capture' : 'dump'}?threadId=${thread.id}` as any);

  // ─── Render ────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View className="flex-1">
        {/* Nav */}
        <View
          className="flex-row justify-between items-center px-5 pb-2"
          style={{ paddingTop: Math.max(insets.top, 12) + 4 }}
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
              <IconButton icon="share" label="Share" variant="bare" onPress={onShare} />
              <IconButton icon="pencil" label="Edit thread" variant="bare" onPress={startEditing} />
              <IconButton icon="trash" label="Delete thread" variant="bare" onPress={handleDelete} />
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
                  <Eyebrow className="mb-2">Due</Eyebrow>
                  <DueDatePicker value={thread.dueDate} onChange={(d) => updateItem(thread.id, { dueDate: d })} />
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
                <Text className="font-display text-fg leading-tight" style={{ fontSize: 32, letterSpacing: -0.4 }}>
                  {thread.title}
                </Text>
                {thread.tags.length > 0 || thread.dueDate ? (
                  <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1 mt-2.5">
                    {thread.dueDate ? <DueDateLabel dueDate={thread.dueDate} /> : null}
                    {thread.tags.length > 0 ? (
                      <Text className="font-sans text-sm" style={{ color: colors.fgTertiary }}>
                        {thread.tags.map((t) => `#${t}`).join('  ')}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </>
            )}
          </MotiView>

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
                    </View>
                  ) : null}
                </MotiView>
              ) : null}

              {/* ─── Status actions ─────────────────────── */}
              <MotiView {...enter.fade(1)} className="px-6 mt-5 flex-row gap-2">
                {thread.status === 'active' ? (
                  <Button variant="quiet" size="sm" icon="pause" className="flex-1" onPress={() => pauseItem(thread.id)}>
                    Pause
                  </Button>
                ) : (
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
                )}
                {thread.status !== 'completed' && (
                  <Button variant="quiet" size="sm" icon="check" className="flex-1" onPress={() => completeItem(thread.id)}>
                    Done
                  </Button>
                )}
                <IconButton
                  icon="volume"
                  label="Play spoken re-brief"
                  size={36}
                  onPress={() => (rebrief.state === 'idle' ? rebrief.start(thread) : rebrief.stop())}
                />
                {thread.status !== 'archived' && (
                  <IconButton icon="archive" label="Archive" size={36} onPress={() => archiveItem(thread.id)} />
                )}
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

              {/* ─── Timeline ───────────────────────────── */}
              <MotiView {...enter.rise(2)} className="px-6 mt-9">
                <Eyebrow>Timeline</Eyebrow>

                <View className="flex-row gap-2 mb-4">
                  <Button variant="quiet" size="sm" icon="pencil" className="flex-1" onPress={() => addUpdate('write')}>
                    Write an update
                  </Button>
                  <Button variant="quiet" size="sm" icon="mic" className="flex-1" onPress={() => addUpdate('record')}>
                    Record one
                  </Button>
                </View>

                <View className="gap-3">
                  {entries.map((entry) => (
                    <EntryCard
                      key={entry.id}
                      entry={entry}
                      onRetry={entry.pending && !isGenerating ? () => handleRetryProcessing() : undefined}
                    />
                  ))}
                </View>
              </MotiView>

              {/* ─── Smart digest ───────────────────────── */}
              <View className="px-6 mt-9">
                <Eyebrow>Smart digest</Eyebrow>
                {thread.aiSummary ? (
                  <View className="gap-3">
                    {thread.aiSummary.nextSteps.map((step, i) => (
                      <View key={i} className="flex-row items-start">
                        <View
                          className="w-6 h-6 rounded-full items-center justify-center mr-3 mt-0.5"
                          style={{ backgroundColor: colors.accentSoft }}
                        >
                          <Text className="font-sans-semi text-xs" style={{ color: colors.accent }}>
                            {i + 1}
                          </Text>
                        </View>
                        <Text className="flex-1 font-sans text-body leading-relaxed" style={{ color: colors.fg }}>
                          {step}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Card variant="surface" pad="md" animated={false} className="flex-row items-center">
                    <Icon name="sparkles" size={18} color={colors.accent} />
                    <Text className="flex-1 font-sans text-sm leading-snug mx-3" style={{ color: colors.fgSecondary }}>
                      Suggested next steps for this thread.
                    </Text>
                    <Button onPress={handleGenerateDigest} disabled={isGenerating} variant="tonal" size="sm">
                      {isGenerating ? 'Thinking…' : 'Generate'}
                    </Button>
                  </Card>
                )}
              </View>

              {/* ─── Related ────────────────────────────── */}
              {related.length > 0 && (
                <View className="px-6 mt-9">
                  <Eyebrow>Related threads</Eyebrow>
                  <ThreadList>
                    {related.map((r, i) => (
                      <ThreadRow
                        key={r.id}
                        item={r}
                        index={i}
                        last={i === related.length - 1}
                        onPress={() => router.push(`/(tabs)/context?id=${r.id}` as any)}
                      />
                    ))}
                  </ThreadList>
                </View>
              )}
            </>
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
