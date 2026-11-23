import { describe, expect, it, vi } from 'vitest';
import type { Entry, MnemoItem } from '@/types/mnemo';

// A voice note recorded for Gemini whose recording can't be read any more (gone, or unreadable).
// It used to be finished quietly as an empty note: now it says so, and the voice log records it.

const audio = vi.hoisted(() => ({ clips: [] as { data: string; mimeType: string }[] }));
const storage = vi.hoisted(() => new Map<string, string>());
const logged = vi.hoisted(() => [] as string[]);
const fail = vi.hoisted(() => ({ with: null as string | null }));

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
vi.mock('@/lib/place-store', () => ({ getPlaces: () => [], loadPlaces: async () => [] }));
vi.mock('@/lib/gemini', () => {
  class AiOffError extends Error {}
  const answer = { title: 'Milk', notes: 'Buy milk', links: [], tags: [], summary: { leftOff: '', nextSteps: [], resources: [] }, transcript: 'Buy milk' };
  return {
    AiOffError,
    processVoiceDump: async () => answer,
    processAudioDump: async () => {
      if (fail.with) throw new Error(fail.with);
      return answer;
    },
  };
});

const { resolvePendingEntry, LOST_RECORDING, releaseThread, retryWaitingNow, waitingProblem } = await import('@/lib/capture');
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
    // Its thread no longer says "Being read…" for ever.
    expect(state.items[0].pending).toBe(false);
    expect(logged).toContain('voice note');
    expect((await readVoiceLog()).map((l) => l.text)).toContain("LOST: 1 recording couldn't be read");
  });

  it('a readable one leaves its steps in the live trace', async () => {
    const { clearTrace, traceSnapshot } = await import('@/lib/trace');
    clearTrace();
    audio.clips = [{ data: 'A'.repeat(4096), mimeType: 'audio/m4a' }];
    retryWaitingNow();
    const { state, store } = setup();
    await resolvePendingEntry(state.entries[0], store as never);
    const steps = traceSnapshot().events.map((e) => `${e.topic} ${e.text}`);
    expect(steps[0]).toBe('e:v1 read 1 of 1 recording (3 KB)');
    expect(steps.some((s) => s.startsWith('e:v1 Gemini read it: “Milk” · heard “Buy milk”'))).toBe(true);
    expect(steps.at(-1)).toBe('e:v1 processing → done');
    expect(traceSnapshot().active).toEqual([]);
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

describe('a voice note that keeps failing to be written out', () => {
  it('after two failed tries, says why instead of "Processing"', async () => {
    audio.clips = [{ data: 'A'.repeat(400), mimeType: 'audio/m4a' }];
    fail.with = '503 UNAVAILABLE: The model is overloaded';
    retryWaitingNow();
    const { state, store } = setup();
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now');
    try {
      clock.mockReturnValue(start);
      await resolvePendingEntry(state.entries[0], store as never);
      expect(waitingProblem('v1')).toBeNull();
      // Past the first back-off (30 s): tried again, and failed the same way.
      clock.mockReturnValue(start + 31_000);
      await resolvePendingEntry(state.entries[0], store as never);
      expect(waitingProblem('v1')).toEqual({ tries: 2, text: 'Gemini is busy' });
      expect(state.entries[0].pending).toBe(true);
    } finally {
      clock.mockRestore();
      fail.with = null;
    }
  });

  it('the reason is logged once, not on every retry', async () => {
    const texts = (await readVoiceLog()).map((l) => l.text).filter((t) => t.startsWith("Gemini couldn't"));
    expect(texts).toHaveLength(1);
  });
});

describe('a thread stuck on "Being read…"', () => {
  it('is released once none of its notes is waiting', () => {
    const { state, store } = setup();
    state.entries = state.entries.map((e) => ({ ...e, pending: false }));
    expect(releaseThread(store as never, 'V')).toBe(true);
    expect(state.items[0].pending).toBe(false);
  });

  it('is left alone while a note of it still waits', () => {
    const { state, store } = setup();
    expect(releaseThread(store as never, 'V')).toBe(false);
    expect(state.items[0].pending).toBe(true);
  });
});
