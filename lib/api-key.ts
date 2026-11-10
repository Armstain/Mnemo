import { GoogleGenAI } from '@google/genai';
import { aiErrorText, classifyAiError, type KeyProblem } from '@/lib/ai-error';
import { createEmitter } from '@/lib/emitter';
import { secureStorage } from '@/lib/storage';


function createSecret(storageKey: string, label: string) {
  let cached: string | null = null;
  const changed = createEmitter();
  return {
    async load(): Promise<void> {
      cached = await secureStorage.get(storageKey);
    },
    get: (): string => cached?.trim() ?? '',
    onChange: changed.on,
    async save(key: string): Promise<void> {
      const trimmed = key.trim();
      const didChange = (cached ?? '') !== trimmed;
      cached = trimmed || null;
      if (didChange) changed.emit();
      try {
        if (trimmed) await secureStorage.set(storageKey, trimmed);
        else await secureStorage.remove(storageKey);
      } catch (e) {
        console.error(`Failed to save the ${label}:`, e);
        throw e;
      }
    },
  };
}

const gemini = createSecret('mnemo_user_gemini_api_key', 'API key');
const groq = createSecret('mnemo_user_groq_api_key', 'Groq API key');

export async function loadStoredApiKeys(): Promise<void> {
  try {
    await gemini.load();
    await groq.load();
  } catch (e) {
    console.error('Failed to load stored API keys:', e);
  }
}

/** No built-in fallback key on purpose: a bundled key can be extracted from the app. */
export const getActiveApiKey = gemini.get;

export const onApiKeyChanged = gemini.onChange;

export const saveApiKey = gemini.save;

/** Lists models: uses no generation quota. */
export async function validateApiKey(keyToTest?: string): Promise<{ valid: boolean; error?: string; problem?: KeyProblem }> {
  const key = keyToTest !== undefined ? keyToTest.trim() : getActiveApiKey();
  if (!key) return { valid: false, error: 'Paste your key first.', problem: 'invalid' };
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

export const getActiveGroqApiKey = groq.get;

export const saveGroqApiKey = groq.save;

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
