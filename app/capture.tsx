import React, { useMemo, useRef, useState } from 'react';
import { Alert, Image, Keyboard, Platform, Pressable, ScrollView, useWindowDimensions, View, type TextInput as RNTextInput } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { Bold, Clock, ImagePlus, ListChecks, MapPin, StepForward, Tag, Type, type LucideIcon } from 'lucide-react-native';

import { TextInput } from '@/components/ui/TextInput';
import { Text } from '@/components/ui/Text';
import { Button, IconButton } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { CategoryPicker } from '@/components/ui/CategoryPicker';
import { LabeledInput } from '@/components/ui/LabeledInput';
import { ChecklistEditor } from '@/components/ui/ChecklistEditor';
import { DueDatePicker, formatDueDate } from '@/components/ui/DueDatePicker';
import { toggleBold, toggleHeading, type TextSelection } from '@/components/ui/EditorToolbar';
import { FocusDestination } from '@/components/ui/FocusDestination';
import { PlaceChoice, type PlacePick } from '@/components/PlaceChoice';
import { useCaptureTarget } from '@/hooks/use-capture-target';
import { useKeyboardInset } from '@/hooks/use-keyboard-inset';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import { saveTextNote } from '@/lib/capture';
import { allowBackground } from '@/lib/geofence';
import { imageUri, pickPhotos, type ImageBlock } from '@/lib/images';
import { usePlaces } from '@/lib/place-store';
import { placeLabel } from '@/lib/places';
import { usePreferences } from '@/lib/preferences';
import { useCategories } from '@/utils/categories';
import { useEnter } from '@/utils/motion';
import { noFocusRing } from '@/utils/web';
import type { Category, ChecklistItem } from '@/types/mnemo';

type Panel = 'category' | 'remind' | 'place' | 'details';

/**
 * The Write screen: text first, everything else one tap away.
 *
 * Every option lives in a bar docked to the bottom, so it sits right above
 * the keyboard and is never covered by it. Tapping an option puts the
 * keyboard away and opens that option's panel in its place, the way a
 * messaging app opens its attachments; tapping the text brings the
 * keyboard back. What's been chosen shows as chips under the text, each
 * with an × to take it off.
 */
