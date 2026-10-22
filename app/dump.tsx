import React, { useEffect, useRef, useState } from 'react';
import { View, Alert, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { TextInput } from '@/components/ui/TextInput';
import { Text } from '@/components/ui/Text';
import { router, useLocalSearchParams } from 'expo-router';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import { Easing } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCaptureTarget } from '@/hooks/use-capture-target';
import { useSpeechCapture } from '@/hooks/use-speech-capture';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import { saveVoiceNote } from '@/lib/capture';
import { mayAutostart } from '@/lib/launch-key';
import { FocusDestination } from '@/components/ui/FocusDestination';
import { Button, IconButton } from '@/components/ui/Button';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { CategoryPicker } from '@/components/ui/CategoryPicker';
import { RecordButton } from '@/components/ui/RecordButton';
import { EASE_IN_OUT, useEnter } from '@/utils/motion';
import { noFocusRing } from '@/utils/web';
import type { Category } from '@/types/mnemo';

const WAVEFORM_BARS = 14;
const SAMPLE_MS = 80;

type Phase = 'ready' | 'listening' | 'review';

/**
 * The Record screen. With Gemini on, it records, and Gemini writes the note
 * out on its thread (the recording is then deleted). Offline, the phone
 * transcribes as you talk, and the words are yours to fix before saving.
 */
