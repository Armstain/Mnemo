import { useCallback, useEffect, useRef, useState } from 'react';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

import { getPreferences, setPreferences, type SpeechLang } from '@/lib/preferences';
import { languageOf } from '@/lib/language';

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

// Bangla and English, recognized together. There's no setting for this:
// Android switches between them mid-sentence, and whichever language a
// note comes out in is the first guess next time.
const LANGUAGES: SpeechLang[] = ['bn-BD', 'en-US'];

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
  const lang = useRef<SpeechLang>('en-US');
  const stopWaiter = useRef<((text: string) => void) | null>(null);
  const onLevel = useRef(options.onLevel);
  onLevel.current = options.onLevel;

  const mine = () => owner === id;
  const full = () => [finalText.current, interim.current].filter(Boolean).join(' ').trim();

  const begin = useCallback(() => {
    ExpoSpeechRecognitionModule.start({
      lang: lang.current,
      // Let Android hear both languages and switch between them as you
      // speak (newer Google recognizers; older ones keep to `lang`).
      androidIntentOptions: {
        EXTRA_ENABLE_LANGUAGE_DETECTION: true,
        EXTRA_LANGUAGE_DETECTION_ALLOWED_LANGUAGES: LANGUAGES,
        EXTRA_ENABLE_LANGUAGE_SWITCH: 'balanced',
        EXTRA_LANGUAGE_SWITCH_ALLOWED_LANGUAGES: LANGUAGES,
      },
      interimResults: true,
      continuous: true,
      addsPunctuation: true,
      // Prefer the on-device model where one is installed; otherwise the
      // phone's recognizer decides (it may use its own online service).
      requiresOnDeviceRecognition: false,
    });
  }, []);

  useSpeechRecognitionEvent('result', (event) => {
    if (!mine()) return;
    const said = event.results[0]?.transcript?.trim() ?? '';
    if (event.isFinal) {
      if (said) finalText.current = [finalText.current, said].filter(Boolean).join(' ');
      interim.current = '';
    } else {
      interim.current = said;
    }
    setText(full());
  });

  // The recognizer telling us which language it's hearing: start there next time.
  useSpeechRecognitionEvent('languagedetection', (event) => {
    if (!mine()) return;
    const heard = LANGUAGES.find((l) => event.detectedLanguage?.toLowerCase().startsWith(l.slice(0, 2)));
    if (heard && event.confidence >= 0.6) lang.current = heard;
  });

  useSpeechRecognitionEvent('volumechange', (event) => {
    if (mine()) onLevel.current?.(normaliseLevel(event.value));
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (!mine()) return;
    // A pause with nothing said ends the session on some phones; keep going
    // while the person is still holding.
    if (event.error === 'no-speech' && wanted.current && !stopWaiter.current) return;
  });

  useSpeechRecognitionEvent('end', () => {
    if (!mine()) return;
    if (wanted.current && !stopWaiter.current) {
      // Older Android stops after a silence even in continuous mode: pick up
      // again so a pause doesn't end the note.
      try {
        begin();
        return;
      } catch {
        // Fall through and finish with what we have.
      }
    }
    // Words still showing as "interim" count: they were said.
    const words = full();
    // Remember the language this note came out in, as the first guess next time.
    const learned = languageOf(words) ?? lang.current;
    if (learned !== getPreferences().speechLang) setPreferences({ speechLang: learned });
    finalText.current = words;
    interim.current = '';
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
      lang.current = getPreferences().speechLang;
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

  return { listening, text, start, stop, cancel };
}
