import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { GoogleGenAI } from '@google/genai';
import { emptyKindOf } from '@/lib/empty-response';
import { nextDailyReset, OVERLOADED_PATTERN, quotaInfo } from '@/lib/model-pick';

const GEMINI_KEY_STORAGE = 'mnemo_user_gemini_api_key';
const GROQ_KEY_STORAGE = 'mnemo_user_groq_api_key';

let cachedGeminiApiKey: string | null = null;
let cachedGroqApiKey: string | null = null;

export async function loadStoredApiKeys(): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') {
        cachedGeminiApiKey = localStorage.getItem(GEMINI_KEY_STORAGE);
        cachedGroqApiKey = localStorage.getItem(GROQ_KEY_STORAGE);
      }
    } else {
      cachedGeminiApiKey = await SecureStore.getItemAsync(GEMINI_KEY_STORAGE);
      cachedGroqApiKey = await SecureStore.getItemAsync(GROQ_KEY_STORAGE);
    }
  } catch (e) {
    console.error('Failed to load stored API keys:', e);
  }
}

// ─── Gemini ───

/** No built-in fallback key on purpose: a bundled key can be extracted from the app. */
export function getActiveApiKey(): string {
  return cachedGeminiApiKey?.trim() ?? '';
}

const keyListeners = new Set<() => void>();

export function onApiKeyChanged(listener: () => void): () => void {
  keyListeners.add(listener);
  return () => keyListeners.delete(listener);
}

export async function saveApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  const changed = (cachedGeminiApiKey ?? '') !== trimmed;
  cachedGeminiApiKey = trimmed || null;
  if (changed) keyListeners.forEach((l) => l());
  try {
    if (!trimmed) {
      if (Platform.OS === 'web') {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(GEMINI_KEY_STORAGE);
      } else {
        await SecureStore.deleteItemAsync(GEMINI_KEY_STORAGE);
      }
    } else {
      if (Platform.OS === 'web') {
        if (typeof localStorage !== 'undefined') localStorage.setItem(GEMINI_KEY_STORAGE, trimmed);
      } else {
        await SecureStore.setItemAsync(GEMINI_KEY_STORAGE, trimmed);
      }
    }
  } catch (e) {
    console.error('Failed to save Gemini API key:', e);
    throw e;
  }
}

export type KeyProblem = 'invalid' | 'quota' | 'offline' | 'busy' | 'blocked' | 'truncated' | 'empty' | 'other';

export function classifyAiError(err: unknown): KeyProblem {
  const msg = String((err as { message?: string })?.message ?? err);
  // Must run first: the text has counts ("transcript 401 chars") that look like status codes.
  const empty = emptyKindOf(msg);
  if (empty) return empty === 'blocked' ? 'blocked' : empty === 'truncated' ? 'truncated' : empty === 'unreadable' ? 'other' : 'empty';
  if (/API_KEY_INVALID|API key not valid|PERMISSION_DENIED|\b(401|403)\b/i.test(msg)) return 'invalid';
  if (/RESOURCE_EXHAUSTED|quota|rate limit|\b429\b/i.test(msg)) return 'quota';
  if (OVERLOADED_PATTERN.test(msg)) return 'busy';
  if (/Network request failed|Failed to fetch|NetworkError|ENOTFOUND|timed? ?out|offline/i.test(msg)) return 'offline';
  return 'other';
}

/** Google resets the daily quota at midnight Pacific; shown in local time. */
export function dailyResetText(now = Date.now()): string {
  const time = new Date(nextDailyReset(now)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `It resets at ${time} your time.`;
}

function waitText(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 90) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.ceil(s / 60);
  return `${m} minutes`;
}

export function aiErrorText(err: unknown): string {
  const problem = classifyAiError(err);
  if (problem !== 'quota') return KEY_PROBLEM_TEXT[problem];
  const info = quotaInfo(err);
  if (info?.daily) return `Gemini's free daily limit is used up. ${dailyResetText()} Notes are saved and will be tidied up later.`;
  const retry = info?.retryMs ? `Try again in ${waitText(info.retryMs)}.` : 'Try again in a minute.';
  return `Gemini is getting too many requests this minute. ${retry} Notes are saved and will be tidied up later.`;
}

