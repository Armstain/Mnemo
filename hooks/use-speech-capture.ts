import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

import { aiEnabled } from '@/lib/ai-mode';
import { heardLanguage, languageOf } from '@/lib/language';
import { getPreferences, setPreferences, type SpeechLang } from '@/lib/preferences';
import { deleteAudio } from '@/lib/voice-audio';

// Voice notes are written out by the phone's own speech recognition while
// the person talks: those live words are the note offline. With Gemini on,
// the sound is also held until Gemini writes it out properly (it hears
// Bangla, English and both mixed), then deleted (lib/voice-audio).

export type ListenStart = 'ok' | 'permission-denied' | 'unavailable';

/** What a recording gave: the live words, and the sound for Gemini, if held. */
export interface Heard {
  words: string;
  audio: string[];
}

// Recognition events are global, but several screens can listen (the
// capture button stays mounted under the Record screen). Only the screen
// that started this session handles its events.
let owner = 0;
// Who gets the sound files: the last screen to start (files arrive after
// a cancel too, and must still be deleted, once).
let audioOwner = 0;
let nextId = 1;

// How long to wait for the recognizer to hand back its last words after
// stop() before giving up and using what we have.
const STOP_TIMEOUT_MS = 2500;

// After this many restarts in a row with nothing heard, stop trying: the
// recognizer is failing, not pausing.
const MAX_RESTARTS = 4;

// How sure Android's language detector must be before we act on it.
const DETECT_CONFIDENCE = 0.8;

const LANGUAGES: SpeechLang[] = ['bn-BD', 'en-US'];
// Language detection came in Android 14. The library looks each extra up by
// name, and an unknown one stops listening from starting at all.
const CAN_DETECT = Platform.OS === 'android' && Number(Platform.Version) >= 34;
const other = (l: SpeechLang): SpeechLang => (l === 'bn-BD' ? 'en-US' : 'bn-BD');

function normaliseLevel(db: number): number {
  // volumechange reports roughly -2 (silence) to 10 (loud).
  return Math.max(0, Math.min(1, (db + 2) / 12));
}

/**
 * Live speech-to-text.
 *
 *   const speech = useSpeechCapture({ onLevel });
 *   await speech.start();                   // asks for permission the first time
 *   speech.text                             // what's been heard so far, updating live
 *   const { words, audio } = await speech.stop();
 *   speech.cancel();                        // throw it away
 *
 * The language is picked for the person: it starts in the one their last
 * note was in, and Android's detector moves it if they're speaking the
 * other. Android only *detects*; it never switches models itself (that
 * wrote Bangla out as Hindi).
 */
