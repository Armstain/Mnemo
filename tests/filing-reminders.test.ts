import { beforeEach, describe, expect, it, vi } from 'vitest';
import { foldReminders } from '@/lib/reminder-ownership';
import type { Entry, MnemoItem, Place } from '@/types/mnemo';

// The capture pipeline (lib/capture.ts) with the relationship engine deciding a new note belongs
// to an existing thread. Before the fix, the note's place reminder was dropped (or, for a voice
// note, overwrote the other thread's). Gemini and storage are stubbed; the store is in memory.

const gemini = vi.hoisted(() => ({ match: undefined as unknown, transcript: '' }));
const PLACES = vi.hoisted(() => [
  { id: 'a', name: 'Location A', latitude: 23.78, longitude: 90.4, radius: 150, accuracy: 20, savedAt: 1 },
  { id: 'tongi', name: 'Tongi', latitude: 23.9, longitude: 90.41, radius: 300, accuracy: 20, savedAt: 1 },
] as Place[]);

vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {} } }));
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
  loadAudio: async () => [{ data: 'x', mimeType: 'audio/m4a' }],
  splitAudio: (uri?: string) => (uri ? [uri] : []),
}));
vi.mock('@/lib/groq', () => ({ hasGroq: () => false, transcribeAudio: async () => '' }));
vi.mock('@/lib/errors', () => ({ logError: () => {} }));
vi.mock('@/lib/ai-mode', () => ({ aiEnabled: () => true, setAiProblem: () => {} }));
vi.mock('@/lib/preferences', () => ({ getPreferences: () => ({ places: true, speechLang: 'en-US' }), setPreferences: () => {} }));
vi.mock('@/lib/place-store', () => ({ getPlaces: () => PLACES }));
vi.mock('@/lib/gemini', () => {
  class AiOffError extends Error {}
  const answer = (notes: string) => ({
    title: 'Fabric',
    notes,
    links: [],
    tags: [],
    summary: { leftOff: '', nextSteps: [], resources: [] },
    thread: gemini.match,
  });
  return {
    AiOffError,
    processVoiceDump: async (text: string) => answer(text),
    processAudioDump: async () => ({ ...answer(gemini.transcript), transcript: gemini.transcript }),
  };
});

const { resolvePendingEntry } = await import('@/lib/capture');
const { onFiling } = await import('@/lib/filing');

/** The store's thread/entry operations, in memory, with fileEntry following the same rule as the real one. */
function makeStore(items: MnemoItem[], entries: Entry[], focusId: string | null = null) {
  const state = { items, entries };
  let n = 0;
  const store = {
    snapshot: () => state,
    getThread: (id: string) => state.items.find((i) => i.id === id),
    getFocusThreadId: () => focusId,
    updateEntry: (id: string, u: object) => (state.entries = state.entries.map((e) => (e.id === id ? { ...e, ...u } : e))),
    updateItem: (id: string, u: object) => (state.items = state.items.map((i) => (i.id === id ? { ...i, ...u } : i))),
    moveEntry: (id: string, to: string, filing: Entry['filing']) =>
      (state.entries = state.entries.map((e) => (e.id === id ? { ...e, threadId: to, filing } : e))),
    removeThreadNow: (id: string) => {
      state.items = state.items.filter((i) => i.id !== id);
      state.entries = state.entries.filter((e) => e.threadId !== id);
    },
    fileEntry(entryId: string, toId: string, filing: Entry['filing']) {
      const entry = state.entries.find((e) => e.id === entryId)!;
      const from = store.getThread(entry.threadId)!;
      const to = store.getThread(toId)!;
      const last = !state.entries.some((e) => e.threadId === from.id && e.id !== entryId);
      if (!last) {
        store.moveEntry(entryId, toId, filing);
        return { moved: true as const };
      }
      const fold = foldReminders(from, to);
      if (!fold.ok) return { moved: false as const, reason: fold.reason };
      store.moveEntry(entryId, toId, filing);
      store.updateItem(toId, fold.carry);
      store.removeThreadNow(from.id);
      return { moved: true as const, removedThreadId: from.id, carried: fold.carry };
    },
    moveEntryToNewThread(entryId: string, t: Pick<MnemoItem, 'title' | 'category' | 'tags'>) {
      const created = { ...t, id: `new-${++n}`, status: 'active', type: 'note', content: '', links: [], createdAt: 2, updatedAt: 2 } as MnemoItem;
      state.items = [...state.items, created];
      store.fileEntry(entryId, created.id, { by: 'user' });
      return store.getThread(created.id);
    },
  };
  return { store, state };
}

const thread = (id: string, title: string, extra: Partial<MnemoItem> = {}): MnemoItem =>
  ({ id, title, type: 'note', content: '', links: [], tags: [], category: 'personal', status: 'active', createdAt: 1, updatedAt: Date.now(), ...extra }) as MnemoItem;
