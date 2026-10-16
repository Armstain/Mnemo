import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

import { aiEnabled } from '@/lib/ai-mode';
import { heardLanguage, languageOf } from '@/lib/language';
import { getPreferences, setPreferences, type SpeechLang } from '@/lib/preferences';
import { deleteAudio, keepRecording } from '@/lib/voice-audio';

// Two ways to take a voice note:
//
// - With Gemini on, it's recorded, and Gemini writes it out afterwards
//   (Groq's Whisper if Gemini can't; lib/capture). Whole recordings come out
//   far better than live recognition, in Bangla, English or both mixed. The
//   recording is deleted once it's written out (lib/voice-audio).
// - Offline, the phone's own speech recognition writes it out as you talk.
//   Nothing is recorded.

export type ListenStart = 'ok' | 'permission-denied' | 'unavailable';

/** What a voice note gave: words (offline), or a recording (Gemini on). */
export interface Heard {
  words: string;
  audio: string[];
}

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

// How sure Android's language detector must be before we act on it.
const DETECT_CONFIDENCE = 0.8;

// Shorter than this is a slip of the finger, not a note.
const MIN_RECORDING_MS = 600;

const RECORDER_OPTIONS = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true };
const LEVEL_MS = 80;

const LANGUAGES: SpeechLang[] = ['bn-BD', 'en-US'];
const other = (l: SpeechLang): SpeechLang => (l === 'bn-BD' ? 'en-US' : 'bn-BD');
// Language detection came in Android 14. The library looks each extra up by
// name, and an unknown one stops listening from starting at all.
const CAN_DETECT = Platform.OS === 'android' && Number(Platform.Version) >= 34;

/** volumechange reports roughly -2 (silence) to 10 (loud). */
const recognizerLevel = (db: number) => Math.max(0, Math.min(1, (db + 2) / 12));
/** Recorder metering is dBFS: about -60 is quiet, 0 is as loud as it goes. */
const recorderLevel = (db: number) => Math.max(0, Math.min(1, (db + 60) / 60));

/**
 * Voice capture.
 *
 *   const speech = useSpeechCapture({ onLevel });
 *   await speech.start();                   // asks for the microphone the first time
 *   speech.text                             // offline: the words so far
 *   const { words, audio } = await speech.stop();
 *   speech.cancel();                        // throw it away
 */
