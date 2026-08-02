import { useCallback, useRef, useState } from 'react';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';

import { discardRecordingFile, saveVoiceRecording } from '@/lib/capture';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import type { Category, MnemoItem } from '@/types/mnemo';

// Metering on, so the floating overlay can drive a real waveform instead
// of a decorative loop.
export const QUICK_RECORDER_OPTIONS = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true };

// Below this, a "recording" is almost certainly an accidental hold (a slow
// tap crossing the long-press threshold) rather than an intentional note —
// discard it instead of saving a near-silent blip.
const MIN_RECORDING_MS = 400;

export type QuickRecordingPhase = 'idle' | 'recording' | 'finishing';
export type StartResult = 'ok' | 'permission-denied' | 'device-error';

/**
 * Minimal recording engine for the FAB's hold-to-record fast path — no
 * screen, no category picker, just start/stop. Permission is requested
 * lazily on first use, not on mount, since this hook lives inside the
 * always-mounted ActionCluster and shouldn't prompt for mic access just
 * because the tab bar is on screen.
 *
 * Deliberately does NOT poll live status (duration/metering) itself —
 * `useAudioRecorderState` runs a setInterval for as long as it's mounted,
 * and this hook needs to live for the app's whole lifetime. The returned
 * `audioRecorder` is handed to the floating overlay, which polls it only
 * while it's actually on screen (see RecordingOverlay).
 */
export function useQuickRecording() {
  const { addItem, updateItem } = useMnemoStore();
  const audioRecorder = useAudioRecorder(QUICK_RECORDER_OPTIONS);
  const audioModeReady = useRef(false);
  const startedAt = useRef(0);
  const [phase, setPhase] = useState<QuickRecordingPhase>('idle');

  const start = useCallback(async (): Promise<StartResult> => {
    try {
      if (!audioModeReady.current) {
        const status = await AudioModule.requestRecordingPermissionsAsync();
        if (!status.granted) return 'permission-denied';
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        audioModeReady.current = true;
      }
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      startedAt.current = Date.now();
      setPhase('recording');
      return 'ok';
    } catch (err) {
      console.error('Failed to start quick recording', err);
      return 'device-error';
    }
  }, [audioRecorder]);

  /** Stops the recorder and either saves or discards, based on `save`. */
  const finish = useCallback(
    async (category: Category, save: boolean): Promise<MnemoItem | null> => {
      if (phase !== 'recording') return null;
      const tooShort = Date.now() - startedAt.current < MIN_RECORDING_MS;
      setPhase('finishing');
      try {
        await audioRecorder.stop();
        const tempUri = audioRecorder.uri;
        if (!save || !tempUri || tooShort) {
          discardRecordingFile(tempUri);
          return null;
        }
        return await saveVoiceRecording({ tempUri, category, addItem, updateItem });
      } catch (err) {
        console.error('Failed to finish quick recording', err);
        return null;
      } finally {
        setPhase('idle');
      }
    },
    [phase, audioRecorder, addItem, updateItem],
  );

  return {
    phase,
    isRecording: phase === 'recording',
    audioRecorder,
    start,
    finish,
  };
}
