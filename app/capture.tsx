import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { resolvePendingEntry } from '@/lib/capture';
import { buildBlocks } from '@/lib/threads';
import { Button, IconButton } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { CategoryPicker } from '@/components/ui/CategoryPicker';
import { LabeledInput } from '@/components/ui/LabeledInput';
import { noFocusRing } from '@/utils/web';
import { ChecklistEditor } from '@/components/ui/ChecklistEditor';
import { DueDatePicker } from '@/components/ui/DueDatePicker';
import { EditorToolbar, type TextSelection } from '@/components/ui/EditorToolbar';
import { useThemeColors } from '@/hooks/use-theme';
import type { Category, ChecklistItem } from '@/types/mnemo';
import { useReduceMotion } from '@/hooks/use-accessibility-motion';
import { DUR_TOGGLE, EASE_IN_OUT, EASE_OUT, motion, useEnter } from '@/utils/motion';

/**
 * CaptureScreen — one unified surface for a thought: freeform (markdown)
 * text plus an always-available checklist section, the way Apple Notes /
 * Google Keep let you mix prose and checkboxes in the same note instead of
 * forcing an upfront "note vs. checklist" choice. The saved item's `type`
 * is inferred from whether any checklist items were actually added.
 */
export default function CaptureScreen() {
  const enter = useEnter();
  const reduceMotion = useReduceMotion();
  const insets = useSafeAreaInsets();
  const store = useMnemoStore();
  // ?threadId=… adds an entry to that thread instead of starting a new one.
  const { threadId } = useLocalSearchParams<{ threadId?: string }>();
  const targetThread =
    typeof threadId === 'string' && threadId ? store.items.find((i) => i.id === threadId) : undefined;

  // Core fields
  const [text, setText] = useState('');
  const [selection, setSelection] = useState<TextSelection>({ start: 0, end: 0 });
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [showChecklist, setShowChecklist] = useState(false);
  const [category, setCategory] = useState<Category>('general');

  // Optional fields
  const [showOptional, setShowOptional] = useState(false);
  const [nextStep, setNextStep] = useState('');
  const [whereLeftOff, setWhereLeftOff] = useState('');
  const [dueDate, setDueDate] = useState<number | undefined>();

  const colors = useThemeColors();

  const canSave = useMemo(
    () => text.trim().length > 0 || checklistItems.length > 0,
    [text, checklistItems],
  );

  const handleSave = () => {
    if (!canSave) return;

    const trimmedText = text.trim();
    const hasChecklist = checklistItems.length > 0;

    // Build title from the first line of text, falling back to a
    // checklist-aware default when there's no free text at all.
    const rawTitle = trimmedText.split('\n')[0];
    const fallbackTitle =
      rawTitle.length > 50
        ? rawTitle.substring(0, 50) + '…'
        : rawTitle || (hasChecklist ? 'Checklist' : 'Quick note');
    const hasTextToStructure = trimmedText.length > 0;

    // Save instantly with the raw text so the user never waits on the
    // network — AI structuring (title/summary/links) happens in the
    // background and patches the entry (and a new thread's title) in place.
    const entryInput = {
      source: 'text' as const,
      transcript: trimmedText || undefined,
      blocks: buildBlocks({ text: trimmedText, checklistItems }),
      leftOff: whereLeftOff.trim() || undefined,
      nextStep: nextStep.trim() || undefined,
      pending: hasTextToStructure,
      pendingRawText: hasTextToStructure ? trimmedText : undefined,
    };

    let savedThreadId: string;
    let entry;
    if (targetThread) {
      entry = store.addEntry(targetThread.id, entryInput);
      savedThreadId = targetThread.id;
      if (dueDate) store.updateItem(targetThread.id, { dueDate });
    } else {
      const created = store.createThread(
        {
          title: fallbackTitle,
          category,
          tags: [],
          status: 'active',
          dueDate,
          pending: hasTextToStructure,
        },
        entryInput,
      );
      entry = created.entry;
      savedThreadId = created.thread.id;
    }

    router.replace(`/(tabs)/context?id=${savedThreadId}` as any);

    if (hasTextToStructure) {
      resolvePendingEntry(entry, store);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View className="flex-1 px-6">
        {/* Header — carries Cancel/Save directly (not a bottom footer) so
            they stay above the keyboard instead of getting covered by it. */}
        <MotiView {...enter.rise(0)}
          className="flex-row items-center justify-between mb-4"
          style={{ paddingTop: Math.max(insets.top, 16) }}
        >
          <IconButton icon="x" label="Cancel" variant="bare" onPress={() => router.back()} />

          <Text
            className="flex-1 text-center font-sans-medium text-sm text-fg-secondary mx-3"
            numberOfLines={1}
          >
            {targetThread ? `Add to ${targetThread.title}` : 'New thought'}
          </Text>

          <Button onPress={handleSave} disabled={!canSave} variant="primary" size="sm" icon="check">
            Save
          </Button>
        </MotiView>

        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 24) + 24 }}
        >
          {/* Category — only when starting a new thread */}
          {!targetThread && (
            <MotiView {...enter.fade(1)} className="mb-6">
              <Eyebrow className="mb-2.5">Category</Eyebrow>
              <CategoryPicker value={category} onChange={setCategory} />
            </MotiView>
          )}

          {/* Text + optional checklist, one surface */}
          <MotiView {...enter.rise(1)}>
            <View
              className="rounded-md px-5 pt-4 pb-3 mb-5"
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
            >
              <TextInput
                multiline
                autoFocus
                placeholder={targetThread ? 'What changed?' : "What's on your mind?"}
                placeholderTextColor={colors.fgTertiary}
                className="font-sans text-fg min-h-[160px]"
                style={[{ fontSize: 17, lineHeight: 26 }, noFocusRing]}
                value={text}
                onChangeText={setText}
                selection={selection}
                onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
                textAlignVertical="top"
                selectionColor={colors.accent}
              />

              {showChecklist && (
                <View className="border-t mt-4 pt-4" style={{ borderColor: colors.border }}>
                  <ChecklistEditor items={checklistItems} onChange={setChecklistItems} editable />
                </View>
              )}

              <View className="mt-3 pt-2 border-t" style={{ borderColor: colors.border }}>
                <EditorToolbar
                  value={text}
                  selection={selection}
                  onApply={(nextValue, nextSelection) => {
                    setText(nextValue);
                    setSelection(nextSelection);
                  }}
                  checklistVisible={showChecklist}
                  onToggleChecklist={() => setShowChecklist((v) => !v)}
                />
              </View>
            </View>
          </MotiView>

          {/* Optional fields */}
          <MotiView {...enter.fade(2)}>
            <Pressable
              onPress={() => setShowOptional(!showOptional)}
              accessibilityRole="button"
              accessibilityState={{ expanded: showOptional }}
              className="flex-row items-center justify-between py-3 active:opacity-70"
            >
              <Text className="font-sans-medium text-body" style={{ color: colors.fgSecondary }}>
                Add where you left off, next step or a due date
              </Text>
              {/* The chevron turns with the disclosure rather than snapping
                  to its new angle — it's the same 200ms event. */}
              <MotiView
                animate={{ rotate: showOptional ? '180deg' : '0deg' }}
                transition={motion(
                  { type: 'timing' as const, duration: DUR_TOGGLE, easing: EASE_IN_OUT },
                  reduceMotion,
                )}
              >
                <Icon name="chevronDown" size={18} color={colors.fgTertiary} />
              </MotiView>
            </Pressable>

            {showOptional && (
              <MotiView
                from={{ opacity: 0, translateY: -8 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={motion(
                  { type: 'timing' as const, duration: DUR_TOGGLE, easing: EASE_OUT },
                  reduceMotion,
                )}
                className="gap-5 mt-2 mb-6"
              >
                <LabeledInput
                  label="Where you left off"
                  value={whereLeftOff}
                  onChangeText={setWhereLeftOff}
                  placeholder="Halfway through chapter 3…"
                />
                <LabeledInput
                  label="Next step"
                  value={nextStep}
                  onChangeText={setNextStep}
                  placeholder="Call the plumber…"
                />
                <View>
                  <Eyebrow className="mb-2">Due</Eyebrow>
                  <DueDatePicker value={dueDate} onChange={setDueDate} />
                </View>
              </MotiView>
            )}
          </MotiView>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
    </View>
  );
}
