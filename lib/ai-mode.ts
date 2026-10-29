import { useSyncExternalStore } from 'react';
import type { KeyProblem } from '@/lib/api-key';
import { getActiveApiKey, loadStoredApiKeys, onApiKeyChanged } from '@/lib/api-key';
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

// ─── When Gemini isn't answering ────────────────────────────────
// Set by the background queue when a call fails for a reason the person
// can fix (a bad key, a spent quota); cleared by the next success or a new
// key. Screens show it instead of a silent "Processing" that never ends.


onApiKeyChanged(() => {
  setAiProblem(null);
  setAiNotice(null);
});

export type AiProblem = Extract<KeyProblem, 'invalid' | 'quota'>;

let problem: AiProblem | null = null;
const problemListeners = new Set<() => void>();

let problemDetail: string | null = null;

/** `detail` is the specific wording (which quota, and when it's back); screens fall back to their own text. */
export function setAiProblem(next: AiProblem | null, detail: string | null = null): void {
  if (next === problem && detail === problemDetail) return;
  problem = next;
  problemDetail = next ? detail : null;
  problemListeners.forEach((l) => l());
}

export function useAiProblemDetail(): string | null {
  return useSyncExternalStore(
    (l) => {
      problemListeners.add(l);
      return () => problemListeners.delete(l);
    },
    () => problemDetail,
    () => problemDetail,
  );
}

// ─── Running on a lighter model ─────────────────────────────────
// Set when notes were written by Flash-Lite because every Flash model was
// out of quota or resting; cleared by the next note a Flash model writes.

let notice: string | null = null;
const noticeListeners = new Set<() => void>();

export function setAiNotice(next: string | null): void {
  if (next === notice) return;
  notice = next;
  noticeListeners.forEach((l) => l());
}

export function useAiNotice(): string | null {
  return useSyncExternalStore(
    (l) => {
      noticeListeners.add(l);
      return () => noticeListeners.delete(l);
    },
    () => notice,
    () => notice,
  );
}

export function useAiProblem(): AiProblem | null {
  return useSyncExternalStore(
    (l) => {
      problemListeners.add(l);
      return () => problemListeners.delete(l);
    },
    () => problem,
    () => problem,
  );
}