export function useSpeechCapture(options: { onLevel?: (level: number) => void } = {}) {
  const id = useRef(nextId++).current;
  const recorder = useAudioRecorder(RECORDER_OPTIONS);
  const [listening, setListening] = useState(false);
  const [text, setText] = useState('');
  /** This note is being recorded for Gemini (not written out live). */
  const [recording, setRecording] = useState(false);

  const engine = useRef<'record' | 'recognize'>('recognize');
  const recordingSince = useRef(0);
  const levelTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioReady = useRef(false);

  const finalText = useRef('');
  const interim = useRef('');
  const wanted = useRef(false); // still holding / still listening
  const lang = useRef<SpeechLang>('en-US');
  /** The language the detector was sure of in this note. */
  const detected = useRef<SpeechLang | null>(null);
  const tried = useRef(new Set<SpeechLang>());
  const restarts = useRef(0);
  const stopWaiter = useRef<((words: string) => void) | null>(null);
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

  // ─── Recording (Gemini on) ───────────────────────────────────

  const stopLevels = () => {
    if (levelTimer.current) clearInterval(levelTimer.current);
    levelTimer.current = null;
  };

  /** Stops the recorder; the file, or null if there's nothing worth keeping. */
  const endRecording = useCallback(async (keep: boolean): Promise<string | null> => {
    stopLevels();
    const long = Date.now() - recordingSince.current >= MIN_RECORDING_MS;
    try {
      await recorder.stop();
    } catch {
      // Already stopped.
    }
    const uri = recorder.uri;
    if (!uri) return null;
    if (!keep || !long) {
      deleteAudio([uri]);
      return null;
    }
    return keepRecording(uri);
  }, [recorder]);

  const startRecording = useCallback(async (): Promise<ListenStart> => {
    if (!audioReady.current) {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) return 'permission-denied';
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      audioReady.current = true;
    }
    await recorder.prepareToRecordAsync();
    recorder.record();
    recordingSince.current = Date.now();
    stopLevels();
    levelTimer.current = setInterval(() => {
      try {
        const db = recorder.getStatus().metering;
        if (typeof db === 'number') onLevel.current?.(recorderLevel(db));
      } catch {
        // Not recording any more.
      }
    }, LEVEL_MS);
    return 'ok';
  }, [recorder]);

  // ─── Live recognition (offline) ──────────────────────────────

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
    if (heard !== lang.current && !tried.current.has(heard)) moveTo(heard);
  });

  useSpeechRecognitionEvent('volumechange', (event) => {
    if (mine()) onLevel.current?.(recognizerLevel(event.value));
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

  const finishRecognizing = () => {
    const words = full();
    // Next note starts in the language this one was in.
    const learned = detected.current ?? languageOf(words) ?? lang.current;
    if (learned !== getPreferences().speechLang) setPreferences({ speechLang: learned });
    finalText.current = words;
    interim.current = '';
    setListening(false);
    if (owner === id) owner = 0;
    return words;
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
    const words = finishRecognizing();
    resolve?.(words);
  });

  // ─── Both ────────────────────────────────────────────────────

  const start = useCallback(async (): Promise<ListenStart> => {
    finalText.current = '';
    interim.current = '';
    setText('');
    try {
      if (aiEnabled()) {
        engine.current = 'record';
        const result = await startRecording();
        if (result !== 'ok') return result;
        wanted.current = true;
        setRecording(true);
        setListening(true);
        return 'ok';
      }
      engine.current = 'recognize';
      setRecording(false);
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) return 'unavailable';
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) return 'permission-denied';
      owner = id;
      wanted.current = true;
      restarts.current = 0;
      detected.current = null;
      tried.current = new Set();
      lang.current = getPreferences().speechLang;
      setListening(true);
      begin();
      return 'ok';
    } catch {
      wanted.current = false;
      setListening(false);
      return 'unavailable';
    }
  }, [begin, id, startRecording]);

  /** Stops and resolves with what was said: the words, or the recording. */
  const stop = useCallback(async (): Promise<Heard> => {
    const wasListening = wanted.current;
    wanted.current = false;
    if (engine.current === 'record') {
      setListening(false);
      setRecording(false);
      if (!wasListening) return { words: '', audio: [] };
      const uri = await endRecording(true);
      return { words: '', audio: uri ? [uri] : [] };
    }
    if (!mine()) return { words: full(), audio: [] };
    const words = await new Promise<string>((resolve) => {
      let done = false;
      const settle = (w: string) => {
        if (done) return;
        done = true;
        resolve(w);
      };
      stopWaiter.current = settle;
      setTimeout(() => {
        if (done) return;
        stopWaiter.current = null;
        settle(finishRecognizing());
      }, STOP_TIMEOUT_MS);
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {
        stopWaiter.current = null;
        settle(finishRecognizing());
      }
    });
    return { words, audio: [] };
  }, [endRecording, id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Stops and throws away whatever was heard or recorded. */
  const cancel = useCallback(() => {
    const wasListening = wanted.current;
    wanted.current = false;
    stopWaiter.current = null;
    finalText.current = '';
    interim.current = '';
    setText('');
    setListening(false);
    setRecording(false);
    if (engine.current === 'record') {
      if (wasListening) void endRecording(false);
      return;
    }
    if (mine()) {
      owner = 0;
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        // Already stopped.
      }
    }
  }, [endRecording, id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving the screen mid-note discards it (the person agreed a lost
  // recording is fine; a microphone left on is not).
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useEffect(() => () => cancelRef.current(), []);

  return { listening, recording, text, start, stop, cancel };
}
