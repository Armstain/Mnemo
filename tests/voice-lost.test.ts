import { describe, expect, it, vi } from 'vitest';
import type { Entry, MnemoItem } from '@/types/mnemo';

// A voice note recorded for Gemini whose recording can't be read any more (gone, or unreadable).
// It used to be finished quietly as an empty note: now it says so, and the voice log records it.

const audio = vi.hoisted(() => ({ clips: [] as { data: string; mimeType: string }[] }));
const storage = vi.hoisted(() => new Map<string, string>());
const logged = vi.hoisted(() => [] as string[]);

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async (k: string) => storage.get(k) ?? null, setItem: async (k: string, v: string) => void storage.set(k, v) },
}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: {} }));
vi.mock('@/lib/db', () => ({ getVectors: async () => new Map(), upsertEmbedding: async () => {} }));
vi.mock('@/lib/embeddings', () => ({ embedText: async () => new Float32Array(), embeddingModel: async () => 'm', embeddableText: () => '', toBlob: () => new Uint8Array() }));
vi.mock('@/lib/images', () => ({ imageBase64: async () => '', imagesOf: () => [] }));
vi.mock('@/lib/link-preview', () => ({ fetchLinkPreview: async () => null }));
vi.mock('@/lib/voice-audio', () => ({
  deleteAllAudio: () => {},
  deleteAudio: () => {},
  joinAudio: () => undefined,
  loadAudio: async () => audio.clips,
  splitAudio: (uri?: string) => (uri ? uri.split('\n') : []),
}));
vi.mock('@/lib/groq', () => ({ hasGroq: () => false, transcribeAudio: async () => '' }));
vi.mock('@/lib/errors', () => ({ logError: (where: string) => void logged.push(where) }));
vi.mock('@/lib/ai-mode', () => ({ aiEnabled: () => true, setAiProblem: () => {} }));
vi.mock('@/lib/preferences', () => ({ getPreferences: () => ({ places: false, speechLang: 'en-US' }), setPreferences: () => {} }));
vi.mock('@/lib/place-store', () => ({ getPlaces: () => [] }));
vi.mock('@/lib/gemini', () => {
  class AiOffError extends Error {}
  const answer = { title: 'Milk', notes: 'Buy milk', links: [], tags: [], summary: { leftOff: '', nextSteps: [], resources: [] }, transcript: 'Buy milk' };
  return { AiOffError, processVoiceDump: async () => answer, processAudioDump: async () => answer };
});

const { resolvePendingEntry, LOST_RECORDING } = await import('@/lib/capture');
const { readVoiceLog } = await import('@/lib/voice-log');

function setup() {
  const state = {
    items: [{ id: 'V', title: 'Voice note', type: 'note', content: '', links: [], tags: [], category: 'personal', status: 'active', pending: true, createdAt: 1, updatedAt: 1 } as MnemoItem],
    entries: [{ id: 'v1', threadId: 'V', createdAt: 1, updatedAt: 1, source: 'voice', blocks: [], filing: { by: 'new' }, pending: true, pendingAudioUri: 'file:///rec/1-a.m4a' } as Entry],
  };
  const store = {
    snapshot: () => state,
    getThread: (id: string) => state.items.find((i) => i.id === id),
    getFocusThreadId: () => null,
    updateEntry: (id: string, u: object) => (state.entries = state.entries.map((e) => (e.id === id ? { ...e, ...u } : e))),
    updateItem: (id: string, u: object) => (state.items = state.items.map((i) => (i.id === id ? { ...i, ...u } : i))),
  };
  return { state, store };
}

describe('a voice note whose recording is gone', () => {
  it('says so on the note instead of ending up blank, and is logged', async () => {
    audio.clips = [];
    const { state, store } = setup();
    await resolvePendingEntry(state.entries[0], store as never);
    const e = state.entries[0];
    expect(e.pending).toBe(false);
    expect(e.pendingAudioUri).toBeUndefined();
    expect(e.blocks).toEqual([{ kind: 'text', markdown: LOST_RECORDING }]);
    expect(logged).toContain('voice note');
    expect((await readVoiceLog()).map((l) => l.text)).toContain("LOST: 1 recording couldn't be read");
  });

  it('a readable one is written out, and the log says how much (never what)', async () => {
    audio.clips = [{ data: 'A'.repeat(4096), mimeType: 'audio/m4a' }];
    const { state, store } = setup();
    await resolvePendingEntry(state.entries[0], store as never);
    const texts = (await readVoiceLog()).map((l) => l.text);
    expect(texts.at(-1)).toBe('written out by Gemini (1 clip, 3 KB): 2 words');
    expect(texts.join('\n')).not.toContain('milk');
  });
});
