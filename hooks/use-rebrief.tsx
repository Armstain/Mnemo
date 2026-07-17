import { useCallback, useEffect, useRef, useState } from 'react';
import * as Speech from 'expo-speech';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { formatDistanceToNow } from 'date-fns';

import { generateRebriefScript, generateSpeech } from '@/lib/gemini';
import { base64ToBytes, pcmToWav } from '@/lib/pcm';
import type { MnemoItem } from '@/types/mnemo';

export type RebriefState = 'idle' | 'preparing' | 'playing';

/**
 * Spoken "re-brief": a short audio briefing that talks the user back
 * into an item they stepped away from.
 *
 * Preferred path: Gemini writes the script and voices it (nice voice,
 * matches the note's language). Every stage degrades gracefully —
 * offline it falls back to a locally composed script read by the
 * device's built-in TTS, so the feature always works.
 */
export function useRebrief() {
  const [state, setState] = useState<RebriefState>('idle');
  const playerRef = useRef<AudioPlayer | null>(null);
  // Bumped on every start/stop so stale async work knows to bail out.
  const requestRef = useRef(0);

  const stop = useCallback(() => {
    requestRef.current++;
    if (playerRef.current) {
      try {
        playerRef.current.remove();
      } catch {
        // Player already released.
      }
      playerRef.current = null;
    }
    Speech.stop();
    setState('idle');
  }, []);

  // Release audio resources if the screen unmounts mid-brief.
  useEffect(() => stop, [stop]);

  const start = useCallback(
    async (item: MnemoItem) => {
      stop();
      const requestId = ++requestRef.current;
      setState('preparing');

      const timeAway = formatDistanceToNow(item.lastResumedAt ?? item.updatedAt);
      const whereLeftOff = item.whereLeftOff || item.aiSummary?.leftOff;
      const nextSteps =
        item.aiSummary?.nextSteps?.length
          ? item.aiSummary.nextSteps
          : item.nextStep
            ? [item.nextStep]
            : undefined;

      let script = composeLocalScript(item, timeAway);
      try {
        script = await generateRebriefScript({
          title: item.title,
          timeAway,
          whereLeftOff,
          nextSteps,
        });
      } catch {
        // Offline or AI unavailable — the local script covers it.
      }
      if (requestRef.current !== requestId) return;

      try {
        const pcmBase64 = await generateSpeech(script);
        if (requestRef.current !== requestId) return;

        const wav = pcmToWav(base64ToBytes(pcmBase64));
        const file = new File(Paths.cache, `rebrief-${item.id}.wav`);
        try {
          file.delete();
        } catch {
          // No previous brief cached for this item.
        }
        file.write(wav);

        await setAudioModeAsync({ playsInSilentMode: true });
        if (requestRef.current !== requestId) return;

        const player = createAudioPlayer(file.uri);
        playerRef.current = player;
        player.addListener('playbackStatusUpdate', (status) => {
          if (status.didJustFinish && requestRef.current === requestId) {
            stop();
          }
        });
        player.play();
        setState('playing');
      } catch {
        // Gemini TTS or file I/O unavailable — use the device voice.
        if (requestRef.current !== requestId) return;
        setState('playing');
        Speech.speak(script, {
          onDone: () => {
            if (requestRef.current === requestId) setState('idle');
          },
          onError: () => {
            if (requestRef.current === requestId) setState('idle');
          },
        });
      }
    },
    [stop],
  );

  return { state, start, stop };
}

/** Offline fallback script, built from the item's own fields. */
function composeLocalScript(item: MnemoItem, timeAway: string): string {
  const parts = [`${item.title}.`, `It's been ${timeAway} since you last touched this.`];
  const leftOff = item.whereLeftOff || item.aiSummary?.leftOff;
  const next = item.nextStep || item.aiSummary?.nextSteps?.[0];
  if (leftOff) parts.push(`Where you left off: ${leftOff}`);
  if (next) parts.push(`Your next step: ${next}`);
  if (!leftOff && !next) parts.push('Open your notes to get back into it.');
  return parts.join(' ');
}
