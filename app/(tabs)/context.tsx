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
import Markdown from 'react-native-markdown-display';
import { NAV_CLEARANCE } from '@/components/ui/FloatingTabBar';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useRebrief } from '@/hooks/use-rebrief';
import { summarizeContext } from '@/lib/gemini';
import { structurePendingItem } from '@/lib/capture';
import {
  ExternalLink as ExternalLinkIcon,
  RefreshCw,
  FileQuestion,
} from 'lucide-react-native';
import { ExternalLink } from '@/components/ExternalLink';
import { NoteRow } from '@/components/ui/NoteRow';
import { DetailSkeleton } from '@/components/ui/NoteListSkeleton';
import { relatedItems } from '@/lib/search';
import { formatDistanceToNow } from 'date-fns';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import { useUndoToast } from '@/hooks/use-undo-toast';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';
import { Icon } from '@/components/ui/Icon';
import { ChecklistEditor } from '@/components/ui/ChecklistEditor';
import { DueDatePicker } from '@/components/ui/DueDatePicker';
import { DueDateLabel } from '@/components/ui/DueDatePicker';
import { CATEGORY_LIST, useCategories, useStatusConfig } from '@/utils/categories';
import { useThemeColors } from '@/hooks/use-theme';
import type { MnemoItem } from '@/types/mnemo';
import { EASE_IN_OUT, useEnter } from '@/utils/motion';
import { freshness } from '@/utils/time';
import { ThreadRing } from '@/components/ui/ThreadRing';

/** Eyebrow heading for a detail-screen section. */
function SectionLabel({ children }: { children: string }) {
  const colors = useThemeColors();
  return (
    <Text className="font-sans-semi text-micro uppercase tracking-caps mb-2.5" style={{ color: colors.fgTertiary }}>
      {children}
    </Text>
  );
}