export default function DumpScreen() {
  const enter = useEnter();
  const insets = useSafeAreaInsets();
  const store = useMnemoStore();
  const colors = useThemeColors();

  const { autostart, key, threadId } = useLocalSearchParams<{ autostart?: string; key?: string; threadId?: string }>();
  const target = useCaptureTarget(threadId);
  const targetThread = target.destination;

  const [phase, setPhase] = useState<Phase>('ready');
  const [category, setCategory] = useState<Category>('general');
  const [draft, setDraft] = useState('');
  const levelNow = useRef(0);
  const speech = useSpeechCapture({ onLevel: (v) => (levelNow.current = v) });

  // A rolling waveform from the microphone level, only while listening.
  const [levels, setLevels] = useState<number[]>(() => Array(WAVEFORM_BARS).fill(0));
  useEffect(() => {
    if (phase !== 'listening') return;
    const timer = setInterval(() => setLevels((prev) => [...prev.slice(1), levelNow.current]), SAMPLE_MS);
    return () => clearInterval(timer);
  }, [phase]);

  async function startListening() {
    const result = await speech.start();
    if (result !== 'ok') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        result === 'permission-denied' ? 'Microphone is off' : "Can't listen on this phone",
        result === 'permission-denied'
          ? 'Allow the microphone and speech recognition in Settings.'
          : "Speech recognition isn't available. On Android it comes with the Google app. You can write the note instead.",
      );
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
    setPhase('listening');
  }

  // Opened from the Record shortcut or widget: start listening at once.
  // Only those carry this install's key; any other link waits for a tap.
  const autostarted = useRef(false);
  useEffect(() => {
    if (autostart !== '1' || autostarted.current) return;
    autostarted.current = true;
    mayAutostart(key).then((ok) => {
      if (ok) startListening();
    });
  }, [autostart, key]); // eslint-disable-line react-hooks/exhaustive-deps

  async function finishListening() {
    const { words, audio } = await speech.stop();
    // Recorded for Gemini: nothing to read over yet, so it's saved now and
    // written out on the thread.
    if (audio.length > 0) {
      const saved = saveVoiceNote({ text: '', audio, category, threadId: targetThread?.id, filing: target.filing, store });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(`/(tabs)/context?id=${saved.threadId}`);
      return;
    }
    // "Record more" appends to what's already there.
    const next = [draft.trim(), words.trim()].filter(Boolean).join(' ');
    setDraft(next);
    setPhase(next ? 'review' : 'ready');
    if (!next) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert("Didn't catch that", 'Nothing was heard. Try again a little closer to the phone.');
    }
  }

  function save() {
    const text = draft.trim();
    if (!text) return;
    const saved = saveVoiceNote({ text, category, threadId: targetThread?.id, filing: target.filing, store });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace(`/(tabs)/context?id=${saved.threadId}`);
  }

  function close() {
    speech.cancel();
    router.back();
  }

  const listening = phase === 'listening';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView className="flex-1 px-6" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header — same shape as the Write screen: close, title, balance */}
        <MotiView
          {...enter.fade(0)}
          className="flex-row items-center justify-between mb-4"
          style={{ paddingTop: Math.max(insets.top, 16) }}
        >
          <IconButton icon="x" label="Close" variant="bare" onPress={close} />
          <Text className="flex-1 text-center font-sans-medium text-sm text-fg-secondary mx-3" numberOfLines={1}>
            {targetThread ? `Add to ${targetThread.title}` : 'Voice note'}
          </Text>
          <View style={{ width: 44, alignItems: 'center' }}>
            {listening && (
              <MotiView
                from={{ opacity: 0.4 }}
                animate={{ opacity: 1 }}
                transition={{ type: 'timing', duration: 900, loop: true, repeatReverse: true, easing: EASE_IN_OUT }}
              >
                <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors.error }} />
              </MotiView>
            )}
          </View>
        </MotiView>

        {phase === 'ready' && (
          <>
            {target.focusThread && (
              <MotiView {...enter.fade(1)} className="mb-4">
                <FocusDestination focusThread={target.focusThread} separate={target.separate} onToggle={target.setSeparate} />
              </MotiView>
            )}
            {!targetThread && (
              <MotiView {...enter.fade(1)} className="mb-4">
                <Eyebrow className="mb-2.5">Category</Eyebrow>
                <CategoryPicker value={category} onChange={setCategory} />
              </MotiView>
            )}
          </>
        )}

        {phase === 'review' ? (
          // The words, ready to fix before saving.
          <View className="flex-1">
            <Eyebrow className="mb-2.5">What you said</Eyebrow>
            <View
              className="flex-1 rounded-lg px-5 pt-4 pb-3"
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
            >
              <TextInput
                value={draft}
                onChangeText={setDraft}
                multiline
                textAlignVertical="top"
                selectionColor={colors.accent}
                accessibilityLabel="What you said"
                className="flex-1 font-sans text-fg"
                style={[{ fontSize: 17, lineHeight: 27 }, noFocusRing]}
              />
            </View>
            <Text className="font-sans text-sm mt-2.5" style={{ color: colors.fgTertiary }}>
              Fix any misheard words; only this text is saved.
            </Text>
          </View>
        ) : (
          <View className="flex-1 items-center justify-center">
            <RecordButton size={listening ? 88 : 112} recording={listening} orbit />

            {listening ? (
              // Live words, newest at the bottom.
              <ScrollView
                className="self-stretch mt-8"
                style={{ maxHeight: 220 }}
                contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}
              >
                <Text
                  className="font-display text-center"
                  style={{ color: speech.text ? colors.fg : colors.fgTertiary, fontSize: 22, lineHeight: 32 }}
                >
                  {speech.text || (speech.recording ? 'Listening… Gemini writes it out when you tap Done.' : 'Listening…')}
                </Text>
              </ScrollView>
            ) : (
              <MotiView {...enter.rise(2)} className="mt-10 items-center">
                <Text className="font-display text-title text-fg text-center">Talk it through</Text>
                <Text className="font-sans text-body text-fg-secondary text-center mt-2 leading-relaxed px-6">
                  In Bangla, English or both. Only the words are kept, never the audio.
                </Text>
              </MotiView>
            )}

            {listening && (
              <View className="flex-row items-center gap-1.5 h-12 mt-6">
                {levels.map((level, i) => (
                  <MotiView
                    key={i}
                    animate={{ scaleY: Math.max(0.12, level) }}
                    transition={{ type: 'timing', duration: SAMPLE_MS, easing: Easing.linear }}
                    style={{ width: 4, height: 40, borderRadius: 2, backgroundColor: colors.accent }}
                  />
                ))}
              </View>
            )}
          </View>
        )}

        {/* Actions */}
        <View className="gap-3 pt-4" style={{ paddingBottom: Math.max(insets.bottom, 24) + 12 }}>
          {phase === 'ready' && (
            <Button onPress={startListening} variant="primary" size="lg" fullWidth icon="mic">
              Start talking
            </Button>
          )}
          {phase === 'listening' && (
            <View className="flex-row gap-3">
              <Button onPress={close} variant="quiet" size="md" className="flex-1" icon="x">
                Cancel
              </Button>
              <Button onPress={finishListening} variant="primary" size="md" className="flex-1" icon="check">
                Done
              </Button>
            </View>
          )}
          {phase === 'review' && (
            <View className="flex-row gap-3">
              <Button onPress={startListening} variant="quiet" size="md" className="flex-1" icon="mic">
                Say more
              </Button>
              <Button onPress={save} variant="primary" size="md" className="flex-1" icon="check" disabled={!draft.trim()}>
                Save
              </Button>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