export default function CaptureScreen() {
  const enter = useEnter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const store = useMnemoStore();
  const colors = useThemeColors();
  const categories = useCategories();
  const places = usePlaces();
  const { places: placesOn } = usePreferences();
  // ?threadId=… adds an entry to that thread instead of starting a new one.
  const { threadId } = useLocalSearchParams<{ threadId?: string }>();
  const target = useCaptureTarget(threadId);
  const targetThread = target.destination;

  const rootRef = useRef<View>(null);
  const inputRef = useRef<RNTextInput>(null);
  const keyboard = useKeyboardInset(rootRef);

  const [text, setText] = useState('');
  const [selection, setSelection] = useState<TextSelection>({ start: 0, end: 0 });
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [showChecklist, setShowChecklist] = useState(false);
  const [showFormat, setShowFormat] = useState(false);
  const [category, setCategory] = useState<Category>('general');
  const [nextStep, setNextStep] = useState('');
  const [whereLeftOff, setWhereLeftOff] = useState('');
  const [dueDate, setDueDate] = useState<number | undefined>();
  const [place, setPlace] = useState<PlacePick | undefined>();
  const [photos, setPhotos] = useState<ImageBlock[]>([]);
  const [panel, setPanel] = useState<Panel | null>(null);

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

  /** Opens a panel where the keyboard was; the same button again goes back to typing. */
  const toggle = (next: Panel) => {
    if (panel === next) {
      setPanel(null);
      inputRef.current?.focus();
      return;
    }
    Keyboard.dismiss();
    setShowFormat(false);
    setPanel(next);
  };

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
      place: placesOn ? place : undefined,
      images: photos,
      store,
    });
    router.replace(`/(tabs)/context?id=${saved.threadId}`);
  };

  // What's been chosen, under the text: tap to change, × to take off.
  const chips: { key: string; label: string; panel: Panel; clear: () => void }[] = [
    ...(!targetThread && category !== 'general'
      ? [{ key: 'category', label: categories[category].label, panel: 'category' as const, clear: () => setCategory('general') }]
      : []),
    ...(dueDate ? [{ key: 'remind', label: formatDueDate(dueDate), panel: 'remind' as const, clear: () => setDueDate(undefined) }] : []),
    ...(placesOn && place
      ? [{ key: 'place', label: placeLabel(place, places.find((p) => p.id === place.placeId)), panel: 'place' as const, clear: () => setPlace(undefined) }]
      : []),
    ...(nextStep.trim() ? [{ key: 'next', label: `Next: ${nextStep.trim()}`, panel: 'details' as const, clear: () => setNextStep('') }] : []),
    ...(whereLeftOff.trim()
      ? [{ key: 'left', label: `Left off: ${whereLeftOff.trim()}`, panel: 'details' as const, clear: () => setWhereLeftOff('') }]
      : []),
  ];

  const tools: { key: string; icon: LucideIcon; label: string; active: boolean; set?: boolean; onPress: () => void }[] = [
    { key: 'checklist', icon: ListChecks, label: 'Checklist', active: showChecklist, onPress: () => setShowChecklist((v) => !v) },
    {
      key: 'format',
      icon: Type,
      label: 'Text formatting',
      active: showFormat,
      onPress: () => {
        setPanel(null);
        setShowFormat((v) => !v);
      },
    },
    { key: 'photo', icon: ImagePlus, label: 'Add a photo', active: false, onPress: choosePhotoSource },
    ...(!targetThread
      ? [{ key: 'category', icon: Tag, label: 'Category', active: panel === 'category', set: category !== 'general', onPress: () => toggle('category') }]
      : []),
    { key: 'remind', icon: Clock, label: 'Remind me at a time', active: panel === 'remind', set: !!dueDate, onPress: () => toggle('remind') },
    ...(placesOn
      ? [{ key: 'place', icon: MapPin, label: 'Remind me at a place', active: panel === 'place', set: !!place, onPress: () => toggle('place') }]
      : []),
    {
      key: 'details',
      icon: StepForward,
      label: 'Next step and where you left off',
      active: panel === 'details',
      set: !!(nextStep.trim() || whereLeftOff.trim()),
      onPress: () => toggle('details'),
    },
  ];

  // A panel takes the keyboard's place: as tall as it was, within reason.
  // Typing in a panel (next step) brings the keyboard back over the rest.
  const panelHeight = keyboard.open ? undefined : Math.min(Math.max(keyboard.lastHeight, 240), windowHeight * 0.45);

  return (
    <View ref={rootRef} style={{ flex: 1, backgroundColor: colors.bg, paddingBottom: keyboard.inset }}>
      {/* Header: Cancel and Save, always in reach. */}
      <MotiView
        {...enter.rise(0)}
        className="flex-row items-center justify-between px-6 mb-3"
        style={{ paddingTop: Math.max(insets.top, 16) }}
      >
        <IconButton icon="x" label="Cancel" variant="bare" onPress={() => router.back()} />
        <Text className="flex-1 text-center font-sans-medium text-sm text-fg-secondary mx-3" numberOfLines={1}>
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
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 16 }}
      >
        {target.focusThread && (
          <MotiView {...enter.fade(1)} className="mb-4">
            <FocusDestination focusThread={target.focusThread} separate={target.separate} onToggle={target.setSeparate} />
          </MotiView>
        )}

        <MotiView {...enter.rise(1)}>
          <TextInput
            ref={inputRef}
            multiline
            autoFocus
            placeholder={targetThread ? 'What changed?' : "What's on your mind?"}
            placeholderTextColor={colors.fgTertiary}
            className="font-sans text-fg min-h-[140px]"
            style={[{ fontSize: 18, lineHeight: 27 }, noFocusRing]}
            value={text}
            onChangeText={setText}
            onFocus={() => setPanel(null)}
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

          {chips.length > 0 && (
            <View className="flex-row flex-wrap gap-2 mt-4">
              {chips.map((c) => (
                <View
                  key={c.key}
                  className="flex-row items-center rounded-full pl-3 h-9"
                  style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, maxWidth: '100%' }}
                >
                  <Pressable onPress={() => toggle(c.panel)} accessibilityRole="button" accessibilityLabel={`${c.label}. Change.`} className="shrink">
                    <Text className="font-sans-medium text-sm" style={{ color: colors.fg }} numberOfLines={1}>
                      {c.label}
                    </Text>
                  </Pressable>
                  <Pressable onPress={c.clear} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove: ${c.label}`} className="px-2.5 h-9 justify-center">
                    <Icon name="x" size={13} color={colors.fgTertiary} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </MotiView>
      </ScrollView>

      {/* Formatting: a row above the bar while it's on. */}
      {showFormat && (
        <View className="flex-row items-center px-4 py-2 gap-2" style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Bold"
            onPress={() => {
              const { next, nextSelection } = toggleBold(text, selection);
              setText(next);
              setSelection(nextSelection);
            }}
            className="w-11 h-11 rounded-full items-center justify-center"
            style={{ backgroundColor: colors.surfaceHigh }}
          >
            <Bold size={17} color={colors.fg} strokeWidth={2.4} />
          </Pressable>
          {([1, 2, 3] as const).map((level) => (
            <Pressable
              key={level}
              accessibilityRole="button"
              accessibilityLabel={`Heading ${level}`}
              onPress={() => {
                const { next, nextSelection } = toggleHeading(text, selection, level);
                setText(next);
                setSelection(nextSelection);
              }}
              className="w-11 h-11 rounded-full items-center justify-center"
              style={{ backgroundColor: colors.surfaceHigh }}
            >
              <Text className="font-sans-semi text-[13px]" style={{ color: colors.fg }}>
                H{level}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* The bar: every option, docked right above the keyboard. */}
      <View
        className="flex-row items-center justify-between px-3"
        style={{ borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg, paddingVertical: 6 }}
      >
        {tools.map((t) => (
          <Pressable
            key={t.key}
            onPress={t.onPress}
            accessibilityRole="button"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: t.active }}
            className="w-11 h-11 rounded-full items-center justify-center"
            style={{ backgroundColor: t.active ? colors.primaryContainer : 'transparent' }}
          >
            <t.icon size={21} color={t.active ? colors.onPrimaryContainer : t.set ? colors.accent : colors.fgSecondary} strokeWidth={t.set ? 2.3 : 1.9} />
            {t.set && !t.active ? (
              <View className="absolute w-1.5 h-1.5 rounded-full" style={{ bottom: 6, backgroundColor: colors.accent }} />
            ) : null}
          </Pressable>
        ))}
      </View>

      {/* The open option, where the keyboard was. */}
      {panel ? (
        <View style={{ height: panelHeight, maxHeight: keyboard.open ? 230 : undefined, backgroundColor: colors.surface }}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: keyboard.open ? 20 : Math.max(insets.bottom, 16) + 8, gap: 14 }}>
            {panel === 'category' && (
              <>
                <Text className="font-sans-semi text-sm" style={{ color: colors.fgSecondary }}>
                  Category
                </Text>
                <CategoryPicker value={category} onChange={setCategory} inset={20} />
              </>
            )}
            {panel === 'remind' && (
              <>
                <Text className="font-sans-semi text-sm" style={{ color: colors.fgSecondary }}>
                  Remind me
                </Text>
                <DueDatePicker value={dueDate} onChange={setDueDate} />
              </>
            )}
            {panel === 'place' && (
              <>
                <Text className="font-sans-semi text-sm" style={{ color: colors.fgSecondary }}>
                  Remind me at a place
                </Text>
                <PlaceChoice
                  value={place}
                  onChange={(next) => {
                    setPlace(next);
                    // Without "all the time", nothing rings while Mnemo is closed.
                    if (next) allowBackground();
                  }}
                />
              </>
            )}
            {panel === 'details' && (
              <>
                <LabeledInput label="Next step" value={nextStep} onChangeText={setNextStep} placeholder="Call the plumber…" />
                <LabeledInput label="Where you left off" value={whereLeftOff} onChangeText={setWhereLeftOff} placeholder="Halfway through chapter 3…" />
              </>
            )}
          </ScrollView>
        </View>
      ) : !keyboard.open ? (
        // The bar clears the phone's own buttons when nothing's below it.
        <View style={{ height: insets.bottom }} />
      ) : null}
    </View>
  );
}
