import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalReading } from '@/lib/local-prompt';

const disk = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async (k: string) => disk.get(k) ?? null, setItem: async (k: string, v: string) => void disk.set(k, v) },
}));
vi.mock('expo-secure-store', () => ({}));

let answer: LocalReading | null = null;
let enabled = true;
const asked: string[] = [];
vi.mock('@/lib/local-ai', () => ({
  localAiEnabled: () => enabled,
  readNoteLocally: async (note: string) => {
    asked.push(note);
    if (!answer) throw new Error('out of memory');
    return answer;
  },
}));

const { polishLater, polishWaiting } = await import('@/lib/local-polish');
const { understand } = await import('@/lib/understand');

interface T {
  id: string;
  title: string;
  category: string;
  kind?: string;
  tags: string[];
  pinned?: { title?: boolean; kind?: boolean };
}

function makeStore(threads: T[], entries: { id: string; threadId: string; text: string }[]) {
  const items = new Map(threads.map((t) => [t.id, { ...t }]));
  const es = entries.map((e) => ({ ...e, pending: false, transcript: e.text, blocks: [{ kind: 'text', markdown: e.text }] }));
  return {
    snapshot: () => ({ entries: es, items: [...items.values()] }),
    getThread: (id: string) => items.get(id),
    updateItem: (id: string, u: object) => void Object.assign(items.get(id)!, u),
  } as never as Parameters<typeof polishLater>[1] & { getThread: (id: string) => T | undefined };
}

const SINK = "need to call the plumber about the kitchen sink tomorrow, it's leaking again";
/** The name the phone's own reader gave it when it was saved. */
const SINK_TITLE = understand(SINK).title;

beforeEach(() => {
  answer = { title: 'kitchen sink leak', kind: 'task', category: 'work', tags: ['plumber', 'sink'] };
  enabled = true;
  asked.length = 0;
});

async function polish(store: Parameters<typeof polishLater>[1], id: string) {
  polishLater(id, store);
  await polishWaiting(store);
  await new Promise((r) => setTimeout(r, 0));
}

describe('the on-device model naming a saved note', () => {
  it('renames a thread the note started, and tags it', async () => {
    const store = makeStore([{ id: 't1', title: SINK_TITLE, category: 'errands', kind: 'task', tags: [] }], [{ id: 'e1', threadId: 't1', text: SINK }]);
    await polish(store, 'e1');
    expect(store.getThread('t1')).toMatchObject({ title: 'Kitchen sink leak', category: 'errands', kind: 'task', tags: ['plumber', 'sink'] });
  });

  it('never renames a thread the person named', async () => {
    const store = makeStore(
      [
        { id: 't1', title: 'Sink!!', category: 'general', tags: [] },
        { id: 't2', title: SINK_TITLE, category: 'general', tags: [], pinned: { title: true } },
      ],
      [
        { id: 'e1', threadId: 't1', text: SINK },
        { id: 'e2', threadId: 't2', text: SINK },
      ],
    );
    await polish(store, 'e1');
    await polish(store, 'e2');
    expect(store.getThread('t1')?.title).toBe('Sink!!');
    expect(store.getThread('t2')?.title).toBe(SINK_TITLE);
  });

  it('a note added to a longer thread only brings tags', async () => {
    const store = makeStore(
      [{ id: 't1', title: 'House', category: 'general', tags: ['home'] }],
      [
        { id: 'e0', threadId: 't1', text: 'paint the hall' },
        { id: 'e1', threadId: 't1', text: SINK },
      ],
    );
    await polish(store, 'e1');
    expect(store.getThread('t1')).toMatchObject({ title: 'House', category: 'general', tags: ['home', 'plumber', 'sink'] });
    expect(store.getThread('t1')?.kind).toBeUndefined();
  });

  it('a model that fails leaves the note as the phone read it, and moves on', async () => {
    answer = null;
    const store = makeStore([{ id: 't1', title: SINK_TITLE, category: 'errands', tags: [] }], [{ id: 'e1', threadId: 't1', text: SINK }]);
    await polish(store, 'e1');
    expect(store.getThread('t1')?.title).toBe(SINK_TITLE);
    expect(JSON.parse(disk.get('mnemo-local-waiting') ?? '[]')).toEqual([]);
  });

  it('does nothing when the model is off', async () => {
    enabled = false;
    const store = makeStore([{ id: 't1', title: SINK_TITLE, category: 'errands', tags: [] }], [{ id: 'e1', threadId: 't1', text: SINK }]);
    await polish(store, 'e1');
    expect(asked).toEqual([]);
  });
});
