import type { KeyProblem } from '@/lib/ai-error';
import { getActiveApiKey, loadStoredApiKeys, onApiKeyChanged } from '@/lib/api-key';
import { getPreferences, loadPreferences } from '@/lib/preferences';
import { createValueStore } from '@/lib/value-store';

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

// A bad key or a spent quota, set by the background queue and cleared by the
// next success or a new key. Screens show it instead of a silent "Processing" that never ends.
export type AiProblem = Extract<KeyProblem, 'invalid' | 'quota'>;

const problem = createValueStore<{ kind: AiProblem | null; detail: string | null }>({ kind: null, detail: null });

/** `detail` is the specific wording (which quota, and when it's back); screens fall back to their own text. */
export function setAiProblem(next: AiProblem | null, detail: string | null = null): void {
  const nextDetail = next ? detail : null;
  const { kind, detail: current } = problem.get();
  if (next === kind && nextDetail === current) return;
  problem.set({ kind: next, detail: nextDetail });
}

export const useAiProblemDetail = (): string | null => problem.useValue().detail;

export const useAiProblem = (): AiProblem | null => problem.useValue().kind;

// Set when notes were written by Flash-Lite because every Flash model was
// out of quota or resting; cleared by the next note a Flash model writes.
const notice = createValueStore<string | null>(null);

export function setAiNotice(next: string | null): void {
  if (next !== notice.get()) notice.set(next);
}

export const useAiNotice = (): string | null => notice.useValue();

onApiKeyChanged(() => {
  setAiProblem(null);
  setAiNotice(null);
});
