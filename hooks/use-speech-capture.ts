import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

import { aiEnabled } from '@/lib/ai-mode';
import { heardLanguage, languageOf } from '@/lib/language';
import { getPreferences, setPreferences, type SpeechLang } from '@/lib/preferences';
import { deleteAudio, keepRecording } from '@/lib/voice-audio';
import { noteVoice, seconds, wordCount } from '@/lib/voice-log';

// Gemini on: record, transcribe afterwards (Whisper fallback; lib/capture), then delete the audio. Offline: live recognition, nothing recorded.

export type ListenStart = 'ok' | 'permission-denied' | 'unavailable';

/** What a voice note gave: words (offline), or a recording (Gemini on). */
export interface Heard {
  words: string;
  audio: string[];
}

// Recognition events are global and several screens listen; only the starter handles them.
let owner = 0;
let nextId = 1;

const STOP_TIMEOUT_MS = 2500;

// Consecutive failed sessions (a real error, not silence) mean the recognizer is failing, not pausing.
const MAX_RESTARTS = 4;
// Silence ends a session on most phones (every few seconds of thinking). That's a pause, not a
// failure, so it restarts without counting against MAX_RESTARTS, up to this many in one note.
const MAX_SILENT_RESTARTS = 120;
// The recognizer's codes for "heard nothing": a pause in talking.
const SILENCE = new Set(['no-speech', 'speech-timeout']);
// Restarting the instant a session failed often fails again as "busy" or "client".
const RETRY_DELAY_MS = 300;
// A recording much shorter than the time spent talking was cut off (a call, another app taking the mic).
const CUT_SHORT = 0.7;

const DETECT_CONFIDENCE = 0.8;

const MIN_RECORDING_MS = 600;

const RECORDER_OPTIONS = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true };
const LEVEL_MS = 80;

const LANGUAGES: SpeechLang[] = ['bn-BD', 'en-US'];
const other = (l: SpeechLang): SpeechLang => (l === 'bn-BD' ? 'en-US' : 'bn-BD');
// Detection needs Android 14; an unknown intent extra stops listening from starting.
const CAN_DETECT = Platform.OS === 'android' && Number(Platform.Version) >= 34;

/** volumechange reports roughly -2 (silence) to 10 (loud). */
const recognizerLevel = (db: number) => Math.max(0, Math.min(1, (db + 2) / 12));
/** Recorder metering is dBFS: about -60 is quiet, 0 is as loud as it goes. */
const recorderLevel = (db: number) => Math.max(0, Math.min(1, (db + 60) / 60));