const note = (id: string, threadId: string, text: string, extra: Partial<Entry> = {}): Entry => ({
  id,
  threadId,
  createdAt: 1,
  updatedAt: 1,
  source: 'text',
  blocks: [{ kind: 'text', markdown: text }],
  filing: { by: 'user' },
  ...extra,
});
const atA = { placeId: 'a', on: 'arrive' as const, setAt: 1, insideAtSet: false };
const atTongi = { placeId: 'tongi', on: 'arrive' as const, setAt: 2 };
const sureMatch = (threadId: string) => ({ match: 'existing', threadId, confidence: 0.95, reason: 'both are arrival reminders' });

const events: string[] = [];
onFiling((e) => events.push(e.type));
beforeEach(() => {
  events.length = 0;
  gemini.match = undefined;
  gemini.transcript = '';
});

describe('a new note with its own place reminder, matched to a thread with one', () => {
  it('stays its own thread with its own reminder; the connection is only suggested', async () => {
    const { store, state } = makeStore(
      [thread('A', 'Keys', { place: atA }), thread('B', 'Remind me when I arrive at Tongi', { place: atTongi, pending: true })],
      [
        note('a1', 'A', 'Remind me when I arrive at Location A'),
        note('b1', 'B', 'Remind me when I arrive at Tongi', { filing: { by: 'new' }, pending: true, pendingRawText: 'Remind me when I arrive at Tongi' }),
      ],
    );
    gemini.match = sureMatch('A');
    await resolvePendingEntry(state.entries[1], store as never);

    expect(state.items.find((i) => i.id === 'A')?.place).toEqual(atA);
    expect(state.items.find((i) => i.id === 'B')?.place).toEqual(atTongi);
    expect(state.entries.find((e) => e.id === 'b1')).toMatchObject({ threadId: 'B', filing: { by: 'suggested', threadId: 'A' } });
    expect(events).toEqual(['suggested']);
  });

  it('accepting the suggestion later is refused with a reason; disconnecting keeps both reminders', () => {
    const { store, state } = makeStore(
      [thread('A', 'Keys', { place: atA }), thread('B', 'Fabric', { place: atTongi })],
      [note('a1', 'A', 'Location A'), note('b1', 'B', 'Tongi', { filing: { by: 'suggested', threadId: 'A', confidence: 0.9 } })],
    );
    const filed = store.fileEntry('b1', 'A', { by: 'user' });
    expect(filed).toMatchObject({ moved: false, reason: expect.stringContaining('Keys') });
    // "Keep separate": only the filing changes.
    store.updateEntry('b1', { filing: { by: 'user' } });
    expect(state.items.map((i) => i.place)).toEqual([atA, atTongi]);
  });
});

describe('a voice note heard as a place reminder', () => {
  it('said into the focus thread that reminds at another place: becomes its own thread, both reminders kept', async () => {
    gemini.transcript = 'Remind me when I get to Tongi to buy fabric';
    const { store, state } = makeStore(
      [thread('A', 'Keys', { place: atA })],
      [note('a1', 'A', 'Remind me when I arrive at Location A'), note('v1', 'A', '', { source: 'voice', filing: { by: 'focus' }, pending: true, pendingAudioUri: 'rec.m4a', blocks: [] })],
      'A',
    );
    gemini.match = sureMatch('A');
    await resolvePendingEntry(state.entries[1], store as never);

    expect(state.items.find((i) => i.id === 'A')?.place).toEqual(atA);
    const own = state.items.find((i) => i.id !== 'A')!;
    expect(own.place).toMatchObject({ placeId: 'tongi', on: 'arrive' });
    expect(state.entries.find((e) => e.id === 'v1')?.threadId).toBe(own.id);
    expect(events).toContain('released');
  });

  it('a new recording matched to a thread with a place reminder is not filed into it', async () => {
    gemini.transcript = 'Remind me when I get to Tongi';
    const { store, state } = makeStore(
      [thread('A', 'Keys', { place: atA }), thread('V', 'Voice note', { pending: true })],
      [note('a1', 'A', 'Location A'), note('v1', 'V', '', { source: 'voice', filing: { by: 'new' }, pending: true, pendingAudioUri: 'rec.m4a', blocks: [] })],
    );
    gemini.match = sureMatch('A');
    await resolvePendingEntry(state.entries[1], store as never);

    expect(state.items.find((i) => i.id === 'A')?.place).toEqual(atA);
    expect(state.items.find((i) => i.id === 'V')?.place).toMatchObject({ placeId: 'tongi' });
    expect(state.entries.find((e) => e.id === 'v1')?.threadId).toBe('V');
  });
});

describe('notes without a reminder of their own are filed as before', () => {
  it('a sure match is filed into the thread, which keeps its place reminder', async () => {
    const { store, state } = makeStore(
      [thread('A', 'Keys', { place: atA }), thread('N', 'Note', { pending: true })],
      [note('a1', 'A', 'Location A'), note('n1', 'N', 'The spare key is under the mat', { filing: { by: 'new' }, pending: true, pendingRawText: 'The spare key is under the mat' })],
    );
    gemini.match = sureMatch('A');
    await resolvePendingEntry(state.entries[1], store as never);

    expect(state.entries.find((e) => e.id === 'n1')?.threadId).toBe('A');
    expect(state.items.map((i) => i.id)).toEqual(['A']);
    expect(state.items[0].place).toEqual(atA);
    expect(events).toEqual(['attached']);
  });
});