export function useSpeechCapture(options: { onLevel?: (level: number) => void } = {}) {
  const id = useRef(nextId++).current;
  const [listening, setListening] = useState(false);
  const [text, setText] = useState('');

  const finalText = useRef('');
  const interim = useRef('');
  const wanted = useRef(false); // still holding / still recording
  const lang = useRef<SpeechLang>('en-US');
  /** The language the detector was sure of in this note. */
  const detected = useRef<SpeechLang | null>(null);
  const tried = useRef(new Set<SpeechLang>());
  const restarts = useRef(0);
  /** Holding the sound for Gemini this time. */
  const holdAudio = useRef(false);
  const audio = useRef<string[]>([]);
  /** Sound files for this note are wanted (false once it's saved or thrown away). */
  const collecting = useRef(false);
  const stopWaiter = useRef<((heard: Heard) => void) | null>(null);
  const onLevel = useRef(options.onLevel);
  onLevel.current = options.onLevel;

  const mine = () => owner === id;
  const full = () => [finalText.current, interim.current].filter(Boolean).join(' ').trim();
  // Words still showing as "interim" when a session ends were said: keep
  // them, or a restart (after a pause, or a language change) drops them.
  const keepInterim = () => {
    finalText.current = full();
    interim.current = '';
  };

  const begin = useCallback(() => {
    tried.current.add(lang.current);
    ExpoSpeechRecognitionModule.start({
      lang: lang.current,
      interimResults: true,
      continuous: true,
      // Android's punctuation (formatting) exists for English only; asking
      // for it in Bangla can end the session as "language not supported".
      addsPunctuation: lang.current === 'en-US',
      requiresOnDeviceRecognition: false,
      // A WAV in the app's cache, deleted once Gemini has written it out.
      recordingOptions: holdAudio.current ? { persist: true } : undefined,
      androidIntentOptions: {
        // Detect which of the two is being spoken (see 'languagedetection').
        // No EXTRA_ENABLE_LANGUAGE_SWITCH: letting Android switch models
        // mid-sentence is what wrote Bangla out as Hindi and dropped words.
        ...(CAN_DETECT
          ? { EXTRA_ENABLE_LANGUAGE_DETECTION: true, EXTRA_LANGUAGE_DETECTION_ALLOWED_LANGUAGES: LANGUAGES }
          : {}),
        // expo-speech-recognition asks for offline-only recognition whenever
        // it streams the microphone (continuous, Android 13+). Offline Bangla
        // is often not installed and offline models miss more words, so let
        // the phone use its best recognizer.
        EXTRA_PREFER_OFFLINE: false,
      },
    });
  }, []);

  /** Carry on in another language: keeps what's been heard, restarts listening. */
  const moveTo = useCallback((next: SpeechLang) => {
    keepInterim();
    setText(full());
    lang.current = next;
    restarts.current = 0;
    try {
      // Ends this session; 'end' starts the next one in the new language.
      ExpoSpeechRecognitionModule.abort();
    } catch {
      begin();
    }
  }, [begin]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Speaking the other language than the one it's listening in: move over.
  useSpeechRecognitionEvent('languagedetection', (event) => {
    if (!mine() || !wanted.current || stopWaiter.current) return;
    const heard = heardLanguage(event.detectedLanguage);
    if (!heard || event.confidence < DETECT_CONFIDENCE) return;
    detected.current = heard;
    // With Gemini on, its transcript is the note and a restart could cut a
    // word from the sound: the live words stay as they are, and the
    // language is remembered for next time.
    if (holdAudio.current || heard === lang.current || tried.current.has(heard)) return;
    moveTo(heard);
  });

  useSpeechRecognitionEvent('audioend', (event) => {
    if (audioOwner !== id || !event.uri) return;
    if (collecting.current) audio.current.push(event.uri);
    else deleteAudio([event.uri]);
  });

  useSpeechRecognitionEvent('volumechange', (event) => {
    if (mine()) onLevel.current?.(normaliseLevel(event.value));
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (!mine()) return;
    // The phone can't recognise this language: try the other one, once.
    if (event.error === 'language-not-supported' && wanted.current && !stopWaiter.current) {
      const next = other(lang.current);
      if (!tried.current.has(next)) {
        keepInterim();
        lang.current = next;
        restarts.current = 0;
      } else {
        restarts.current = MAX_RESTARTS; // neither works: finish with what's there
      }
    }
    // Otherwise a pause with nothing said ends the session on some phones;
    // the 'end' that follows starts listening again.
  });

  const finish = () => {
    const heard: Heard = { words: full(), audio: [...audio.current] };
    collecting.current = false;
    audio.current = [];
    // Next note starts in the language this one was in.
    const learned = detected.current ?? languageOf(heard.words) ?? lang.current;
    if (learned !== getPreferences().speechLang) setPreferences({ speechLang: learned });
    finalText.current = heard.words;
    interim.current = '';
    setListening(false);
    if (owner === id) owner = 0;
    return heard;
  };

  useSpeechRecognitionEvent('end', () => {
    if (!mine()) return;
    keepInterim();
    if (wanted.current && !stopWaiter.current && restarts.current < MAX_RESTARTS) {
      // Older Android stops after a silence even in continuous mode, and a
      // language change ends the session on purpose: pick up again so the
      // note goes on.
      restarts.current += 1;
      try {
        begin();
        return;
      } catch {
        // Fall through and finish with what we have.
      }
    }
    const resolve = stopWaiter.current;
    stopWaiter.current = null;
    const heard = finish();
    if (resolve) resolve(heard);
    else deleteAudio(heard.audio); // ended on its own with nobody to save it
  });

  const start = useCallback(async (): Promise<ListenStart> => {
    try {
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) return 'unavailable';
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) return 'permission-denied';
      owner = id;
      audioOwner = id;
      finalText.current = '';
      interim.current = '';
      wanted.current = true;
      restarts.current = 0;
      detected.current = null;
      tried.current = new Set();
      holdAudio.current = aiEnabled();
      audio.current = [];
      collecting.current = true;
      lang.current = getPreferences().speechLang;
      setText('');
      setListening(true);
      begin();
      return 'ok';
    } catch {
      wanted.current = false;
      collecting.current = false;
      setListening(false);
      return 'unavailable';
    }
  }, [begin, id]);

  /** Stops listening and resolves with everything that was said. */
  const stop = useCallback((): Promise<Heard> => {
    wanted.current = false;
    if (!mine()) return Promise.resolve({ words: full(), audio: [] });
    return new Promise<Heard>((resolve) => {
      let done = false;
      const settle = (heard: Heard) => {
        if (done) return;
        done = true;
        resolve(heard);
      };
      stopWaiter.current = settle;
      setTimeout(() => {
        if (done) return;
        stopWaiter.current = null;
        // Gave up waiting: the words are enough. Sound arriving later is deleted.
        const heard = finish();
        deleteAudio(heard.audio);
        settle({ words: heard.words, audio: [] });
      }, STOP_TIMEOUT_MS);
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {
        stopWaiter.current = null;
        settle(finish());
      }
    });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Stops and throws away whatever was heard. */
  const cancel = useCallback(() => {
    wanted.current = false;
    stopWaiter.current = null;
    finalText.current = '';
    interim.current = '';
    collecting.current = false;
    deleteAudio(audio.current);
    audio.current = [];
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
      collecting.current = false;
      deleteAudio(audio.current);
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
