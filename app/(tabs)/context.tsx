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
import * as Clipboard from 'expo-clipboard';
import { File } from 'expo-file-system';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useRebrief } from '@/hooks/use-rebrief';
import { summarizeContext, processVoiceDump } from '@/lib/gemini';
import { processRecording } from '@/lib/capture';
import {
  ChevronLeft,
  Trash2,
  Sparkles,
  ExternalLink as ExternalLinkIcon,
  Share2,
  Clock,
  Pencil,
  Check,
  X,
  Copy,
  RefreshCw,
  Play,
  Pause,
  CheckCircle,
  Archive,
  MapPin,
  ArrowRight,
  Volume2,
} from 'lucide-react-native';
import { ExternalLink } from '@/components/ExternalLink';
import { formatDistanceToNow } from 'date-fns';
import { MotiView } from 'moti';
import { ZenButton } from '@/components/ZenButton';
import { ZenCard } from '@/components/ZenCard';
import { CategoryPill } from '@/components/ui/CategoryPill';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ChecklistEditor } from '@/components/ui/ChecklistEditor';
import { DueDatePicker } from '@/components/ui/DueDatePicker';
import { DueDateLabel } from '@/components/ui/DueDatePicker';
import { CATEGORY_LIST, useStatusConfig } from '@/utils/categories';
import { useThemeColors } from '@/hooks/use-theme';
import type { Category, ChecklistItem } from '@/types/mnemo';