const RETRIED_BY_ITSELF: KeyProblem[] = ['offline', 'quota', 'busy'];

export function retryProblemText(err: unknown): { title: string; message: string } {
  const problem = classifyAiError(err);
  const title = problem === 'offline' ? 'Still offline?' : 'Gemini had a problem';
  if (problem === 'blocked') {
    return {
      title,
      message:
        "Gemini's safety filter declined to process this note. It's saved as you wrote it. It won't be tried again until you edit it or tap Retry.",
    };
  }
  const text = aiErrorText(err);
  return { title, message: RETRIED_BY_ITSELF.includes(problem) ? `${text} It's tried again by itself.` : text };
}

/** Request never left the phone. A timeout is not this: the call may have reached Gemini. */
export function isNoConnection(err: unknown): boolean {
  return /Network request failed|Failed to fetch|NetworkError|ENOTFOUND/i.test(String((err as { message?: string })?.message ?? err));
}

export const KEY_PROBLEM_TEXT: Record<KeyProblem, string> = {
  invalid: "Gemini didn't accept this key. Check you copied all of it.",
  quota: "This key's free limit is used up. Notes are saved and will be tidied up later.",
  offline: "Couldn't reach Gemini. Check your connection; notes are saved either way.",
  busy: 'Gemini is busy right now. Notes are saved and will be tidied up later.',
  blocked: "Gemini's safety filter declined to process this note. It's saved as you wrote it.",
  truncated: "Gemini's answer for this note was cut off. It's saved as you wrote it.",
  empty: 'Gemini sent back nothing for this note (it may have had nothing to process). It\'s saved as you wrote it.',
  other: 'Gemini returned an error. Notes are saved either way.',
};

/** Lists models: uses no generation quota. */
export async function validateApiKey(keyToTest?: string): Promise<{ valid: boolean; error?: string; problem?: KeyProblem }> {
  const key = keyToTest !== undefined ? keyToTest.trim() : getActiveApiKey();
  if (!key) return { valid: false, error: 'Paste your Gemini key first.', problem: 'invalid' };
  try {
    const client = new GoogleGenAI({ apiKey: key });
    await client.models.list({ config: { pageSize: 1 } });
    return { valid: true };
  } catch (err) {
    const problem = classifyAiError(err);
    return { valid: false, error: aiErrorText(err), problem };
  }
}

// ─── Groq (backup voice transcription) ───

export function getActiveGroqApiKey(): string {
  return cachedGroqApiKey?.trim() ?? '';
}

export async function saveGroqApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  cachedGroqApiKey = trimmed || null;
  try {
    if (Platform.OS === 'web') {
      if (typeof localStorage === 'undefined') return;
      if (trimmed) localStorage.setItem(GROQ_KEY_STORAGE, trimmed);
      else localStorage.removeItem(GROQ_KEY_STORAGE);
    } else if (trimmed) {
      await SecureStore.setItemAsync(GROQ_KEY_STORAGE, trimmed);
    } else {
      await SecureStore.deleteItemAsync(GROQ_KEY_STORAGE);
    }
  } catch (e) {
    console.error('Failed to save Groq API key:', e);
    throw e;
  }
}

export async function validateGroqApiKey(keyToTest?: string): Promise<{ valid: boolean; error?: string }> {
  const key = keyToTest !== undefined ? keyToTest.trim() : getActiveGroqApiKey();
  if (!key) return { valid: false, error: 'Paste your Groq key first.' };
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${key}` } });
    if (res.ok) return { valid: true };
    if (res.status === 401) return { valid: false, error: "Groq didn't accept this key. Check you copied all of it." };
    return { valid: false, error: `Groq returned an error (${res.status}).` };
  } catch {
    return { valid: false, error: "Couldn't reach Groq. Check your connection." };
  }
}
