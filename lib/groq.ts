import { Platform } from 'react-native';
import { getActiveGroqApiKey } from './api-key';

// Groq free tier: Whisper Large v3 Turbo, multilingual (99 languages),
// ~2,000 transcription requests/day. Used as the backup ear when
// Gemini audio understanding is rate-limited or down.
const TRANSCRIPTION_MODEL = 'whisper-large-v3-turbo';
const TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

/** Transcribe a local audio file. Detects the spoken language automatically. */
export async function transcribeAudio(fileUri: string, mimeType = 'audio/m4a'): Promise<string> {
  const apiKey = getActiveGroqApiKey();
  if (!apiKey) throw new Error('Groq API key not configured');

  const form = new FormData();
  form.append('model', TRANSCRIPTION_MODEL);
  if (Platform.OS === 'web') {
    const blob = await (await fetch(fileUri)).blob();
    form.append('file', blob, 'recording.m4a');
  } else {
    form.append('file', { uri: fileUri, name: 'recording.m4a', type: mimeType } as any);
  }

  const res = await fetch(TRANSCRIPTION_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Groq transcription failed (${res.status})`);
  }

  const data = await res.json();
  const text = typeof data.text === 'string' ? data.text.trim() : '';
  if (!text) throw new Error('Groq returned an empty transcript');
  return text;
}