export default function ItemDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams();
  const {
    items,
    updateItem,
    deleteItem,
    resumeItem,
    pauseItem,
    completeItem,
    archiveItem,
    isLoaded,
  } = useMnemoStore();

  const [isGenerating, setIsGenerating] = React.useState(false);
  const [isEditing, setIsEditing] = React.useState(false);
  const [editTitle, setEditTitle] = React.useState('');
  const [editContent, setEditContent] = React.useState('');
  const [editNextStep, setEditNextStep] = React.useState('');
  const [editWhereLeftOff, setEditWhereLeftOff] = React.useState('');
  const [isCopied, setIsCopied] = React.useState(false);
  const rebrief = useRebrief();
  const colors = useThemeColors();
  const statusColors = useStatusConfig();

  const item = items.find((c) => c.id === id);

  // Keep edit fields in sync when opening a different item.
  // Must run before any early return so the hook order stays stable.
  React.useEffect(() => {
    if (item) {
      setEditTitle(item.title);
      setEditContent(item.content);
      setEditNextStep(item.nextStep ?? '');
      setEditWhereLeftOff(item.whereLeftOff ?? '');
    }
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isLoaded) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!item) {
    return (
      <View className="flex-1 items-center justify-center p-10">
        <Text className="text-4xl mb-4">🌫️</Text>
        <Text className="font-sans-medium text-xl text-fg mb-2">Not found</Text>
        <Text className="font-sans text-sm text-fg-muted mb-8 text-center">
          This item may have drifted away.
        </Text>
        <ZenButton
          onPress={() => router.back()}
          title="Go back"
          variant="outline"
          size="md"
        />
      </View>
    );
  }

  const handleGenerateReport = async () => {
    setIsGenerating(true);
    try {
      const summary = await summarizeContext(item.content, item.links);
      updateItem(item.id, {
        aiSummary: summary,
        whereLeftOff: item.whereLeftOff || summary.leftOff,
        nextStep: item.nextStep || summary.nextSteps?.[0],
      });
    } catch (e) {
      console.error(e);
      Alert.alert('Could not generate summary', 'Check your connection and try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRetryProcessing = async () => {
    setIsGenerating(true);
    try {
      if (item.pendingAudioUri) {
        const audioFile = new File(item.pendingAudioUri);
        if (!audioFile.exists) {
          Alert.alert('Recording unavailable', 'The audio file could not be found. You can edit the note manually.');
          updateItem(item.id, { pending: false, pendingAudioUri: undefined });
          return;
        }
        const base64 = await audioFile.base64();
        const processed = await processRecording({
          fileUri: item.pendingAudioUri,
          base64,
          mimeType: 'audio/m4a',
        });
        try { audioFile.delete(); } catch { /* safe to ignore */ }
        updateItem(item.id, {
          title: processed.title,
          content: processed.notes,
          links: processed.links,
          aiSummary: processed.summary,
          whereLeftOff: processed.summary?.leftOff,
          nextStep: processed.summary?.nextSteps?.[0],
          pending: false,
          pendingAudioUri: undefined,
          pendingRawText: undefined,
        });
      } else if (item.pendingRawText) {
        const processed = await processVoiceDump(item.pendingRawText);
        updateItem(item.id, {
          title: processed.title,
          content: processed.notes,
          links: processed.links,
          aiSummary: processed.summary,
          whereLeftOff: processed.summary?.leftOff,
          nextStep: processed.summary?.nextSteps?.[0],
          pending: false,
          pendingRawText: undefined,
        });
      } else {
        const summary = await summarizeContext(item.content, item.links);
        updateItem(item.id, { aiSummary: summary, pending: false });
      }
    } catch (e) {
      console.error(e);
      Alert.alert('Retry failed', 'Could not process your note. It will be retried automatically next time.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveEdit = () => {
    updateItem(item.id, {
      title: editTitle.trim() || item.title,
      content: editContent,
      nextStep: editNextStep.trim() || undefined,
      whereLeftOff: editWhereLeftOff.trim() || undefined,
    });
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditTitle(item.title);
    setEditContent(item.content);
    setEditNextStep(item.nextStep ?? '');
    setEditWhereLeftOff(item.whereLeftOff ?? '');
    setIsEditing(false);
  };

  const formatNoteText = () =>
    [
      item.title,
      '',
      item.whereLeftOff ? `Where I left off: ${item.whereLeftOff}` : '',
      item.nextStep ? `Next step: ${item.nextStep}` : '',
      '',
      item.content,
      item.links.length > 0 ? '\nLinks:\n' + item.links.join('\n') : '',
    ]
      .filter(Boolean)
      .join('\n');

  const onCopy = async () => {
    await Clipboard.setStringAsync(formatNoteText());
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const onShare = async () => {
    try {
      await Share.share({ message: formatNoteText() });
    } catch (error) {
      console.error(error);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete item',
      'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteItem(item.id);
            router.back();
          },
        },
      ],
    );
  };

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View className="flex-1">
        {/* Navigation Bar */}
        <View
          className="flex-row justify-between items-center px-6 py-4"
          style={{ paddingTop: Math.max(insets.top, 12) }}
        >
          <Pressable
            onPress={isEditing ? handleCancelEdit : () => router.back()}
            className="w-11 h-11 rounded-full bg-surface items-center justify-center border border-border/50 active:opacity-70"
          >
            {isEditing ? (
              <X size={20} color={colors.fg} />
            ) : (
              <ChevronLeft size={20} color={colors.accent} />
            )}
          </Pressable>

          <View className="flex-row gap-2">
            {isEditing ? (
              <Pressable
                onPress={handleSaveEdit}
                className="w-11 h-11 rounded-full bg-accent items-center justify-center active:opacity-70"
                style={{ backgroundColor: colors.accent }}
              >
                <Check size={18} color={colors.accentInk} />
              </Pressable>
            ) : (
              <>
                <Pressable
                  onPress={onCopy}
                  className="w-11 h-11 rounded-full bg-surface items-center justify-center border border-border/50 active:opacity-70"
                >
                  {isCopied ? (
                    <Check size={16} color={colors.accent} />
                  ) : (
                    <Copy size={16} color={colors.fgTertiary} />
                  )}
                </Pressable>
                <Pressable
                  onPress={onShare}
                  className="w-11 h-11 rounded-full bg-surface items-center justify-center border border-border/50 active:opacity-70"
                >
                  <Share2 size={17} color={colors.fg} />
                </Pressable>
                <Pressable
                  onPress={() => setIsEditing(true)}
                  className="w-11 h-11 rounded-full bg-surface items-center justify-center border border-border/50 active:opacity-70"
                >
                  <Pencil size={16} color={colors.fgTertiary} />
                </Pressable>
                <Pressable
                  onPress={handleDelete}
                  className="w-11 h-11 rounded-full bg-error/10 items-center justify-center active:opacity-70"
                >
                  <Trash2 size={17} color={colors.error} />
                </Pressable>
              </>
            )}
          </View>
        </View>

        <ScrollView 
          className="flex-1" 
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 20) + 100 }}
        >
          {/* Pending banner */}
          {item.pending && (
            <MotiView
              from={{ opacity: 0, translateY: -8 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 400 }}
              className="mx-6 mb-2 rounded-[12px] bg-accent-warm/10 border border-accent-warm/30 p-4 flex-row items-center justify-between"
            >
              <View className="flex-1 mr-3">
                <Text className="font-sans-semi text-sm text-accent-warm mb-0.5">
                  Processing queued
                </Text>
                <Text className="font-sans text-xs text-fg-muted">
                  Will be structured automatically when you're back online.
                </Text>
              </View>
              <Pressable
                onPress={handleRetryProcessing}
                disabled={isGenerating}
                className="w-9 h-9 rounded-full bg-accent-warm/20 items-center justify-center active:opacity-70"
              >
                {isGenerating ? (
                  <ActivityIndicator size="small" color={colors.accentWarm} />
                ) : (
                  <RefreshCw size={15} color={colors.accentWarm} />
                )}
              </Pressable>
            </MotiView>
          )}

          {/* Title, Category & Metadata */}
          <MotiView
            from={{ opacity: 0, translateY: 16 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500 }}
            className="px-6 py-6"
          >
            {/* Category & Status */}
            <View className="flex-row items-center gap-2 mb-3">
              <CategoryPill category={item.category} size="md" />
              <StatusBadge status={item.status} size="md" />
              <View className="flex-row items-center ml-auto">
                <Clock size={13} color={colors.accent} />
                <Text className="font-sans-medium text-xs text-accent ml-1.5">
                  {formatDistanceToNow(item.updatedAt)} ago
                </Text>
              </View>
            </View>

            {/* Category edit (when editing) */}
            {isEditing && (
              <View className="mb-4">
                <Text className="font-sans-medium text-[10px] text-fg-muted tracking-wider uppercase mb-2">
                  Category
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 6 }}
                >
                  {CATEGORY_LIST.map((cat) => (
                    <CategoryPill
                      key={cat}
                      category={cat}
                      size="md"
                      selected={item.category === cat}
                      onPress={() => updateItem(item.id, { category: cat })}
                    />
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Title */}
            {isEditing ? (
              <TextInput
                value={editTitle}
                onChangeText={setEditTitle}
                className="text-3xl font-sans-medium text-fg leading-snug mb-4 border-b border-accent/40 pb-2"
                multiline
                selectionColor={colors.accent}
                placeholder="Title"
                placeholderTextColor={colors.fgTertiary}
              />
            ) : (
              <Text className="text-3xl font-sans-medium text-fg leading-snug mb-4">
                {item.title}
              </Text>
            )}

            {/* Due date */}
            {isEditing ? (
              <DueDatePicker
                value={item.dueDate}
                onChange={(d) => updateItem(item.id, { dueDate: d })}
              />
            ) : (
              item.dueDate && (
                <View className="mb-2">
                  <DueDateLabel dueDate={item.dueDate} />
                </View>
              )
            )}
          </MotiView>

          {/* ─── Status Controls ────────────────────────── */}
          {!isEditing && (
            <MotiView
              from={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ type: 'timing', duration: 400, delay: 100 }}
              className="px-6 mb-4"
            >
              <View className="flex-row gap-2">
                {item.status !== 'active' && (
                  <Pressable
                    onPress={() => {
                      // Speak the re-brief before flipping status, so the
                      // script reflects how long the item sat untouched.
                      rebrief.start(item);
                      resumeItem(item.id);
                    }}
                    className="flex-1 flex-row items-center justify-center py-2.5 rounded-xl bg-accent/10 active:bg-accent/20"
                  >
                    <Play size={14} color={colors.accent} strokeWidth={2} />
                    <Text className="font-sans-medium text-xs text-accent ml-1.5">
                      Resume
                    </Text>
                  </Pressable>
                )}
                {item.status === 'active' && (
                  <Pressable
                    onPress={() => pauseItem(item.id)}
                    className="flex-1 flex-row items-center justify-center py-2.5 rounded-xl bg-surface-warm active:opacity-70"
                  >
                    <Pause size={14} color={statusColors.paused.color} strokeWidth={2} />
                    <Text className="font-sans-medium text-xs text-fg-muted ml-1.5">
                      Pause
                    </Text>
                  </Pressable>
                )}
                {item.status !== 'completed' && (
                  <Pressable
                    onPress={() => completeItem(item.id)}
                    className="flex-1 flex-row items-center justify-center py-2.5 rounded-xl bg-surface-warm active:opacity-70"
                  >
                    <CheckCircle size={14} color={statusColors.completed.color} strokeWidth={2} />
                    <Text className="font-sans-medium text-xs text-fg-muted ml-1.5">
                      Done
                    </Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() =>
                    rebrief.state === 'idle' ? rebrief.start(item) : rebrief.stop()
                  }
                  accessibilityLabel="Play spoken re-brief"
                  className="flex-row items-center justify-center py-2.5 px-4 rounded-xl bg-accent/10 active:opacity-70"
                >
                  <Volume2 size={14} color={colors.accent} strokeWidth={2} />
                </Pressable>
                {item.status !== 'archived' && (
                  <Pressable
                    onPress={() => archiveItem(item.id)}
                    className="flex-row items-center justify-center py-2.5 px-4 rounded-xl active:opacity-70"
                  >
                    <Archive size={14} color={colors.fgTertiary} strokeWidth={2} />
                  </Pressable>
                )}
              </View>
            </MotiView>
          )}

          {/* ─── Re-brief player pill ─────────────────── */}
          {rebrief.state !== 'idle' && (
            <MotiView
              from={{ opacity: 0, translateY: -6 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 300 }}
              className="px-6 mb-4"
            >
              <Pressable
                onPress={rebrief.stop}
                accessibilityLabel="Stop re-brief"
                className="flex-row items-center rounded-2xl bg-accent/10 border border-accent/20 px-4 py-3 active:opacity-70"
              >
                {rebrief.state === 'preparing' ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <MotiView
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{ type: 'timing', duration: 1400, loop: true }}
                  >
                    <Volume2 size={16} color={colors.accent} />
                  </MotiView>
                )}
                <Text className="flex-1 font-sans-medium text-xs text-accent ml-3">
                  {rebrief.state === 'preparing'
                    ? 'Preparing your re-brief…'
                    : 'Briefing you back in — tap to stop'}
                </Text>
                <X size={14} color={colors.accent} />
              </Pressable>
            </MotiView>
          )}

          {/* ─── Where Left Off & Next Step ──────────── */}
          <MotiView
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 400, delay: 150 }}
            className="px-6 mb-4"
          >
            {isEditing ? (
              <View className="gap-4">
                <View>
                  <Text className="font-sans-medium text-[10px] text-fg-muted tracking-wider uppercase mb-1.5">
                    Where you left off
                  </Text>
                  <TextInput
                    value={editWhereLeftOff}
                    onChangeText={setEditWhereLeftOff}
                    placeholder="e.g. Halfway through chapter 3..."
                    placeholderTextColor={colors.fgTertiary}
                    className="font-sans text-sm text-fg py-2.5 px-3.5 rounded-xl bg-surface-warm/50 border border-border/30"
                    selectionColor={colors.accent}
                  />
                </View>
                <View>
                  <Text className="font-sans-medium text-[10px] text-fg-muted tracking-wider uppercase mb-1.5">
                    Next step
                  </Text>
                  <TextInput
                    value={editNextStep}
                    onChangeText={setEditNextStep}
                    placeholder="e.g. Call the plumber..."
                    placeholderTextColor={colors.fgTertiary}
                    className="font-sans text-sm text-fg py-2.5 px-3.5 rounded-xl bg-surface-warm/50 border border-border/30"
                    selectionColor={colors.accent}
                  />
                </View>
              </View>
            ) : (
              <View className="gap-3">
                {item.whereLeftOff && (
                  <View className="flex-row items-start bg-surface-warm/60 rounded-2xl p-4 border border-border/20">
                    <MapPin size={14} color={colors.accent} style={{ marginTop: 2 }} />
                    <View className="flex-1 ml-2.5">
                      <Text className="font-sans-medium text-[10px] text-fg-muted tracking-wider uppercase mb-1">
                        Where you left off
                      </Text>
                      <Text className="font-sans text-sm text-fg leading-relaxed">
                        {item.whereLeftOff}
                      </Text>
                    </View>
                  </View>
                )}
                {item.nextStep && (
                  <View className="flex-row items-start bg-accent/5 rounded-2xl p-4 border border-accent/10">
                    <ArrowRight size={14} color={colors.accent} style={{ marginTop: 2 }} />
                    <View className="flex-1 ml-2.5">
                      <Text className="font-sans-medium text-[10px] text-accent tracking-wider uppercase mb-1">
                        Next step
                      </Text>
                      <Text className="font-sans-medium text-sm text-fg leading-relaxed">
                        {item.nextStep}
                      </Text>
                    </View>
                  </View>
                )}
              </View>
            )}
          </MotiView>

          {/* ─── Checklist ────────────────────────────── */}
          {item.type === 'checklist' && item.checklistItems && (
            <MotiView
              from={{ opacity: 0, translateY: 12 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 400, delay: 200 }}
              className="px-6 mb-4"
            >
              <Text className="font-sans-medium text-lg text-fg mb-4">Checklist</Text>
              <View className="rounded-[16px] p-5 bg-surface border border-border/30">
                <ChecklistEditor
                  items={item.checklistItems}
                  onChange={(updated) =>
                    updateItem(item.id, { checklistItems: updated })
                  }
                  editable={isEditing}
                />
              </View>
            </MotiView>
          )}

          {/* ─── AI Summary Section ──────────────────── */}
          <MotiView
            from={{ opacity: 0, translateY: 16 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500, delay: 250 }}
            className="px-6 py-6"
          >
            <View className="flex-row justify-between items-center mb-6">
              <View className="flex-row items-center">
                <Sparkles size={18} color={colors.accent} />
                <Text className="text-lg font-sans-medium text-fg ml-2">AI Summary</Text>
              </View>

              {!item.aiSummary && !item.pending && (
                <ZenButton
                  onPress={handleGenerateReport}
                  disabled={isGenerating}
                  title={isGenerating ? 'Thinking...' : 'Generate'}
                  variant="primary"
                  size="sm"
                  icon={
                    isGenerating ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : undefined
                  }
                />
              )}
            </View>

            {isGenerating && (
              <View className="py-16 items-center rounded-[16px] bg-surface-warm">
                <MotiView
                  from={{ opacity: 0.4 }}
                  animate={{ opacity: 1 }}
                  transition={{ type: 'timing', duration: 1200, loop: true }}
                >
                  <Text className="text-3xl mb-4">✨</Text>
                </MotiView>
                <Text className="font-sans text-sm text-fg-muted text-center">
                  Reflecting on your thoughts...
                </Text>
              </View>
            )}

            {!isGenerating && !item.aiSummary && (
              <View className="py-12 items-center rounded-[16px] border border-dashed border-border bg-surface/50">
                <Text className="text-3xl mb-3">🪷</Text>
                <Text className="font-sans text-sm text-fg-muted text-center px-8">
                  {item.pending
                    ? 'Summary will be generated once this note is processed.'
                    : 'Tap "Generate" to create an AI summary.\nThis is optional — your note works without it.'}
                </Text>
              </View>
            )}

            {item.aiSummary && (
              <MotiView
                from={{ opacity: 0, translateY: 16 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: 'timing', duration: 500 }}
                className="gap-5"
              >
                {/* Where you left off (AI) */}
                <ZenCard variant="warm" animated={false}>
                  <Text className="font-sans-medium text-xs text-accent mb-3 tracking-wide">
                    AI analysis
                  </Text>
                  <Text className="font-sans-medium text-xl text-fg leading-relaxed">
                    "{item.aiSummary.leftOff}"
                  </Text>
                </ZenCard>

                {/* Next Steps */}
                <View>
                  <Text className="font-sans-medium text-lg text-fg mb-4">Suggested steps</Text>
                  <View className="gap-3">
                    {item.aiSummary.nextSteps.map((step, i) => (
                      <View
                        key={i}
                        className="flex-row items-start bg-surface rounded-[12px] p-5 border border-border/40"
                      >
                        <View className="w-7 h-7 rounded-full bg-accent/15 items-center justify-center mr-4 mt-0.5">
                          <Text className="font-sans-semi text-xs text-accent">{i + 1}</Text>
                        </View>
                        <Text className="flex-1 font-sans text-sm text-fg leading-relaxed">
                          {step}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>

                {/* Resources */}
                {item.aiSummary.resources.length > 0 && (
                  <View>
                    <Text className="font-sans-medium text-lg text-fg mb-4">Resources</Text>
                    <View className="gap-2">
                      {item.aiSummary.resources.map((res, i) => (
                        <ExternalLink
                          key={i}
                          href={res.url}
                          className="flex-row items-center justify-between bg-surface rounded-[12px] px-5 py-4 border border-border/40"
                        >
                          <Text
                            className="font-sans text-sm text-fg flex-1 mr-4"
                            numberOfLines={1}
                          >
                            {res.name}
                          </Text>
                          <ExternalLinkIcon size={14} color={colors.accent} />
                        </ExternalLink>
                      ))}
                    </View>
                  </View>
                )}
              </MotiView>
            )}
          </MotiView>

          {/* ─── Raw Content ─────────────────────────── */}
          <MotiView
            from={{ opacity: 0, translateY: 16 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500, delay: 300 }}
            className="px-6 pb-24 mt-4"
          >
            <Text className="font-sans-medium text-lg text-fg mb-4">Your notes</Text>

            <View className="rounded-[16px] p-6 bg-surface-warm/60 border border-border/30">
              {isEditing ? (
                <TextInput
                  value={editContent}
                  onChangeText={setEditContent}
                  multiline
                  autoFocus
                  className="font-sans text-sm leading-7 text-fg/80 min-h-[120px]"
                  textAlignVertical="top"
                  selectionColor={colors.accent}
                  placeholder="Your notes..."
                  placeholderTextColor={colors.fgTertiary}
                />
              ) : (
                <Text className="font-sans text-sm leading-7 text-fg/80">
                  {item.content}
                </Text>
              )}

              {!isEditing && item.links.length > 0 && (
                <View className="mt-6 pt-6 border-t border-border/40">
                  <Text className="font-sans-medium text-xs text-fg-muted mb-3 tracking-wide">
                    Attached links
                  </Text>
                  <View className="gap-2">
                    {item.links.map((link, i) => (
                      <ExternalLink
                        key={i}
                        href={link}
                        className="flex-row items-center justify-between rounded-[10px] px-4 py-3 bg-surface border border-border/30 active:opacity-70"
                      >
                        <Text
                          className="font-sans text-xs text-fg-muted flex-1 mr-4"
                          numberOfLines={1}
                        >
                          {link}
                        </Text>
                        <ExternalLinkIcon size={12} color={colors.fgTertiary} />
                      </ExternalLink>
                    ))}
                  </View>
                </View>
              )}
            </View>
          </MotiView>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
