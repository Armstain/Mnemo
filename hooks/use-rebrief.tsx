import { useCallback, useEffect, useRef, useState } from 'react';
import * as Speech from 'expo-speech';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { formatDistanceToNow } from 'date-fns';
import { bn } from 'date-fns/locale/bn';

import { generateRebriefScript, generateSpeech } from '@/lib/gemini';
import { base64ToBytes, pcmToWav } from '@/lib/pcm';
import { languageOf } from '@/lib/language';
import type { MnemoItem } from '@/types/mnemo';

function isBangla(item: MnemoItem): boolean {
  return languageOf(`${item.title} ${item.content}`.slice(0, 400)) === 'bn-BD';
}

// Longest to wait on Gemini for the script and then its voice, before the
// phone's own script and voice take over, so Resume never hangs.
const SCRIPT_WAIT_MS = 5000;
const VOICE_WAIT_MS = 7000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out')), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export type RebriefState = 'idle' | 'preparing' | 'playing';

/**
 * Spoken "re-brief": a short audio briefing that talks the user back
 * into an item they stepped away from.
 *
 * Preferred path: Gemini writes the script and voices it (warm, in the
 * note's language). Each stage has a time limit and degrades on its own:
 * a script composed on the phone, read by the device's built-in TTS, so
 * the feature always works, offline or when Gemini is busy.
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
        script = await withTimeout(
          generateRebriefScript({ title: item.title, timeAway, whereLeftOff, nextSteps }),
          SCRIPT_WAIT_MS,
        );
      } catch {
        // Offline, busy or slow: the script composed on the phone covers it.
      }
      if (requestRef.current !== requestId) return;

      try {
        const pcmBase64 = await withTimeout(generateSpeech(script), VOICE_WAIT_MS);
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
          // The phone's voice for the note's language, if it has one.
          language: languageOf(script) === 'bn-BD' ? 'bn-BD' : undefined,
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

/** Offline fallback script, built from the item's own fields, in the note's language. */
function composeLocalScript(item: MnemoItem, timeAway: string): string {
  if (isBangla(item)) {
    const away = formatDistanceToNow(item.lastResumedAt ?? item.updatedAt, { locale: bn });
    const leftOff = item.whereLeftOff || item.aiSummary?.leftOff;
    const next = item.nextStep || item.aiSummary?.nextSteps?.[0];
    const parts = [`${item.title}।`, `শেষবার এটা দেখেছেন ${away} আগে।`];
    if (leftOff) parts.push(`যেখানে থেমেছিলেন: ${leftOff}`);
    if (next) parts.push(`পরের কাজ: ${next}`);
    if (!leftOff && !next) parts.push('নোটগুলো খুলে আবার শুরু করুন।');
    return parts.join(' ');
  }
  const parts = [`${item.title}.`, `It's been ${timeAway} since you last touched this.`];
  const leftOff = item.whereLeftOff || item.aiSummary?.leftOff;
  const next = item.nextStep || item.aiSummary?.nextSteps?.[0];
  if (leftOff) parts.push(`Where you left off: ${leftOff}`);
  if (next) parts.push(`Your next step: ${next}`);
  if (!leftOff && !next) parts.push('Open your notes to get back into it.');
  return parts.join(' ');
}
