import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import {
  useAudioRecorder,
  AudioModule,
  setAudioModeAsync,
  useAudioRecorderState
} from 'expo-audio';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { saveVoiceRecording } from '@/lib/capture';
import { QUICK_RECORDER_OPTIONS } from '@/hooks/use-quick-recording';
import { Button, IconButton } from '@/components/ui/Button';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { CategoryPicker } from '@/components/ui/CategoryPicker';
import { RecordButton } from '@/components/ui/RecordButton';
import { useThemeColors } from '@/hooks/use-theme';
import { Easing } from 'react-native-reanimated';
import { EASE_IN_OUT, useEnter } from '@/utils/motion';
import type { Category } from '@/types/mnemo';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

const WAVEFORM_BARS = 12;
// Rough dBFS-ish baseline so bars start small instead of flickering empty
// before the first real metering sample arrives — matches ActionCluster's
// hold-to-record overlay so both recording paths feel the same.
const METERING_BASELINE = -50;

export default function DumpScreen() {
  const enter = useEnter();
  const insets = useSafeAreaInsets();
  const store = useMnemoStore();

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

  // ?autostart=1 opens straight into listening — the entry point for
  // capture from outside the app (home-screen quick action, and later
  // widgets / Siri / Control Center, which all deep-link to
  // mnemo://dump?autostart=1). Waits for the permission check on mount so
  // a first-time user gets the OS prompt, not a failed start.
  // ?threadId=… records into an existing thread (from a thread screen)
  // instead of starting a new one, so there's no category to pick.
  const { autostart, threadId } = useLocalSearchParams<{ autostart?: string; threadId?: string }>();
  const targetThreadId = typeof threadId === 'string' && threadId ? threadId : undefined;
  const targetThread = targetThreadId ? store.items.find((i) => i.id === targetThreadId) : undefined;
  const autostarted = useRef(false);
  useEffect(() => {
    if (autostart !== '1' || !hasPermission || autostarted.current) return;
    autostarted.current = true;
    startRecording();
  }, [autostart, hasPermission]); // eslint-disable-line react-hooks/exhaustive-deps

  async function stopAndSave() {
    setIsProcessing(true);
    try {
      await audioRecorder.stop();
      const tempUri = audioRecorder.uri;

      if (!tempUri) throw new Error('No recording URI');

      // saveVoiceRecording copies the file to a permanent location, adds
      // the pending item, and kicks off background AI structuring — the
      // same path the FAB's quick hold-to-record flow uses.
      const saved = await saveVoiceRecording({ tempUri, category, threadId: targetThreadId, store });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(`/(tabs)/context?id=${saved.threadId}` as any);
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
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
    <View className="flex-1 px-6">
      <View className="flex-1">
        {/* Header — same shape as the Write screen: close, title, balance */}
        <MotiView
          {...enter.fade(0)}
          className="flex-row items-center justify-between mb-4"
          style={{ paddingTop: Math.max(insets.top, 16) }}
        >
          <IconButton icon="x" label="Close" variant="bare" onPress={handleCancel} />
          <Text className="flex-1 text-center font-sans-medium text-sm text-fg-secondary mx-3" numberOfLines={1}>
            {targetThread ? `Add to ${targetThread.title}` : 'Voice note'}
          </Text>
          <View style={{ width: 44, alignItems: 'center' }}>
            {isRecording && (
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

        {/* Category — only when starting a new thread */}
        {!isRecording && !targetThread && (
          <MotiView {...enter.fade(1)} className="mb-4">
            <Eyebrow className="mb-2.5">Category</Eyebrow>
            <CategoryPicker value={category} onChange={setCategory} />
          </MotiView>
        )}

        {/* Central Mic Area */}
        <View className="flex-1 items-center justify-center">
          <RecordButton size={112} recording={isRecording} orbit />

          <MotiView {...enter.rise(2)}
            className="mt-10"
          >
            <Text className="font-display text-title text-fg text-center">
              {isRecording ? 'Listening…' : 'Talk it through'}
            </Text>
            <Text className="font-sans text-body text-fg-secondary text-center mt-2 leading-relaxed px-6">
              {isRecording
                ? 'Say it the way you would tell a friend.'
                : hasPermission === false
                  ? 'Mnemo needs the microphone. You can allow it in Settings.'
                  : 'Mnemo writes up the note, where you left off and what comes next.'}
            </Text>
          </MotiView>
        </View>

        {/* Live level — only while recording */}
        {isRecording && (
          <View className="h-20 items-center justify-center mb-6">
            {/* Each bar is a real past metering sample, oldest to newest, so
                speaking louder visibly registers. */}
            <View className="flex-row items-end gap-1.5 h-12">
              {levels.map((sample, i) => {
                const level = Math.max(0.12, Math.min(1, (sample + 50) / 45));
                return (
                  <MotiView
                    key={i}
                    animate={{ scaleY: level }}
                    transition={{ type: 'timing', duration: 80, easing: Easing.linear }}
                    style={{ width: 4, height: 48, borderRadius: 2, transformOrigin: 'bottom', backgroundColor: colors.accent }}
                  />
                );
              })}
            </View>
          </View>
        )}

        {/* Actions */}
        <View
          className="gap-3"
          style={{ paddingBottom: Math.max(insets.bottom, 24) + 12 }}
        >
          {!isRecording ? (
            <MotiView
              key="start"
              {...enter.fade(0)}
            >
              <Button onPress={startRecording} variant="primary" size="lg" fullWidth icon="mic">
                Start recording
              </Button>
            </MotiView>
          ) : (
            <MotiView
              key="controls"
              {...enter.fade(0)}
              className="flex-row gap-3"
            >
              <Button onPress={handleCancel} variant="quiet" size="md" className="flex-1" icon="x">
                Cancel
              </Button>
              <Button
                onPress={stopAndSave}
                disabled={isProcessing}
                variant="primary"
                size="md"
                className="flex-2"
                icon="check"
              >
                {isProcessing ? 'Saving…' : 'Save'}
              </Button>
            </MotiView>
          )}
        </View>
      </View>
    </View>
    </View>
  );
}
