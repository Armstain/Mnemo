import { getActiveApiKey, loadStoredApiKeys } from '@/lib/api-key';
import { getPreferences, loadPreferences } from '@/lib/preferences';

/** True when notes should go to Gemini: the person chose AI and has a key. */
export function aiEnabled(): boolean {
  return getPreferences().aiMode === 'gemini' && getActiveApiKey().length > 0;
}

/**
 * Resolves once the key and preferences are read. Anything that decides
 * between AI and offline at startup (the pending-note sweep) waits on it.
 */
export const appReady: Promise<void> = loadStoredApiKeys().then(async () => {
  await loadPreferences(getActiveApiKey().length > 0);
});
