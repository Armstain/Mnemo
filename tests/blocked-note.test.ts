import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmptyResponseError, describeEmpty } from '@/lib/empty-response';
import { classifyAiError, retryProblemText } from '@/lib/api-key';

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

const { resolvePendingEntry, retryEntryNow, retryWaitingNow, isBlockedNote } = await import('@/lib/capture');

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

  it('is not put on the back-off list, and the sweep never sends it again', async () => {
    const { store, entry } = makeStore('Remind me when I get to Eastern', 'e1');
    // First send (as when it was saved), then the sweep: every minute, on
    // returning to the app ("try everything now"), and again later.
    await resolvePendingEntry(entry(), store);
    expect(gemini.calls).toBe(1);
    expect(isBlockedNote(entry())).toBe(true);
    for (let i = 0; i < 5; i++) {
      retryWaitingNow();
      await resolvePendingEntry(entry(), store);
    }
    expect(gemini.calls).toBe(1);
    // Still saved as written, still waiting (so Retry stays on it).
    expect((entry() as { pending: boolean; blocks: { markdown: string }[] }).pending).toBe(true);
    // Remembered, so a restart doesn't send it either.
    expect(JSON.parse(disk.get('mnemo-ai-blocked')!)).toHaveProperty('e1');
  });

  it('Retry sends it at once; declined again, the sweep goes back to leaving it', async () => {
    const { store, entry } = makeStore('Remind me when I get to Eastern', 'e2');
    await resolvePendingEntry(entry(), store);
    const error = await retryEntryNow(entry(), store).catch((e) => e);
    expect(gemini.calls).toBe(2);
    expect(classifyAiError(error)).toBe('blocked');
    await resolvePendingEntry(entry(), store);
    expect(gemini.calls).toBe(2);
  });

  it('Retry that goes through clears it', async () => {
    const { store, entry } = makeStore('Remind me when I get to Eastern', 'e3');
    await resolvePendingEntry(entry(), store);
    gemini.answer = 'ok';
    await retryEntryNow(entry(), store);
    expect(gemini.calls).toBe(2);
    expect(isBlockedNote(entry())).toBe(false);
    expect(JSON.parse(disk.get('mnemo-ai-blocked')!)).not.toHaveProperty('e3');
  });

  it('an edited note is sent again by the sweep', async () => {
    const { store, entry } = makeStore('Remind me when I get to Eastern', 'e4');
    await resolvePendingEntry(entry(), store);
    // What EntryCard's saveText does to a note still waiting.
    (store as { updateEntry: (id: string, u: object) => void }).updateEntry('e4', {
      blocks: [{ kind: 'text', markdown: 'Remind me at Eastern Plaza' }],
      pendingRawText: 'Remind me at Eastern Plaza',
    });
    expect(isBlockedNote(entry())).toBe(false);
    await resolvePendingEntry(entry(), store);
    expect(gemini.calls).toBe(2);
  });
});

describe('what the Retry dialog says', () => {
  const blockedError = new Error(
    'Gemini returned no text (blocked) · safety=HARM_CATEGORY_DANGEROUS_CONTENT:MEDIUM · input: transcript 31 chars · gemini-2.5-flash finish=- block=PROHIBITED_CONTENT candidates=0',
  );
  it('a block says it waits for an edit or Retry, not that it retries', () => {
    expect(retryProblemText(blockedError).message).toBe(
      "Gemini's safety filter declined to process this note. It's saved as you wrote it. It won't be tried again until you edit it or tap Retry.",
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
