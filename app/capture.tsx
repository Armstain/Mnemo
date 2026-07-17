import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Check,
  X,
  PenLine,
  CheckSquare,
  ChevronDown,
  ChevronUp,
} from 'lucide-react-native';
import { MotiView } from 'moti';
import { AmbientGlow } from '@/components/ui/AmbientGlow';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { processVoiceDump } from '@/lib/gemini';
import { ZenButton } from '@/components/ZenButton';
import { CategoryPill } from '@/components/ui/CategoryPill';
import { ChecklistEditor } from '@/components/ui/ChecklistEditor';
import { DueDatePicker } from '@/components/ui/DueDatePicker';
import { CATEGORY_LIST, useStatusConfig } from '@/utils/categories';
import { useThemeColors } from '@/hooks/use-theme';
import type { Category, ChecklistItem, ItemType } from '@/types/mnemo';

type CaptureMode = 'note' | 'checklist';

export default function CaptureScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ mode?: string }>();
  const { addItem } = useMnemoStore();

  // Mode
  const initialMode = (params.mode === 'checklist' ? 'checklist' : 'note') as CaptureMode;
  const [mode, setMode] = useState<CaptureMode>(initialMode);

  // Core fields
  const [text, setText] = useState('');
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [category, setCategory] = useState<Category>('general');

  // Optional fields
  const [showOptional, setShowOptional] = useState(false);
  const [nextStep, setNextStep] = useState('');
  const [whereLeftOff, setWhereLeftOff] = useState('');
  const [dueDate, setDueDate] = useState<number | undefined>();

  // UI state
  const [isProcessing, setIsProcessing] = useState(false);
  const colors = useThemeColors();
  const statusColors = useStatusConfig();

  const canSave = useMemo(() => {
    if (mode === 'note') return text.trim().length > 0;
    if (mode === 'checklist')
      return checklistItems.length > 0 || text.trim().length > 0;
    return false;
  }, [mode, text, checklistItems]);

  const handleSave = async () => {
    if (!canSave) return;
    setIsProcessing(true);

    // Build title from first line of text
    const rawTitle = text.trim().split('\n')[0];
    const fallbackTitle =
      rawTitle.length > 50
        ? rawTitle.substring(0, 50) + '…'
        : rawTitle || (mode === 'checklist' ? 'Checklist' : 'Quick note');

    try {
      // Try AI processing for richer output
      const processed = await processVoiceDump(text);
      const newItem = addItem({
        type: mode as ItemType,
        title: processed.title || fallbackTitle,
        content: processed.notes || text.trim(),
        checklistItems: mode === 'checklist' ? checklistItems : undefined,
        links: processed.links || [],
        category,
        tags: [],
        status: 'active',
        nextStep: nextStep.trim() || processed.summary?.nextSteps?.[0],
        whereLeftOff: whereLeftOff.trim() || processed.summary?.leftOff,
        dueDate,
        aiSummary: processed.summary,
      });
      router.replace(`/(tabs)/context?id=${newItem.id}` as any);
    } catch {
      // AI unavailable — save offline with raw content
      const newItem = addItem({
        type: mode as ItemType,
        title: fallbackTitle,
        content: text.trim(),
        checklistItems: mode === 'checklist' ? checklistItems : undefined,
        links: [],
        category,
        tags: [],
        status: 'active',
        nextStep: nextStep.trim() || undefined,
        whereLeftOff: whereLeftOff.trim() || undefined,
        dueDate,
        pending: true,
        pendingRawText: text.trim(),
      });
      router.replace(`/(tabs)/context?id=${newItem.id}` as any);
    } finally {
      setIsProcessing(false);
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
            {mode === 'checklist' ? 'New checklist' : 'New note'}
          </Text>
        </MotiView>

        {/* Mode toggle */}
        <MotiView
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ type: 'timing', duration: 400, delay: 100 }}
          className="flex-row bg-surface-warm/50 rounded-xl p-1 mb-5"
        >
          <Pressable
            onPress={() => setMode('note')}
            className={`flex-1 flex-row items-center justify-center py-2.5 rounded-lg ${
              mode === 'note' ? 'bg-surface shadow-soft-sm' : ''
            }`}
          >
            <PenLine
              size={14}
              color={mode === 'note' ? colors.accent : colors.fgTertiary}
              strokeWidth={1.8}
            />
            <Text
              className={`font-sans-medium text-xs ml-1.5 ${
                mode === 'note' ? 'text-fg' : 'text-fg-muted'
              }`}
            >
              Note
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setMode('checklist')}
            className={`flex-1 flex-row items-center justify-center py-2.5 rounded-lg ${
              mode === 'checklist' ? 'bg-surface shadow-soft-sm' : ''
            }`}
          >
            <CheckSquare
              size={14}
              color={mode === 'checklist' ? statusColors.completed.color : colors.fgTertiary}
              strokeWidth={1.8}
            />
            <Text
              className={`font-sans-medium text-xs ml-1.5 ${
                mode === 'checklist' ? 'text-fg' : 'text-fg-muted'
              }`}
            >
              Checklist
            </Text>
          </Pressable>
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
            transition={{ type: 'timing', duration: 400, delay: 150 }}
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

          {/* Main content area */}
          <MotiView
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500, delay: 200 }}
          >
            <View className="rounded-[16px] bg-surface border border-border/50 p-5 shadow-soft mb-4">
              <TextInput
                multiline
                autoFocus
                placeholder={
                  mode === 'checklist'
                    ? 'Title or description...'
                    : "What's on your mind?"
                }
                placeholderTextColor={colors.fgTertiary}
                className={`font-sans text-base text-fg leading-7 ${
                  mode === 'note' ? 'min-h-[200px]' : 'min-h-[60px] mb-4'
                }`}
                value={text}
                onChangeText={setText}
                textAlignVertical="top"
                selectionColor={colors.accent}
              />

              {/* Checklist editor */}
              {mode === 'checklist' && (
                <View className="border-t border-border/30 pt-4">
                  <ChecklistEditor
                    items={checklistItems}
                    onChange={setChecklistItems}
                    editable
                  />
                </View>
              )}
            </View>

            {/* Character count */}
            <Text className="font-sans text-xs text-fg-muted text-right mb-4">
              {text.length} characters
              {mode === 'checklist' && ` · ${checklistItems.length} items`}
            </Text>
          </MotiView>

          {/* Optional fields toggle */}
          <MotiView
            from={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ type: 'timing', duration: 400, delay: 300 }}
          >
            <Pressable
              onPress={() => setShowOptional(!showOptional)}
              className="flex-row items-center justify-between py-3 mb-2"
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
                    className="font-sans text-sm text-fg py-2.5 px-3.5 rounded-xl bg-surface-warm/50 border border-border/30"
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
                    className="font-sans text-sm text-fg py-2.5 px-3.5 rounded-xl bg-surface-warm/50 border border-border/30"
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
          transition={{ type: 'timing', duration: 400, delay: 350 }}
          className="gap-3"
          style={{ paddingBottom: Math.max(insets.bottom, 24) + 8 }}
        >
          <ZenButton
            onPress={handleSave}
            disabled={isProcessing || !canSave}
            title={isProcessing ? 'Saving...' : 'Save'}
            variant="primary"
            size="lg"
            fullWidth
            hapticIntensity="medium"
            icon={
              isProcessing ? (
                <ActivityIndicator color={colors.accentInk} size="small" />
              ) : (
                <Check size={22} color={colors.accentInk} />
              )
            }
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
