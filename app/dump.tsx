import React, { useState, useEffect } from 'react';
import { View, Text, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Mic, X, Check } from 'lucide-react-native';
import { router } from 'expo-router';
import { MotiView, AnimatePresence } from 'moti';
import { 
  useAudioRecorder, 
  AudioModule, 
  RecordingPresets, 
  setAudioModeAsync, 
  useAudioRecorderState 
} from 'expo-audio';
import { File, Directory, Paths } from 'expo-file-system';
import { useContextStore } from '@/hooks/use-context-store';
import { processAudioDump } from '@/lib/gemini';
import { ZenButton } from '@/components/ZenButton';

export default function DumpScreen() {
  const { addContext } = useContextStore();
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  // Initialize recorder with HIGH_QUALITY preset
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);
  const isRecording = recorderState.isRecording;

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
          Alert.alert('Permission required', 'Please enable microphone access to record thoughts.');
          return;
        }
      }

      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
    } catch (err) {
      console.error('Failed to start recording', err);
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

      // Copy recording to a permanent location so the file survives recorder cleanup.
      const recordingsDir = new Directory(Paths.document, 'recordings');
      try {
        recordingsDir.create({ intermediates: true, idempotent: true });
      } catch {
        // Directory already exists — safe to continue.
      }
      const permanentFile = new File(recordingsDir, `recording-${Date.now()}.m4a`);
      new File(tempUri).copy(permanentFile);
      const permanentUri = permanentFile.uri;

      try {
        const base64 = await permanentFile.base64();
        const processed = await processAudioDump(base64, 'audio/m4a');
        // Recording processed successfully — clean up the local copy.
        try { permanentFile.delete(); } catch { /* already deleted — safe to ignore */ }
        const newCtx = addContext({
          title: processed.title,
          notes: processed.notes,
          links: processed.links,
          summary: processed.summary,
        });
        router.replace(`/(tabs)/context?id=${newCtx.id}` as any);
      } catch (aiError) {
        // AI unavailable (offline or rate-limited) — save the recording for
        // deferred processing instead of losing the user's note.
        const timestamp = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
        const newCtx = addContext({
          title: `Voice note · ${timestamp}`,
          notes: 'Your recording is saved. It will be transcribed automatically when you\'re back online.',
          links: [],
          pending: true,
          pendingAudioUri: permanentUri,
        });
        router.replace(`/(tabs)/context?id=${newCtx.id}` as any);
      }
    } catch (e) {
      console.error('stopAndSave error', e);
      Alert.alert(
        'Could not save recording',
        'The recording could not be saved. Would you like to type your note instead?',
        [
          { text: 'Type instead', onPress: () => router.replace('/manual' as any) },
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
    <View className="flex-1 bg-bg px-6">
      <SafeAreaView className="flex-1">
        {/* Header */}
        <MotiView
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ type: 'timing', duration: 400 }}
          className="flex-row justify-between items-center mt-6 mb-8"
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
                scale: isRecording ? 1.05 : 1,
                backgroundColor: isRecording ? '#8B9E7E' : '#FFFFFF',
              }}
              transition={{ type: 'timing', duration: 400 }}
              className="w-44 h-44 rounded-full items-center justify-center shadow-soft-lg border border-border/30"
            >
              <Mic size={56} color={isRecording ? '#FFFFFF' : '#8B9E7E'} strokeWidth={1.5} />
            </MotiView>
          </View>

          <MotiView
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500, delay: 200 }}
            className="mt-10"
          >
            <Text className="text-2xl font-serif text-fg text-center">
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

        {/* Visual feedback Area */}
        <View className="h-36 rounded-[16px] bg-surface border border-border/50 p-5 mb-8 shadow-soft-sm items-center justify-center">
          <Text className="font-serif text-sm text-fg-muted italic text-center">
            {isRecording
              ? "Recording your voice..."
              : "Capture audio directly for AI processing"}
          </Text>
        </View>

        {/* Actions */}
        <View className="gap-3 pb-12">
          <AnimatePresence>
            {!isRecording ? (
              <ZenButton
                onPress={startRecording}
                title="Start recording"
                variant="primary"
                size="lg"
                fullWidth
                hapticIntensity="medium"
                icon={<Mic size={22} color="#FFFFFF" />}
              />
            ) : (
              <View className="flex-row gap-3">
                <ZenButton
                  onPress={handleCancel}
                  title="Cancel"
                  variant="outline"
                  size="md"
                  className="flex-1"
                  icon={<X size={20} color="#3D3A36" />}
                />
                <ZenButton
                  onPress={stopAndSave}
                  disabled={isProcessing}
                  title={isProcessing ? "Saving..." : "Save"}
                  variant="primary"
                  size="md"
                  className="flex-[2]"
                  hapticIntensity="medium"
                  icon={isProcessing ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Check size={20} color="#FFFFFF" />}
                />
              </View>
            )}
          </AnimatePresence>
        </View>
      </SafeAreaView>
    </View>
  );
}
