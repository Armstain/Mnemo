import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmptyResponseError, describeEmpty } from '@/lib/empty-response';
import { retryProblemText } from '@/lib/ai-error';

// The phone's storage, in memory: what the sweep remembers across restarts.
const disk = vi.hoisted(() => new Map<string, string>());
// Gemini: answers each note as `answer` says, and counts the calls.
const gemini = vi.hoisted(() => ({ calls: 0, answer: 'blocked' as 'blocked' | 'ok' }));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async (k: string) => disk.get(k) ?? null, setItem: async (k: string, v: string) => void disk.set(k, v) },
}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: {} }));
vi.mock('@/lib/db', () => ({ getVectors: async () => new Map(), upsertEmbedding: async () => {} }));
vi.mock('@/lib/embeddings', () => ({ embedText: async () => new Float32Array(), embeddingModel: async () => 'm', embeddableText: () => '', toBlob: () => new Uint8Array() }));
vi.mock('@/lib/images', () => ({ imageBase64: async () => '', imagesOf: () => [] }));
vi.mock('@/lib/link-preview', () => ({ fetchLinkPreview: async () => null }));
vi.mock('@/lib/voice-audio', () => ({ deleteAllAudio: () => {}, deleteAudio: () => {}, joinAudio: () => undefined, loadAudio: async () => [], splitAudio: () => [] }));
vi.mock('@/lib/groq', () => ({ hasGroq: () => false, transcribeAudio: async () => '' }));
vi.mock('@/lib/errors', () => ({ logError: () => {} }));
vi.mock('@/lib/ai-mode', () => ({ aiEnabled: () => true, setAiProblem: () => {} }));
vi.mock('@/lib/gemini', () => {
  class AiOffError extends Error {}
  const blockedAnswer = () =>
    new EmptyResponseError(
      [describeEmpty({ candidates: [], promptFeedback: { blockReason: 'PROHIBITED_CONTENT', safetyRatings: [{ category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'MEDIUM' }] } }, 'gemini-2.5-flash')],
      { label: 'transcript 31 chars', none: false },
    );
  return {
    AiOffError,
    processAudioDump: async () => {
      throw blockedAnswer();
    },
    processVoiceDump: async () => {
      gemini.calls++;
      if (gemini.answer === 'blocked') throw blockedAnswer();
      return { title: 'Eastern', notes: 'Remind me when I get to Eastern', links: [], tags: [], summary: { leftOff: '', nextSteps: [], resources: [] } };
    },
  };
});

const { resolvePendingEntry, retryEntryNow, retryWaitingNow } = await import('@/lib/capture');

// A thread with one note still waiting for Gemini.
function makeStore(text: string, id: string) {
  const thread = { id: 't', title: 'Eastern', type: 'note', content: text, links: [], tags: [], category: 'general', status: 'active', createdAt: 1, updatedAt: 1 };
  const entry = { id, threadId: 't', createdAt: 1, updatedAt: 1, source: 'text', blocks: [{ kind: 'text', markdown: text }], filing: { by: 'user' }, pending: true, pendingRawText: text };
  const state = { items: [thread], entries: [entry] };
  const store = {
    snapshot: () => state,
    getThread: (id: string) => state.items.find((i) => i.id === id),
    updateEntry: (id: string, u: object) => (state.entries = state.entries.map((e) => (e.id === id ? { ...e, ...u } : e))),
    updateItem: (id: string, u: object) => (state.items = state.items.map((i) => (i.id === id ? { ...i, ...u } : i))),
    getFocusThreadId: () => null,
  };
  return { store: store as never, entry: () => state.entries[0] as never };
}

describe('a note the safety filter declined', () => {
  beforeEach(() => {
    gemini.calls = 0;
    gemini.answer = 'blocked';
    disk.clear();
  });

  it('is finished on the phone, like offline, and never sent again', async () => {
    const { store, entry } = makeStore('Remind me when I get to Eastern', 'e1');
    await resolvePendingEntry(entry(), store);
    expect(gemini.calls).toBe(1);
    const done = entry() as { pending: boolean; blocks: { markdown: string }[] };
    expect(done.pending).toBe(false);
    // Saved as written.
    expect(done.blocks[0].markdown).toBe('Remind me when I get to Eastern');
    for (let i = 0; i < 5; i++) {
      retryWaitingNow();
      await resolvePendingEntry(entry(), store);
    }
    expect(gemini.calls).toBe(1);
  });

  it('Retry on a declined note finishes it too, without an error to show', async () => {
    const { store, entry } = makeStore('Remind me when I get to Eastern Housing', 'e2');
    await expect(retryEntryNow(entry(), store)).resolves.toBeUndefined();
    expect((entry() as { pending: boolean }).pending).toBe(false);
  });
});

describe('what the Retry dialog says', () => {
  const blockedError = new Error(
    'Gemini returned no text (blocked) · safety=HARM_CATEGORY_DANGEROUS_CONTENT:MEDIUM · input: transcript 31 chars · gemini-2.5-flash finish=- block=PROHIBITED_CONTENT candidates=0',
  );
  it('a block says it waits for an edit or Retry, not that it retries', () => {
    expect(retryProblemText(blockedError).message).toBe(
      "The safety filter declined to process this note. It's saved as you wrote it. It won't be tried again until you edit it or tap Retry.",
    );
    expect(retryProblemText(blockedError).message).not.toContain('by itself');
  });
  it('offline, quota and busy say they retry', () => {
    expect(retryProblemText(new Error('Network request failed')).message).toMatch(/It's tried again by itself\.$/);
    expect(retryProblemText(new Error('429 RESOURCE_EXHAUSTED')).message).toMatch(/It's tried again by itself\.$/);
    expect(retryProblemText(new Error('503 UNAVAILABLE: The model is overloaded')).message).toMatch(/It's tried again by itself\.$/);
  });
  it('others say what happened, and nothing about retrying', () => {
    expect(retryProblemText(new Error('API key not valid')).message).not.toContain('by itself');
    expect(retryProblemText(new Error('Gemini returned no text (truncated) · input: transcript 9 chars · m finish=MAX_TOKENS candidates=1')).message).not.toContain('by itself');
  });
});
