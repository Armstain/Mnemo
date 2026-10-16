import { useCallback, useEffect, useRef, useState } from 'react';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

import { getPreferences, setPreferences, type SpeechLang } from '@/lib/preferences';

// Voice notes are transcribed by the phone's own speech recognition while
// the person talks. No audio is ever written to disk or sent anywhere;
// only the words are kept.

export type ListenStart = 'ok' | 'permission-denied' | 'unavailable';

// Recognition events are global, but several screens can listen (the
// capture button stays mounted under the Record screen). Only the screen
// that started this session handles its events.
let owner = 0;
let nextId = 1;

// How long to wait for the recognizer to hand back its last words after
// stop() before giving up and using what we have.
const STOP_TIMEOUT_MS = 2500;

// After this many restarts in a row with nothing heard, stop trying: the
// recognizer is failing, not pausing.
const MAX_RESTARTS = 4;

export const SPEECH_LANG_NAME: Record<SpeechLang, string> = { 'bn-BD': 'বাংলা', 'en-US': 'English' };

function normaliseLevel(db: number): number {
  // volumechange reports roughly -2 (silence) to 10 (loud).
  return Math.max(0, Math.min(1, (db + 2) / 12));
}

/**
 * Live speech-to-text.
 *
 *   const speech = useSpeechCapture({ onLevel });
 *   await speech.start();          // asks for permission the first time
 *   speech.text                    // what's been heard so far, updating live
 *   const words = await speech.stop();
 *   speech.cancel();               // throw it away
 */
