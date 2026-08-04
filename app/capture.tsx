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
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, X, ChevronDown, ChevronUp } from 'lucide-react-native';
import { MotiView } from 'moti';
import { AmbientGlow } from '@/components/ui/AmbientGlow';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { resolvePendingItem } from '@/lib/capture';
import { ZenButton } from '@/components/ZenButton';
import { CategoryPill } from '@/components/ui/CategoryPill';
import { ChecklistEditor } from '@/components/ui/ChecklistEditor';
import { DueDatePicker } from '@/components/ui/DueDatePicker';
import { EditorToolbar, type TextSelection } from '@/components/ui/EditorToolbar';
import { CATEGORY_LIST } from '@/utils/categories';
import { useThemeColors } from '@/hooks/use-theme';
import type { Category, ChecklistItem } from '@/types/mnemo';

/**
 * CaptureScreen — one unified surface for a thought: freeform (markdown)
 * text plus an always-available checklist section, the way Apple Notes /
 * Google Keep let you mix prose and checkboxes in the same note instead of
 * forcing an upfront "note vs. checklist" choice. The saved item's `type`
 * is inferred from whether any checklist items were actually added.
 */
export default function CaptureScreen() {
  const insets = useSafeAreaInsets();
  const { addItem, updateItem } = useMnemoStore();

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

    // Save instantly with the raw content so the user never waits on the
    // network — AI structuring (title/summary/links) happens in the
    // background and patches the item in place when it lands.
    const newItem = addItem({
      type: hasChecklist ? 'checklist' : 'note',
      title: fallbackTitle,
      content: trimmedText,
      checklistItems: hasChecklist ? checklistItems : undefined,
      links: [],
      category,
      tags: [],
      status: 'active',
      nextStep: nextStep.trim() || undefined,
      whereLeftOff: whereLeftOff.trim() || undefined,
      dueDate,
      pending: hasTextToStructure,
      pendingRawText: hasTextToStructure ? trimmedText : undefined,
    });

    router.replace(`/(tabs)/context?id=${newItem.id}` as any);

    if (hasTextToStructure) {
      resolvePendingItem(newItem, updateItem);
    }
  };

  return (
    <AmbientGlow>
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View className="flex-1 px-6">
        {/* Header */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 500 }}
          className="mb-6"
          style={{ paddingTop: Math.max(insets.top, 16) }}
        >
          <Text className="font-sans text-xs text-fg-muted mb-2 tracking-wide uppercase">
            Capture
          </Text>
          <Text className="text-3xl font-sans-medium text-fg">
            New thought
          </Text>
        </MotiView>

        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {/* Category selector */}
          <MotiView
            from={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ type: 'timing', duration: 400, delay: 100 }}
            className="mb-5"
          >
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
                  selected={category === cat}
                  onPress={() => setCategory(cat)}
                />
              ))}
            </ScrollView>
          </MotiView>

          {/* Main content area — freeform text + optional checklist, one surface */}
          <MotiView
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500, delay: 150 }}
          >
            <View
              className="rounded-[20px] p-5 mb-4"
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
            >
              <TextInput
                multiline
                autoFocus
                placeholder="What's on your mind?"
                placeholderTextColor={colors.fgTertiary}
                className="font-sans text-base text-fg leading-7 min-h-[140px]"
                value={text}
                onChangeText={setText}
                selection={selection}
                onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
                textAlignVertical="top"
                selectionColor={colors.accent}
              />

              {showChecklist && (
                <View className="border-t mt-4 pt-4" style={{ borderColor: colors.border }}>
                  <ChecklistEditor
                    items={checklistItems}
                    onChange={setChecklistItems}
                    editable
                  />
                </View>
              )}

              <View className="mt-4">
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

            {/* Character / item count */}
            <Text className="font-sans text-xs text-fg-muted text-right mb-4">
              {text.length} characters
              {checklistItems.length > 0 && ` · ${checklistItems.length} items`}
            </Text>
          </MotiView>

          {/* Optional fields toggle */}
          <MotiView
            from={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ type: 'timing', duration: 400, delay: 250 }}
          >
            <Pressable
              onPress={() => setShowOptional(!showOptional)}
              android_ripple={{ color: colors.border }}
              className="flex-row items-center justify-between py-3 mb-2 rounded-xl overflow-hidden"
            >
              <Text className="font-sans-medium text-xs text-fg-muted tracking-wide">
                More details (optional)
              </Text>
              {showOptional ? (
                <ChevronUp size={16} color={colors.fgTertiary} />
              ) : (
                <ChevronDown size={16} color={colors.fgTertiary} />
              )}
            </Pressable>

            {showOptional && (
              <MotiView
                from={{ opacity: 0, translateY: -8 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: 'timing', duration: 300 }}
                className="gap-4 mb-6"
              >
                {/* Where left off */}
                <View>
                  <Text className="font-sans-medium text-[10px] text-fg-muted tracking-wider uppercase mb-1.5">
                    Where you left off
                  </Text>
                  <TextInput
                    placeholder="e.g. Halfway through chapter 3..."
                    placeholderTextColor={colors.fgTertiary}
                    className="font-sans text-sm text-fg py-2.5 px-3.5 rounded-xl"
                    style={{ backgroundColor: colors.surfaceHigh }}
                    value={whereLeftOff}
                    onChangeText={setWhereLeftOff}
                    selectionColor={colors.accent}
                  />
                </View>

                {/* Next step */}
                <View>
                  <Text className="font-sans-medium text-[10px] text-fg-muted tracking-wider uppercase mb-1.5">
                    Next step
                  </Text>
                  <TextInput
                    placeholder="e.g. Call the plumber..."
                    placeholderTextColor={colors.fgTertiary}
                    className="font-sans text-sm text-fg py-2.5 px-3.5 rounded-xl"
                    style={{ backgroundColor: colors.surfaceHigh }}
                    value={nextStep}
                    onChangeText={setNextStep}
                    selectionColor={colors.accent}
                  />
                </View>

                {/* Due date */}
                <View>
                  <Text className="font-sans-medium text-[10px] text-fg-muted tracking-wider uppercase mb-1.5">
                    Due date
                  </Text>
                  <DueDatePicker value={dueDate} onChange={setDueDate} />
                </View>
              </MotiView>
            )}
          </MotiView>
        </ScrollView>

        {/* Actions */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 400, delay: 300 }}
          className="gap-3 border-t border-border/40"
          style={{
            paddingTop: 16,
            paddingBottom: Math.max(insets.bottom, 24) + 8,
          }}
        >
          <ZenButton
            onPress={handleSave}
            disabled={!canSave}
            title="Save"
            variant="primary"
            size="lg"
            fullWidth
            hapticIntensity="medium"
            icon={<Check size={22} color={colors.accentInk} />}
          />
          <ZenButton
            onPress={() => router.back()}
            title="Cancel"
            variant="ghost"
            size="md"
            fullWidth
            icon={<X size={18} color={colors.fg} />}
          />
        </MotiView>
      </View>
    </KeyboardAvoidingView>
    </AmbientGlow>
  );
}