/** Voice capture: start() asks for the mic the first time, stop() resolves `{ words, audio }`, cancel() discards. */
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
  const silentRestarts = useRef(0);
  /** This session's error code, if it ended with one. */
  const sessionError = useRef<string | null>(null);
  /** Every recognizer error in this note, counted, for the voice log. */
  const errorsSeen = useRef(new Map<string, number>());
  const startedAt = useRef(0);
  const firstLang = useRef<SpeechLang>('en-US');
  /** Listening stopped for good while the screen still says it's listening. */
  const [stalled, setStalled] = useState(false);
  const stopWaiter = useRef<((words: string) => void) | null>(null);
  const onLevel = useRef(options.onLevel);
  onLevel.current = options.onLevel;

  const mine = () => owner === id;
  const full = () => [finalText.current, interim.current].filter(Boolean).join(' ').trim();
  // Interim words at session end were said; keep them or a restart drops them.
  const keepInterim = () => {
    finalText.current = full();
    interim.current = '';
  };

  const stopLevels = () => {
    if (levelTimer.current) clearInterval(levelTimer.current);
    levelTimer.current = null;
  };

  /** Stops the recorder; the file, or null if there's nothing worth keeping. */
  const endRecording = useCallback(async (keep: boolean): Promise<string | null> => {
    stopLevels();
    const talked = Date.now() - recordingSince.current;
    const long = talked >= MIN_RECORDING_MS;
    let recorded = 0;
    let wasRecording = true;
    try {
      const status = recorder.getStatus();
      recorded = status.durationMillis ?? 0;
      wasRecording = status.isRecording;
    } catch {
      // No status: the log just says less.
    }
    try {
      await recorder.stop();
    } catch {
      // Already stopped.
    }
    const uri = recorder.uri;
    const what = `recorded ${seconds(talked)}`;
    if (!uri) {
      if (keep) void noteVoice(`${what}: no recording file came back`);
      return null;
    }
    if (!keep || !long) {
      if (keep) void noteVoice(`${what}: too short, dropped`);
      deleteAudio([uri]);
      return null;
    }
    // Android stops a recording when another app takes the mic, or a call comes in.
    const cut = recorded > 0 && recorded < talked * CUT_SHORT;
    const kept = keepRecording(uri);
    void noteVoice(
      `${what}, file ${seconds(recorded)}${cut || !wasRecording ? ' (CUT SHORT: the phone stopped the recording)' : ''}` +
        `${kept === uri ? ' · stays in cache (move failed)' : ''}`,
    );
    return kept;
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

  const begin = useCallback(() => {
    sessionError.current = null;
    tried.current.add(lang.current);
    ExpoSpeechRecognitionModule.start({
      lang: lang.current,
      interimResults: true,
      continuous: true,
      // Punctuation is English-only; in Bangla it can end the session as "language not supported".
      addsPunctuation: lang.current === 'en-US',
      requiresOnDeviceRecognition: false,
      androidIntentOptions: {
        // No EXTRA_ENABLE_LANGUAGE_SWITCH: mid-sentence model switching wrote Bangla as Hindi and dropped words.
        ...(CAN_DETECT
          ? { EXTRA_ENABLE_LANGUAGE_DETECTION: true, EXTRA_LANGUAGE_DETECTION_ALLOWED_LANGUAGES: LANGUAGES }
          : {}),
        // The library forces offline-only when streaming (Android 13+); offline Bangla is often missing.
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
    sessionError.current = event.error;
    errorsSeen.current.set(event.error, (errorsSeen.current.get(event.error) ?? 0) + 1);
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
    // Silence ends the session on some phones; 'end' restarts it.
  });

  /** One line per note: how long, what language, how much was heard, and what went wrong. */
  const logRecognized = (words: string, how: string) => {
    const errors = [...errorsSeen.current].filter(([code]) => code !== 'aborted').map(([code, n]) => (n > 1 ? `${code}×${n}` : code));
    const langs = firstLang.current === lang.current ? lang.current : `${firstLang.current}→${lang.current}`;
    void noteVoice(
      `phone heard (${langs}), ${seconds(Date.now() - startedAt.current)}, ${wordCount(words)} words, ${how}` +
        `${silentRestarts.current ? `, ${silentRestarts.current} pauses` : ''}${errors.length ? `, errors: ${errors.join(', ')}` : ''}`,
    );
  };

  const finishRecognizing = () => {
    const words = full();
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
    if (wanted.current && !stopWaiter.current) {
      // Most phones end a session after a few seconds of silence, even in continuous mode; a
      // language change also ends it on purpose. Only a real error counts towards giving up.
      const error = sessionError.current;
      const pause = !error || SILENCE.has(error) || error === 'aborted';
      const again = pause ? silentRestarts.current < MAX_SILENT_RESTARTS : restarts.current < MAX_RESTARTS;
      if (again) {
        if (pause) silentRestarts.current += 1;
        else restarts.current += 1;
        const restart = () => {
          if (!wanted.current || stopWaiter.current || !mine()) return;
          try {
            begin();
          } catch {
            setStalled(true);
          }
        };
        if (pause) restart();
        else setTimeout(restart, RETRY_DELAY_MS);
        return;
      }
      // Gave up while the person is still talking: say so instead of showing "Listening…".
      setStalled(true);
      keepInterim();
      logRecognized(full(), `stopped hearing (screen still open)`);
      return;
    }
    const resolve = stopWaiter.current;
    stopWaiter.current = null;
    const words = finishRecognizing();
    if (resolve) logRecognized(words, 'Done tapped');
    resolve?.(words);
  });

  const start = useCallback(async (): Promise<ListenStart> => {
    finalText.current = '';
    interim.current = '';
    setText('');
    setStalled(false);
    startedAt.current = Date.now();
    silentRestarts.current = 0;
    errorsSeen.current = new Map();
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
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        void noteVoice("couldn't start: this phone has no speech recognition");
        return 'unavailable';
      }
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) return 'permission-denied';
      owner = id;
      wanted.current = true;
      restarts.current = 0;
      detected.current = null;
      tried.current = new Set();
      lang.current = getPreferences().speechLang;
      firstLang.current = lang.current;
      setListening(true);
      begin();
      return 'ok';
    } catch (e) {
      wanted.current = false;
      setListening(false);
      setRecording(false);
      void noteVoice(`couldn't start ${engine.current === 'record' ? 'recording' : 'listening'}: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
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
    // Stopped hearing earlier (stalled), or never ours: what was heard is all there is.
    if (!mine() || stalled) {
      const words = mine() ? finishRecognizing() : full();
      setStalled(false);
      return { words, audio: [] };
    }
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
        const words = finishRecognizing();
        logRecognized(words, `Done tapped, recognizer didn't finish in ${seconds(STOP_TIMEOUT_MS)}`);
        settle(words);
      }, STOP_TIMEOUT_MS);
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {
        stopWaiter.current = null;
        settle(finishRecognizing());
      }
    });
    return { words, audio: [] };
  }, [endRecording, id, stalled]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setStalled(false);
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

  // Leaving mid-note discards it: a lost recording is fine, a live mic is not.
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useEffect(() => () => cancelRef.current(), []);

  return { listening, recording, text, stalled, start, stop, cancel };
}
