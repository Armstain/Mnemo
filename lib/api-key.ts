import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { GoogleGenAI } from '@google/genai';

const GEMINI_KEY_STORAGE = 'mnemo_user_gemini_api_key';
const GROQ_KEY_STORAGE = 'mnemo_user_groq_api_key';

// In-memory cache for fast synchronous access
let cachedGeminiApiKey: string | null = null;
let cachedGroqApiKey: string | null = null;

/** Load stored API keys on app initialization. */
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
  } finally {
  }
}

// ─── Gemini API Key ───────────────────────────────────────────────

/**
 * The person's own Gemini key, or '' if they haven't added one. There is
 * deliberately no built-in fallback: a key bundled into the app can be
 * pulled out of it by anyone.
 */
export function getActiveApiKey(): string {
  return cachedGeminiApiKey?.trim() ?? '';
}

const keyListeners = new Set<() => void>();

/** Called after the key changes (a new key deserves a fresh try at everything). */
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

export function getApiKeySource(): 'custom' | 'none' {
  return getActiveApiKey() ? 'custom' : 'none';
}

export type KeyProblem = 'invalid' | 'quota' | 'offline' | 'busy' | 'other';

/** Sorts a Gemini error into something the person can act on. */
export function classifyAiError(err: unknown): KeyProblem {
  const msg = String((err as { message?: string })?.message ?? err);
  if (/API_KEY_INVALID|API key not valid|PERMISSION_DENIED|\b(401|403)\b/i.test(msg)) return 'invalid';
  if (/RESOURCE_EXHAUSTED|quota|rate limit|\b429\b/i.test(msg)) return 'quota';
  if (/Network request failed|Failed to fetch|NetworkError|ENOTFOUND|timed? ?out|offline/i.test(msg)) return 'offline';
  if (/\b503\b|UNAVAILABLE|high demand|overloaded/i.test(msg)) return 'busy';
  return 'other';
}

export const KEY_PROBLEM_TEXT: Record<KeyProblem, string> = {
  invalid: "Gemini didn't accept this key. Check you copied all of it.",
  quota: "This key's free daily limit is used up. Notes are saved and will be tidied up later.",
  offline: "Couldn't reach Gemini. Check your connection; notes are saved either way.",
  busy: 'Gemini is busy right now. Notes are saved and will be tidied up later.',
  other: 'Gemini returned an error. Notes are saved either way.',
};

/**
 * Checks a key by listing models: cheap, uses no generation quota, and
 * fails the same way generation would for a bad key.
 */
export async function validateApiKey(keyToTest?: string): Promise<{ valid: boolean; error?: string; problem?: KeyProblem }> {
  const key = keyToTest !== undefined ? keyToTest.trim() : getActiveApiKey();
  if (!key) return { valid: false, error: 'Paste your Gemini key first.', problem: 'invalid' };
  try {
    const client = new GoogleGenAI({ apiKey: key });
    const pager = await client.models.list({ config: { pageSize: 1 } });
    void pager;
    return { valid: true };
  } catch (err) {
    const problem = classifyAiError(err);
    return { valid: false, error: KEY_PROBLEM_TEXT[problem], problem };
  }
}

// ─── Groq API Key (backup voice transcription) ───────────────────

/**
 * The person's own Groq key, or ''. Optional: when Gemini can't write a
 * voice note out (down, out of quota), Groq's Whisper does.
 */
export function getActiveGroqApiKey(): string {
  return cachedGroqApiKey?.trim() ?? '';
}

export function getGroqApiKeySource(): 'custom' | 'none' {
  return getActiveGroqApiKey() ? 'custom' : 'none';
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

/** Checks a Groq key by listing its models (free, uses no transcription quota). */
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