export default function ItemDetailScreen() {
  const enter = useEnter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams();
  const {
    items,
    updateItem,
    deleteItem,
    undoDelete,
    resumeItem,
    pauseItem,
    completeItem,
    archiveItem,
    isLoaded,
  } = useMnemoStore();
  const { showUndoToast } = useUndoToast();

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
  const categories = useCategories();

  const markdownStyles = React.useMemo(
    () => ({
      body: { color: colors.fg, fontSize: 14, lineHeight: 24 },
      heading1: { color: colors.fg, fontSize: 22, fontWeight: '600' as const, marginTop: 8, marginBottom: 8 },
      heading2: { color: colors.fg, fontSize: 19, fontWeight: '600' as const, marginTop: 8, marginBottom: 6 },
      heading3: { color: colors.fg, fontSize: 16, fontWeight: '600' as const, marginTop: 6, marginBottom: 4 },
      strong: { fontWeight: '700' as const, color: colors.fg },
      em: { fontStyle: 'italic' as const },
      link: { color: colors.accent },
      bullet_list_icon: { color: colors.fgSecondary },
      ordered_list_icon: { color: colors.fgSecondary },
      code_inline: {
        backgroundColor: colors.surfaceHigh,
        color: colors.fg,
        borderRadius: 4,
        paddingHorizontal: 4,
      },
      code_block: {
        backgroundColor: colors.surfaceHigh,
        color: colors.fg,
        borderRadius: 8,
        padding: 10,
      },
      fence: {
        backgroundColor: colors.surfaceHigh,
        color: colors.fg,
        borderRadius: 8,
        padding: 10,
      },
      blockquote: {
        backgroundColor: colors.surfaceHigh,
        borderLeftColor: colors.accent,
        borderLeftWidth: 3,
        paddingHorizontal: 10,
        paddingVertical: 4,
      },
      hr: { backgroundColor: colors.border, height: 1 },
    }),
    [colors],
  );

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

  // Nearest neighbors by embedding similarity — a supplementary section,
  // never a blocking one. Empty until the note has a vector (structuring +
  // embedding finished) and stays empty on failure rather than erroring.
  const [related, setRelated] = React.useState<MnemoItem[]>([]);
  React.useEffect(() => {
    if (!item) {
      setRelated([]);
      return;
    }
    let cancelled = false;
    relatedItems(item.id, items).then((found) => {
      if (!cancelled) setRelated(found);
    });
    return () => {
      cancelled = true;
    };
  }, [item?.id, items]);

  if (!isLoaded) {
    return (
      <View className="flex-1 px-6" style={{ paddingTop: Math.max(insets.top, 16) + 20 }}>
        <DetailSkeleton />
      </View>
    );
  }

  if (!item) {
    return (
      <View className="flex-1 items-center justify-center p-10">
        <View
          className="w-14 h-14 rounded-full items-center justify-center mb-4"
          style={{ backgroundColor: colors.surface }}
        >
          <FileQuestion size={28} color={colors.fgTertiary} strokeWidth={1.5} />
        </View>
        <Text className="font-sans-medium text-xl text-fg mb-2">Not found</Text>
        <Text className="font-sans text-sm text-fg-muted mb-8 text-center">
          This item may have drifted away.
        </Text>
        <Button onPress={() => router.back()} variant="quiet" size="md">
          Go back
        </Button>
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
    if (item.pendingAudioUri && !new File(item.pendingAudioUri).exists) {
      Alert.alert('Recording unavailable', 'The audio file could not be found. You can edit the note manually.');
      updateItem(item.id, { pending: false, pendingAudioUri: undefined });
      return;
    }

    setIsGenerating(true);
    try {
      if (item.pendingAudioUri || item.pendingRawText) {
        await structurePendingItem(item, updateItem);
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
    // Deletes immediately with a grace window instead of blocking on a
    // confirm dialog — an "Undo" toast removes the fear of a mistake
    // without making every delete cost a second tap.
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    deleteItem(item.id);
    showUndoToast(`"${item.title}" deleted`, () => undoDelete(item.id));
    router.back();
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
          <IconButton
            icon={isEditing ? 'x' : 'chevronLeft'}
            label={isEditing ? 'Cancel' : 'Back'}
            onPress={isEditing ? handleCancelEdit : () => router.back()}
          />

          <View className="flex-row gap-1">
            {isEditing ? (
              <Button onPress={handleSaveEdit} variant="primary" size="sm" icon="check">
                Save
              </Button>
            ) : (
              <>
                <IconButton
                  icon={isCopied ? 'check' : 'copy'}
                  label="Copy"
                  variant="bare"
                  onPress={onCopy}
                />
                <IconButton icon="share" label="Share" variant="bare" onPress={onShare} />
                <IconButton icon="pencil" label="Edit" variant="bare" onPress={() => setIsEditing(true)} />
                <IconButton icon="trash" label="Delete" variant="bare" onPress={handleDelete} />
              </>
            )}
          </View>
        </View>

        <ScrollView 
          className="flex-1" 
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 20) + NAV_CLEARANCE }}
        >
          {/* Pending banner */}
          {item.pending && (
            <MotiView {...enter.rise(0, -8)}
              className="mx-6 mb-2 rounded-[12px] bg-accent-warm/10 border border-accent-warm/30 p-4 flex-row items-center justify-between"
            >
              <View className="flex-1 mr-3">
                <Text className="font-sans-semi text-sm text-accent-warm mb-0.5">
                  Structuring in background
                </Text>
                <Text className="font-sans text-xs text-fg-muted">
                  AI is titling and summarizing this note — no need to wait.
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
          <MotiView {...enter.rise(0)}
            className="px-6 py-6"
          >
            {/* Category · status · how long it's been — ring shows how warm the thread still is */}
            <View className="flex-row items-center mb-5">
              <ThreadRing
                size={40}
                progress={freshness(item.updatedAt)}
                color={categories[item.category].color}
                trackColor={categories[item.category].bgTint}
              >
                {React.createElement(categories[item.category].icon, {
                  size: 15,
                  color: categories[item.category].color,
                  strokeWidth: 2,
                })}
              </ThreadRing>
              <View className="ml-3">
                <Text className="font-sans-semi text-xs" style={{ color: colors.fg }}>
                  {categories[item.category].label}
                  <Text className="font-sans-medium" style={{ color: statusColors[item.status].color }}>
                    {'  ·  '}{statusColors[item.status].label}
                  </Text>
                </Text>
                <Text className="font-sans text-xs mt-0.5" style={{ color: colors.fgTertiary }}>
                  Last touched {formatDistanceToNow(item.updatedAt)} ago
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
                    <Pill
                      key={cat}
                      tone={categories[cat].color}
                      size="md"
                      dot={false}
                      outline={item.category !== cat}
                      selected={item.category === cat}
                      onPress={() => updateItem(item.id, { category: cat })}
                    >
                      {categories[cat].label}
                    </Pill>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Title */}
            {isEditing ? (
              <TextInput
                value={editTitle}
                onChangeText={setEditTitle}
                className="text-3xl font-serif text-fg leading-snug mb-4 border-b border-accent/40 pb-2"
                multiline
                selectionColor={colors.accent}
                placeholder="Title"
                placeholderTextColor={colors.fgTertiary}
              />
            ) : (
              <Text className="font-display text-fg leading-tight mb-3" style={{ fontSize: 34, letterSpacing: -0.4 }}>
                {item.title}
              </Text>
            )}

            {/* Tags — AI-generated, read-only */}
            {!isEditing && item.tags.length > 0 && (
              <Text className="font-sans text-xs mb-3" style={{ color: colors.fgTertiary }}>
                {item.tags.map((tag) => `#${tag}`).join('   ')}
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
          {!isEditing && (() => {
            // Compute which buttons are actually visible before rendering the row.
            const hasResume = item.status !== 'active';
            const hasPause = item.status === 'active';
            const hasDone = item.status !== 'completed';
            const hasArchive = item.status !== 'archived';
            const hasAnyAction = hasResume || hasPause || hasDone || hasArchive;
            if (!hasAnyAction) return null;
            return (
              <MotiView {...enter.fade(1)}
                className="px-6 mb-4"
              >
                <View className="flex-row gap-2">
                  {hasResume && (
                    <Button
                      variant="tonal"
                      size="sm"
                      icon="play"
                      className="flex-1"
                      onPress={() => {
                        // Speak the re-brief before flipping status, so the
                        // script reflects how long the item sat untouched.
                        rebrief.start(item);
                        resumeItem(item.id);
                      }}
                    >
                      Resume
                    </Button>
                  )}
                  {hasPause && (
                    <Button variant="quiet" size="sm" icon="pause" className="flex-1" onPress={() => pauseItem(item.id)}>
                      Pause
                    </Button>
                  )}
                  {hasDone && (
                    <Button variant="quiet" size="sm" icon="check" className="flex-1" onPress={() => completeItem(item.id)}>
                      Done
                    </Button>
                  )}
                  <IconButton
                    icon="volume"
                    label="Play spoken re-brief"
                    onPress={() => (rebrief.state === 'idle' ? rebrief.start(item) : rebrief.stop())}
                  />
                  {hasArchive && (
                    <IconButton icon="archive" label="Archive" onPress={() => archiveItem(item.id)} />
                  )}
                </View>
              </MotiView>
            );
          })()}

          {/* ─── Re-brief player pill ─────────────────── */}
          {rebrief.state !== 'idle' && (
            <MotiView {...enter.rise(0, -6)}
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
                    transition={{ type: 'timing', duration: 1400, loop: true, easing: EASE_IN_OUT }}
                  >
                    <Icon name="volume" size={16} color={colors.accent} />
                  </MotiView>
                )}
                <Text className="flex-1 font-sans-medium text-xs text-accent ml-3">
                  {rebrief.state === 'preparing'
                    ? 'Preparing your re-brief…'
                    : 'Briefing you back in — tap to stop'}
                </Text>
                <Icon name="x" size={14} color={colors.accent} />
              </Pressable>
            </MotiView>
          )}

          {/* ─── Where Left Off & Next Step ──────────── */}
          <MotiView {...enter.rise(1)}
            className="px-6 mb-8"
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
                    className="font-sans text-sm text-fg py-2.5 px-3.5 rounded-md bg-surface-warm/50 border border-border/30"
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
                    className="font-sans text-sm text-fg py-2.5 px-3.5 rounded-md bg-surface-warm/50 border border-border/30"
                    selectionColor={colors.accent}
                  />
                </View>
              </View>
            ) : (
              <View className="gap-3">
                {item.whereLeftOff && (
                  <View className="pl-4 mb-2" style={{ borderLeftWidth: 2, borderLeftColor: categories[item.category].color }}>
                    <Text className="font-sans-semi text-micro uppercase tracking-caps mb-1.5" style={{ color: colors.fgTertiary }}>
                      Where you left off
                    </Text>
                    <Text className="font-quote text-heading leading-relaxed" style={{ color: colors.fgSecondary }}>
                      “{item.whereLeftOff}”
                    </Text>
                  </View>
                )}
                {item.nextStep && (
                  <View className="flex-row items-center rounded-md p-4" style={{ backgroundColor: colors.accentSoft }}>
                    <View className="w-8 h-8 rounded-full items-center justify-center" style={{ backgroundColor: colors.accent }}>
                      <Icon name="arrowRight" size={15} stroke={2.2} color={colors.accentInk} />
                    </View>
                    <View className="flex-1 ml-3">
                      <Text className="font-sans-semi text-micro uppercase tracking-caps mb-0.5" style={{ color: colors.accent }}>
                        Next step
                      </Text>
                      <Text className="font-sans-medium text-sm leading-snug" style={{ color: colors.fg }}>
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
            <MotiView {...enter.rise(1)}
              className="px-6 mb-8"
            >
              <SectionLabel>Checklist</SectionLabel>
              <View className="rounded-md p-5 bg-surface border border-border/60">
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

          {/* ─── Notes ───────────────────────────────── */}
          {(isEditing || item.content.trim().length > 0) && (
            <MotiView {...enter.rise(2)}
              className="px-6 mb-8"
            >
              <SectionLabel>Notes</SectionLabel>
              <View className="rounded-md p-5 bg-surface border border-border/60">
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
                  <Markdown style={markdownStyles}>{item.content}</Markdown>
                )}
              </View>
            </MotiView>
          )}

          {/* ─── Smart Digest Section ──────────────────── */}
          <MotiView {...enter.rise(2)}
            className="px-6 mb-8"
          >
            <SectionLabel>Smart digest</SectionLabel>

            {isGenerating && (
              <View className="py-10 items-center rounded-md bg-surface">
                <MotiView
                  from={{ opacity: 0.4 }}
                  animate={{ opacity: 1 }}
                  transition={{
                    type: 'timing',
                    duration: 1200,
                    loop: true,
                    repeatReverse: true,
                    easing: EASE_IN_OUT,
                  }}
                >
                  <Icon name="sparkles" size={24} color={colors.accent} />
                </MotiView>
                <Text className="font-sans text-sm text-fg-muted text-center mt-3">
                  Reading your note…
                </Text>
              </View>
            )}

            {!isGenerating && !item.aiSummary && (
              <View
                className="flex-row items-center rounded-md p-4"
                style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
              >
                <Icon name="sparkles" size={18} color={colors.accent} />
                <Text className="flex-1 font-sans text-sm leading-snug mx-3" style={{ color: colors.fgSecondary }}>
                  {item.pending
                    ? 'Available once this note finishes processing.'
                    : 'Suggested next steps and resources for this note.'}
                </Text>
                {!item.pending && (
                  <Button onPress={handleGenerateReport} variant="tonal" size="sm">
                    Generate
                  </Button>
                )}
              </View>
            )}

            {item.aiSummary && (
              <MotiView {...enter.rise(0)}
                className="gap-5"
              >
                {/* Where you left off (AI) */}
                <Card variant="tinted" animated={false}>
                  <Text className="font-sans-medium text-xs text-accent mb-3 tracking-wide">
                    AI analysis
                  </Text>
                  <Text className="font-display text-heading text-fg leading-relaxed">
                    “{item.aiSummary.leftOff ?? 'No summary available.'}”
                  </Text>
                </Card>

                {/* Next Steps */}
                <View>
                  <SectionLabel>Suggested steps</SectionLabel>
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
                    <SectionLabel>Resources</SectionLabel>
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

          {/* ─── Links ───────────────────────────────── */}
          {!isEditing && item.links.length > 0 && (
            <View className="px-6 mb-8">
              <SectionLabel>Links</SectionLabel>
              <View className="gap-2">
                {item.links.map((link, i) => (
                  <ExternalLink
                    key={i}
                    href={link}
                    className="flex-row items-center justify-between rounded-sm px-4 py-3 bg-surface border border-border/60 active:opacity-70"
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

          {/* ─── Related ─────────────────────────────── */}
          {!isEditing && related.length > 0 && (
            <View className="px-6 mb-8">
              <SectionLabel>Related notes</SectionLabel>
              {related.map((relatedItem, i) => (
                <NoteRow
                  key={relatedItem.id}
                  item={relatedItem}
                  index={i}
                  onPress={() => router.push(`/(tabs)/context?id=${relatedItem.id}` as any)}
                />
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
