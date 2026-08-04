import React, { useState, useEffect } from 'react';
import { View, Text, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { Mic, X, Check } from 'lucide-react-native';
import { router } from 'expo-router';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import {
  useAudioRecorder,
  AudioModule,
  setAudioModeAsync,
  useAudioRecorderState
} from 'expo-audio';
import { AmbientGlow } from '@/components/ui/AmbientGlow';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { saveVoiceRecording } from '@/lib/capture';
import { QUICK_RECORDER_OPTIONS } from '@/hooks/use-quick-recording';
import { ZenButton } from '@/components/ZenButton';
import { CategoryPill } from '@/components/ui/CategoryPill';
import { CATEGORY_LIST } from '@/utils/categories';
import { useThemeColors } from '@/hooks/use-theme';
import { useReduceMotion } from '@/hooks/use-accessibility-motion';
import { EASE_OUT } from '@/utils/motion';
import type { Category } from '@/types/mnemo';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

const WAVEFORM_BARS = 12;
// Rough dBFS-ish baseline so bars start small instead of flickering empty
// before the first real metering sample arrives — matches ActionCluster's
// hold-to-record overlay so both recording paths feel the same.
const METERING_BASELINE = -50;

export default function DumpScreen() {
  const insets = useSafeAreaInsets();
  const { addItem, updateItem } = useMnemoStore();
  const reduceMotion = useReduceMotion();

  const [isProcessing, setIsProcessing] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [category, setCategory] = useState<Category>('general');
  const colors = useThemeColors();

  // Metering on, and polled fast (60ms), so the waveform reflects actual
  // input instead of a decorative loop — the recording should feel heard.
  const audioRecorder = useAudioRecorder(QUICK_RECORDER_OPTIONS);
  const recorderState = useAudioRecorderState(audioRecorder, 60);
  const isRecording = recorderState.isRecording;

  // Rolling window of real metering samples, oldest to newest — each bar is
  // an actual past instant rather than an arbitrary shape constant.
  const [levels, setLevels] = useState<number[]>(() =>
    Array(WAVEFORM_BARS).fill(METERING_BASELINE),
  );
  useEffect(() => {
    if (!isRecording) return;
    setLevels((prev) => [...prev.slice(1), recorderState.metering ?? METERING_BASELINE]);
  }, [recorderState.metering, isRecording]);
  useEffect(() => {
    if (isRecording) setLevels(Array(WAVEFORM_BARS).fill(METERING_BASELINE));
  }, [isRecording]);

  useEffect(() => {
    (async () => {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      setHasPermission(status.granted);

      if (status.granted) {
        // Configure audio mode for recording
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
        });
      }
    })();
  }, []);

  async function startRecording() {
    try {
      if (!hasPermission) {
        const status = await AudioModule.requestRecordingPermissionsAsync();
        setHasPermission(status.granted);
        if (!status.granted) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          Alert.alert('Permission required', 'Please enable microphone access to record thoughts.');
          return;
        }
      }

      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
    } catch (err) {
      console.error('Failed to start recording', err);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        'Microphone error',
        'Could not start recording. Check that the app has microphone permission in Settings.',
      );
    }
  }

  async function stopAndSave() {
    setIsProcessing(true);
    try {
      await audioRecorder.stop();
      const tempUri = audioRecorder.uri;

      if (!tempUri) throw new Error('No recording URI');

      // saveVoiceRecording copies the file to a permanent location, adds
      // the pending item, and kicks off background AI structuring — the
      // same path the FAB's quick hold-to-record flow uses.
      const newItem = await saveVoiceRecording({ tempUri, category, addItem, updateItem });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(`/(tabs)/context?id=${newItem.id}` as any);
    } catch (e) {
      console.error('stopAndSave error', e);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        'Could not save recording',
        'The recording could not be saved. Would you like to type your note instead?',
        [
          { text: 'Type instead', onPress: () => router.replace('/capture' as any) },
          { text: 'Dismiss', style: 'cancel' },
        ],
      );
    } finally {
      setIsProcessing(false);
    }
  }

  // Handle cancellation
  const handleCancel = async () => {
    if (isRecording) {
      await audioRecorder.stop();
    }
    router.back();
  };

  return (
    <AmbientGlow>
    <View className="flex-1 px-6">
      <View className="flex-1">
        {/* Header */}
        <MotiView
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ type: 'timing', duration: 400 }}
          className="flex-row justify-between items-center mb-6"
          style={{ paddingTop: Math.max(insets.top, 16) }}
        >
          <Text className="font-sans-medium text-sm text-fg-muted">
            {isRecording ? "Listening..." : "Voice capture"}
          </Text>
          {isRecording && (
            <MotiView
              from={{ opacity: 0.4 }}
              animate={{ opacity: 1 }}
              transition={{ type: 'timing', duration: 900, loop: true }}
            >
              <View className="w-2.5 h-2.5 rounded-full bg-accent-warm" />
            </MotiView>
          )}
        </MotiView>

        {/* Category selector — horizontal scroll to match capture screen */}
        {!isRecording && (
          <MotiView
            from={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ type: 'timing', duration: 400, delay: 100 }}
            className="mb-6"
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
        )}

        {/* Central Mic Area */}
        <View className="flex-1 items-center justify-center">
          <View className="relative items-center justify-center">
            {/* Breathing pulse ring */}
            {isRecording && (
              <MotiView
                from={{ scale: 1, opacity: 0.3 }}
                animate={{ scale: 1.6, opacity: 0 }}
                transition={{ type: 'timing', duration: 2200, loop: true, repeatReverse: false }}
                className="absolute w-44 h-44 rounded-full border-2 border-accent"
              />
            )}
            {isRecording && (
              <MotiView
                from={{ scale: 1, opacity: 0.2 }}
                animate={{ scale: 2, opacity: 0 }}
                transition={{ type: 'timing', duration: 2200, delay: 500, loop: true, repeatReverse: false }}
                className="absolute w-44 h-44 rounded-full border border-accent"
              />
            )}

            <MotiView
              animate={{
                // A slow breathe (matched to a relaxed ~4s respiratory
                // cycle) instead of a single static scale bump — recording
                // reads as a living, ongoing state rather than a switch
                // that was merely flipped on.
                scale: isRecording ? 1.03 : 1,
                backgroundColor: isRecording ? colors.accent : colors.surface,
              }}
              transition={{
                scale:
                  isRecording && !reduceMotion
                    ? { type: 'timing', duration: 2000, loop: true, repeatReverse: true }
                    : { type: 'timing', duration: 400 },
                backgroundColor: { type: 'timing', duration: 400 },
              }}
              className="w-44 h-44 rounded-full items-center justify-center shadow-soft-lg border border-border"
            >
              <Mic size={56} color={isRecording ? colors.accentInk : colors.accent} strokeWidth={1.5} />
            </MotiView>
          </View>

          <MotiView
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500, delay: 200 }}
            className="mt-10"
          >
            <Text className="text-2xl font-sans-medium text-fg text-center">
              {isRecording ? "Listening..." : "Ready to listen"}
            </Text>
            <Text className="font-sans text-sm text-fg-muted text-center mt-2">
              {isRecording
                ? "Speak your thoughts freely"
                : !hasPermission
                ? "Microphone permission required"
                : "Tap to start capturing"}
            </Text>
          </MotiView>
        </View>

        {/* Audio level feedback */}
        <View className="h-36 rounded-[16px] bg-surface border border-border/50 p-5 mb-8 shadow-soft-sm items-center justify-center">
          {isRecording ? (
            // Each bar reflects a real past metering sample, oldest to
            // newest — the waveform tracks actual input instead of a
            // decorative loop, so speaking louder visibly registers.
            <View className="flex-row items-end gap-1.5 h-12">
              {levels.map((sample, i) => {
                const level = Math.max(0.12, Math.min(1, (sample + 50) / 45));
                return (
                  <MotiView
                    key={i}
                    animate={{ scaleY: level }}
                    transition={{ type: 'timing', duration: 80 }}
                    style={{
                      width: 4,
                      height: 48,
                      borderRadius: 2,
                      transformOrigin: 'bottom',
                    }}
                    className="bg-accent"
                  />
                );
              })}
            </View>
          ) : (
            <Text className="font-sans-medium text-sm text-fg-muted text-center">
              Capture audio directly for AI processing
            </Text>
          )}
        </View>

        {/* Actions */}
        <View 
          className="gap-3"
          style={{ paddingBottom: Math.max(insets.bottom, 24) + 12 }}
        >
          {!isRecording ? (
            <MotiView
              key="start"
              from={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ type: 'timing', duration: 200, easing: EASE_OUT }}
            >
              <ZenButton
                onPress={startRecording}
                title="Start recording"
                variant="primary"
                size="lg"
                fullWidth
                hapticIntensity="medium"
                icon={<Mic size={22} color={colors.accentInk} />}
              />
            </MotiView>
          ) : (
            <MotiView
              key="controls"
              from={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ type: 'timing', duration: 200, easing: EASE_OUT }}
              className="flex-row gap-3"
            >
              <ZenButton
                onPress={handleCancel}
                title="Cancel"
                variant="outline"
                size="md"
                className="flex-1"
                icon={<X size={20} color={colors.fg} />}
              />
              <ZenButton
                onPress={stopAndSave}
                disabled={isProcessing}
                title={isProcessing ? "Saving..." : "Save"}
                variant="primary"
                size="md"
                className="flex-[2]"
                hapticIntensity="medium"
                icon={isProcessing ? <ActivityIndicator color={colors.accentInk} size="small" /> : <Check size={20} color={colors.accentInk} />}
              />
            </MotiView>
          )}
        </View>
      </View>
    </View>
    </AmbientGlow>
  );
}
