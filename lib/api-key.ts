import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { GoogleGenAI } from '@google/genai';

const GEMINI_KEY_STORAGE = 'mnemo_user_gemini_api_key';
const GROQ_KEY_STORAGE = 'mnemo_user_groq_api_key';

// In-memory cache for fast synchronous access
let cachedGeminiApiKey: string | null = null;
let cachedGroqApiKey: string | null = null;
let isLoaded = false;

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
    isLoaded = true;
  }
}

/** Backward compatibility alias. */
export const loadStoredApiKey = loadStoredApiKeys;

// ─── Gemini API Key ───────────────────────────────────────────────

export function getActiveApiKey(): string {
  if (cachedGeminiApiKey && cachedGeminiApiKey.trim().length > 0) {
    return cachedGeminiApiKey.trim();
  }
  return (process.env.EXPO_PUBLIC_GEMINI_API_KEY || '').trim();
}

export async function saveApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  cachedGeminiApiKey = trimmed || null;
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

export function getApiKeySource(): 'custom' | 'env' | 'none' {
  if (cachedGeminiApiKey && cachedGeminiApiKey.trim().length > 0) return 'custom';
  if ((process.env.EXPO_PUBLIC_GEMINI_API_KEY || '').trim().length > 0) return 'env';
  return 'none';
}

export async function validateApiKey(keyToTest?: string): Promise<{ valid: boolean; error?: string }> {
  const key = keyToTest !== undefined ? keyToTest.trim() : getActiveApiKey();
  if (!key) {
    return { valid: false, error: 'No Gemini API key provided' };
  }
  try {
    const testAI = new GoogleGenAI({ apiKey: key });
    const res = await testAI.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: 'Test connection',
    });
    if (res.text !== undefined) {
      return { valid: true };
    }
    return { valid: false, error: 'Received empty response from Gemini' };
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (msg.includes('API_KEY_INVALID') || msg.includes('400') || msg.includes('403')) {
      return { valid: false, error: 'Invalid Gemini API key.' };
    }
    return { valid: false, error: msg };
  }
}

// ─── Groq API Key (Whisper Voice Transcription) ───────────────────

export function getActiveGroqApiKey(): string {
  if (cachedGroqApiKey && cachedGroqApiKey.trim().length > 0) {
    return cachedGroqApiKey.trim();
  }
  return (process.env.EXPO_PUBLIC_GROQ_API_KEY || '').trim();
}

export async function saveGroqApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  cachedGroqApiKey = trimmed || null;
  try {
    if (!trimmed) {
      if (Platform.OS === 'web') {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(GROQ_KEY_STORAGE);
      } else {
        await SecureStore.deleteItemAsync(GROQ_KEY_STORAGE);
      }
    } else {
      if (Platform.OS === 'web') {
        if (typeof localStorage !== 'undefined') localStorage.setItem(GROQ_KEY_STORAGE, trimmed);
      } else {
        await SecureStore.setItemAsync(GROQ_KEY_STORAGE, trimmed);
      }
    }
  } catch (e) {
    console.error('Failed to save Groq API key:', e);
    throw e;
  }
}

export function getGroqApiKeySource(): 'custom' | 'env' | 'none' {
  if (cachedGroqApiKey && cachedGroqApiKey.trim().length > 0) return 'custom';
  if ((process.env.EXPO_PUBLIC_GROQ_API_KEY || '').trim().length > 0) return 'env';
  return 'none';
}

export async function validateGroqApiKey(keyToTest?: string): Promise<{ valid: boolean; error?: string }> {
  const key = keyToTest !== undefined ? keyToTest.trim() : getActiveGroqApiKey();
  if (!key) {
    return { valid: false, error: 'No Groq API key provided' };
  }
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.ok) {
      return { valid: true };
    }
    if (res.status === 401) {
      return { valid: false, error: 'Invalid Groq API key. Check console.groq.com' };
    }
    return { valid: false, error: `Groq error (${res.status})` };
  } catch (err: any) {
    return { valid: false, error: err?.message || 'Network error reaching Groq API' };
  }
}
