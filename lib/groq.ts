import { Platform } from 'react-native';

import { getActiveGroqApiKey } from '@/lib/api-key';
import { looksLikeHindi } from '@/lib/language';
import type { Audio } from '@/lib/voice-audio';

// Groq's free tier runs Whisper large-v3 turbo (99 languages, Bangla among
// them). It writes out a voice note when Gemini can't: down, out of quota,
// or refusing the recording. Optional: only with the person's own key.
const MODEL = 'whisper-large-v3-turbo';
const URL_ = 'https://api.groq.com/openai/v1/audio/transcriptions';
/** Longest one recording may take to write out, upload included. */
const TIMEOUT_MS = 60_000;

export function hasGroq(): boolean {
  return getActiveGroqApiKey().length > 0;
}

async function once(audio: Audio, language?: string): Promise<string> {
  const form = new FormData();
  form.append('model', MODEL);
  form.append('response_format', 'json');
  if (language) form.append('language', language);
  if (Platform.OS === 'web') {
    form.append('file', await (await fetch(audio.uri)).blob(), audio.name);
  } else {
    // React Native's FormData sends a local file from its uri.
    form.append('file', { uri: audio.uri, name: audio.name, type: audio.mimeType } as unknown as Blob);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(URL_, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getActiveGroqApiKey()}` },
      body: form,
      signal: controller.signal,
    });
  } catch (e) {
    throw controller.signal.aborted ? new Error(`Groq timed out after ${TIMEOUT_MS / 1000}s`) : e;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    // Groq says why (a bad key, its own rate limit, a file it won't take):
    // keep that, for the problem report.
    const why = await res.text().catch(() => '');
    throw new Error(`Groq transcription failed (${res.status}) ${why.slice(0, 200)}`.trim());
  }
  const data = await res.json();
  return typeof data.text === 'string' ? data.text.trim() : '';
}

/** Writes out recordings in order, as one note. '' when nothing was said. */
export async function transcribeAudio(audio: Audio[]): Promise<string> {
  if (!hasGroq()) throw new Error('No Groq key');
  const parts: string[] = [];
  for (const a of audio) {
    let text = await once(a);
    // Whisper guesses the language from the first seconds and sometimes
    // takes Bangla for Hindi: asked again, as Bangla.
    if (looksLikeHindi(text)) text = await once(a, 'bn');
    if (text) parts.push(text);
  }
  return parts.join(' ').trim();
}
