import { getActiveGroqApiKey } from '@/lib/api-key';
import { looksLikeHindi } from '@/lib/language';
import { base64ToBytes } from '@/lib/pcm';
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

/**
 * The upload, built by hand from the recording's bytes (already read for
 * Gemini). FormData can't be trusted here: Expo's fetch, which the app
 * runs on, rejects React Native's `{ uri, name, type }` file parts
 * ("Unsupported FormDataPart implementation"), so no recording ever
 * reached Groq.
 */
export function multipartBody(
  fields: Record<string, string>,
  file: { name: string; mimeType: string; data: string },
  boundary = `----mnemo${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`,
): { body: Uint8Array; contentType: string } {
  const encoder = new TextEncoder();
  const head =
    Object.entries(fields)
      .map(([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
      .join('') +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name.replace(/["\r\n]/g, '_')}"\r\n` +
    `Content-Type: ${file.mimeType}\r\n\r\n`;
  const parts = [encoder.encode(head), base64ToBytes(file.data), encoder.encode(`\r\n--${boundary}--\r\n`)];
  const body = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    body.set(p, at);
    at += p.length;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function once(audio: Audio, language?: string): Promise<string> {
  const { body, contentType } = multipartBody(
    { model: MODEL, response_format: 'json', ...(language ? { language } : {}) },
    audio,
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(URL_, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getActiveGroqApiKey()}`, 'Content-Type': contentType },
      // Sized to the body exactly, so its buffer is the whole upload.
      body: body.buffer as ArrayBuffer,
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

/**
 * Writes out recordings in order, as one note. '' when nothing was said.
 * `banglaSpeaker`: the person listens in Bangla, so Devanagari coming back
 * is Bangla misheard as Hindi. For anyone else it may be real Hindi, which
 * is left as written.
 */
export async function transcribeAudio(audio: Audio[], { banglaSpeaker = false } = {}): Promise<string> {
  if (!hasGroq()) throw new Error('No Groq key');
  const parts: string[] = [];
  for (const a of audio) {
    let text = await once(a);
    // Whisper guesses the language from the first seconds and sometimes
    // takes Bangla for Hindi: asked again, as Bangla, for a Bangla speaker.
    if (banglaSpeaker && looksLikeHindi(text)) text = await once(a, 'bn');
    if (text) parts.push(text);
  }
  return parts.join(' ').trim();
}