export function useSpeechCapture(options: { onLevel?: (level: number) => void } = {}) {
  const id = useRef(nextId++).current;
  const [listening, setListening] = useState(false);
  const [text, setText] = useState('');

  const finalText = useRef('');
  const interim = useRef('');
  const wanted = useRef(false); // still holding / still recording
  const lang = useRef<SpeechLang>(getPreferences().speechLang);
  const [language, setLanguage] = useState<SpeechLang>(() => getPreferences().speechLang);
  const [problem, setProblem] = useState<'language' | null>(null);
  const restarts = useRef(0);
  // The recognizer can't do this language: waiting for a switch or Done.
  const stalled = useRef(false);
  const stopWaiter = useRef<((text: string) => void) | null>(null);
  const onLevel = useRef(options.onLevel);
  onLevel.current = options.onLevel;

  const mine = () => owner === id;
  const full = () => [finalText.current, interim.current].filter(Boolean).join(' ').trim();
  // Words still showing as "interim" when a session ends were said: keep
  // them, or a restart (after a pause, or a language switch) drops them.
  const keepInterim = () => {
    finalText.current = full();
    interim.current = '';
  };

  const begin = useCallback(() => {
    const english = lang.current === 'en-US';
    ExpoSpeechRecognitionModule.start({
      // One language per note, the one shown on screen. Android's language
      // detection and mid-sentence switching guessed Hindi for Bangla speech
      // and dropped words while it switched; Google's Bangla model already
      // writes the English words people mix in.
      lang: lang.current,
      interimResults: true,
      continuous: true,
      // Android's punctuation (formatting) exists for English only; asking
      // for it in Bangla can end the session as "language not supported".
      addsPunctuation: english,
      requiresOnDeviceRecognition: false,
      androidIntentOptions: {
        // expo-speech-recognition asks for offline-only recognition whenever
        // it streams the microphone (continuous, Android 13+). Offline Bangla
        // is often not installed and offline models miss more words, so let
        // the phone use its best recognizer.
        EXTRA_PREFER_OFFLINE: false,
      },
    });
  }, []);

  useSpeechRecognitionEvent('result', (event) => {
    if (!mine()) return;
    const said = event.results[0]?.transcript?.trim() ?? '';
    if (said) restarts.current = 0;
    if (event.isFinal) {
      if (said) finalText.current = [finalText.current, said].filter(Boolean).join(' ');
      interim.current = '';
    } else {
      interim.current = said;
    }
    setText(full());
  });

  useSpeechRecognitionEvent('volumechange', (event) => {
    if (mine()) onLevel.current?.(normaliseLevel(event.value));
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (!mine()) return;
    // The phone has no recognizer for this language (or it isn't
    // downloaded): restarting won't help. Say so; the other language may work.
    if (event.error === 'language-not-supported') {
      stalled.current = true;
      setProblem('language');
    }
    // Otherwise a pause with nothing said ends the session on some phones;
    // the 'end' that follows starts listening again.
  });

  useSpeechRecognitionEvent('end', () => {
    if (!mine()) return;
    keepInterim();
    // Still recording, but nothing to listen with until the language changes.
    if (stalled.current && wanted.current && !stopWaiter.current) return;
    if (wanted.current && !stopWaiter.current && restarts.current < MAX_RESTARTS) {
      // Older Android stops after a silence even in continuous mode, and a
      // language switch ends the session on purpose: pick up again so the
      // note goes on.
      restarts.current += 1;
      try {
        begin();
        return;
      } catch {
        // Fall through and finish with what we have.
      }
    }
    const words = full();
    setListening(false);
    owner = owner === id ? 0 : owner;
    const resolve = stopWaiter.current;
    stopWaiter.current = null;
    resolve?.(words);
  });

  const start = useCallback(async (): Promise<ListenStart> => {
    try {
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) return 'unavailable';
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) return 'permission-denied';
      owner = id;
      finalText.current = '';
      interim.current = '';
      wanted.current = true;
      restarts.current = 0;
      stalled.current = false;
      lang.current = getPreferences().speechLang;
      setLanguage(lang.current);
      setProblem(null);
      setText('');
      setListening(true);
      begin();
      return 'ok';
    } catch {
      wanted.current = false;
      setListening(false);
      return 'unavailable';
    }
  }, [begin, id]);

  /** Stops listening and resolves with everything that was said. */
  const stop = useCallback((): Promise<string> => {
    wanted.current = false;
    if (!mine()) return Promise.resolve(full());
    if (stalled.current) {
      // No session is running to hand back last words.
      stalled.current = false;
      const words = full();
      setListening(false);
      owner = 0;
      return Promise.resolve(words);
    }
    return new Promise<string>((resolve) => {
      let done = false;
      const finish = (words: string) => {
        if (done) return;
        done = true;
        resolve(words);
      };
      stopWaiter.current = finish;
      setTimeout(() => {
        if (done) return;
        stopWaiter.current = null;
        setListening(false);
        if (owner === id) owner = 0;
        finish(full());
      }, STOP_TIMEOUT_MS);
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {
        finish(full());
      }
    });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Listen in the other language from now on (and next time). Mid-note, the
   * words so far are kept and listening carries on in the new language.
   */
  const switchLanguage = useCallback(() => {
    const next: SpeechLang = lang.current === 'bn-BD' ? 'en-US' : 'bn-BD';
    lang.current = next;
    setLanguage(next);
    setProblem(null);
    setPreferences({ speechLang: next });
    if (!mine() || !wanted.current || stopWaiter.current) return;
    keepInterim();
    setText(full());
    restarts.current = 0;
    if (stalled.current) {
      // That session already ended: start one in the new language.
      stalled.current = false;
      try {
        begin();
      } catch {
        // Done still finishes with what was heard.
      }
      return;
    }
    try {
      // Ends this session; 'end' starts the next one in the new language.
      ExpoSpeechRecognitionModule.abort();
    } catch {
      begin();
    }
  }, [begin]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Stops and throws away whatever was heard. */
  const cancel = useCallback(() => {
    wanted.current = false;
    stopWaiter.current = null;
    finalText.current = '';
    interim.current = '';
    setText('');
    setListening(false);
    if (mine()) {
      owner = 0;
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        // Already stopped.
      }
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving the screen mid-recording discards it (the person agreed a lost
  // recording is fine; a recognizer left running is not).
  useEffect(() => () => {
    if (owner === id) {
      wanted.current = false;
      owner = 0;
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        // Already stopped.
      }
    }
  }, [id]);

  return { listening, text, language, problem, start, stop, cancel, switchLanguage };
}
