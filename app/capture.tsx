import React, { useState, useMemo } from 'react';
import {
  View,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Image,
} from 'react-native';
import { TextInput } from '@/components/ui/TextInput';
import { Text } from '@/components/ui/Text';
import { router, useLocalSearchParams } from 'expo-router';
import { useCaptureTarget } from '@/hooks/use-capture-target';
import { FocusDestination } from '@/components/ui/FocusDestination';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { saveTextNote } from '@/lib/capture';
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
import { imageUri, pickPhotos, type ImageBlock } from '@/lib/images';
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
  const target = useCaptureTarget(threadId);
  const targetThread = target.destination;

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
  const [photos, setPhotos] = useState<ImageBlock[]>([]);

  const addPhotos = async (source: 'camera' | 'library') => {
    const kept = await pickPhotos(source);
    if (kept.length > 0) setPhotos((p) => [...p, ...kept]);
  };
  const choosePhotoSource = () => {
    // The web has no camera picker worth offering; phones ask which.
    if (Platform.OS === 'web') return addPhotos('library');
    Alert.alert('Add a photo', undefined, [
      { text: 'Take a photo', onPress: () => addPhotos('camera') },
      { text: 'Choose from photos', onPress: () => addPhotos('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const colors = useThemeColors();

  const canSave = useMemo(
    () => text.trim().length > 0 || checklistItems.length > 0 || photos.length > 0,
    [text, checklistItems, photos],
  );

  const handleSave = () => {
    if (!canSave) return;
    // One save path for typed notes (lib/capture.ts): instant, and tidied
    // up by AI in the background only when AI is on.
    const saved = saveTextNote({
      text,
      category,
      threadId: targetThread?.id,
      filing: target.filing,
      checklistItems,
      leftOff: whereLeftOff,
      nextStep,
      dueDate,
      images: photos,
      store,
    });
    router.replace(`/(tabs)/context?id=${saved.threadId}` as any);
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
          {/* Focus thread, with a way to keep this one note separate */}
          {target.focusThread && (
            <MotiView {...enter.fade(1)} className="mb-5">
              <FocusDestination
                focusThread={target.focusThread}
                separate={target.separate}
                onToggle={target.setSeparate}
              />
            </MotiView>
          )}

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

              {photos.length > 0 && (
                <View className="flex-row flex-wrap gap-2 mt-3">
                  {photos.map((p, i) => (
                    <View key={i}>
                      <Image
                        source={{ uri: imageUri(p) }}
                        style={{ width: 72, height: 72, borderRadius: 10, borderWidth: 1, borderColor: colors.border }}
                      />
                      <Pressable
                        onPress={() => setPhotos((all) => all.filter((_, j) => j !== i))}
                        hitSlop={6}
                        accessibilityRole="button"
                        accessibilityLabel="Remove photo"
                        className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full items-center justify-center"
                        style={{ backgroundColor: colors.fg }}
                      >
                        <Icon name="x" size={12} color={colors.bg} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}

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
                  onAddPhoto={choosePhotoSource}
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
                  <Eyebrow className="mb-2">Remind me</Eyebrow>
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
