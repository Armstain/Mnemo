import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MnemoItem } from '@/types/mnemo';

// The real store (hooks/use-mnemo-store.tsx), not a copy: mounted once with React's server
// renderer, which runs no effects (so nothing loads from the database) but gives the store's
// actions, which work on its refs synchronously. Storage and reminders are recorded, not real.

const reminders = vi.hoisted(() => [] as { id: string; status: string; dueDate?: number }[]);
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } }));
vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: {} }));
vi.mock('@/lib/db', () => ({ initDb: async () => [], countItems: async () => 0, getAllItems: async () => [], insertItem: async () => [], insertItems: async () => [], updatePartialItem: async () => [], deleteItemRow: async () => [], deleteAllItems: async () => [], ensureEntriesForItems: async () => [], getAllEntries: async () => [], insertEntry: async () => [], deleteEntryRow: async () => [], saveThreadsAndEntries: async () => [] }));
vi.mock('@/lib/reminders', () => ({
  syncReminderForItem: async (i: { id: string; status: string; dueDate?: number }) => void reminders.push({ id: i.id, status: i.status, dueDate: i.dueDate }),
  cancelReminder: async () => {},
  cancelAllReminders: async () => {},
}));
vi.mock('@/lib/capture', () => ({ deleteAllRecordings: () => {} }));
vi.mock('@/lib/images', () => ({ deleteAllImages: () => {}, forgetImages: () => {}, restoreImage: () => {} }));
vi.mock('@/lib/place-store', () => ({ removeAllPlaces: async () => {} }));
vi.mock('@/hooks/use-undo-toast', () => ({ UNDO_WINDOW_MS: 5000 }));
vi.spyOn(console, 'error').mockImplementation(() => {});

const { MnemoStoreProvider, useMnemoStore } = await import('@/hooks/use-mnemo-store');
type Store = ReturnType<typeof useMnemoStore>;

function mountStore(): Store {
  let store: Store | undefined;
  const Grab = () => {
    store = useMnemoStore();
    return null;
  };
  renderToString(createElement(MnemoStoreProvider, null, createElement(Grab)));
  return store!;
}

const DAY = 24 * 3600_000;
const text = (markdown: string) => ({ source: 'text' as const, blocks: [{ kind: 'text' as const, markdown }] });

function shopThread(s: Store, extra: Partial<MnemoItem> = {}) {
  const { thread } = s.createThread(
    { title: 'দোকানের ২০ টাকা বাকি', category: 'errands', kind: 'task', tags: [], status: 'active', dueDate: Date.now() + DAY, ...extra },
    { ...text('দোকানের ২০ টাকা বাকি'), nextStep: 'দোকানে ২০ টাকা দিয়ে দেওয়া' },
  );
  return thread.id;
}

beforeEach(() => {
  reminders.length = 0;
});

describe('finishing a thread in the real store', () => {
  it('one thing to do: Done ticks its step and finishes it, in one change', () => {
    const s = mountStore();
    const id = shopThread(s);
    const done = s.completeItem(id)!;
    expect(done).not.toBeNull();
    expect(s.getThread(id)?.status).toBe('completed');
    expect(s.snapshot().entries.find((e) => e.threadId === id)?.stepDone).toBe(true);
    // Its reminder was cancelled with it (synced with the finished status).
    expect(reminders.at(-1)).toMatchObject({ id, status: 'completed' });
  });

  it('a second Done (double tap) changes nothing and returns null', () => {
    const s = mountStore();
    const id = shopThread(s);
    s.completeItem(id);
    const before = JSON.stringify(s.snapshot());
    expect(s.completeItem(id)).toBeNull();
    expect(JSON.stringify(s.snapshot())).toBe(before);
  });

  it('Undo puts back all of it: status, the step, the reminder', () => {
    const s = mountStore();
    const id = shopThread(s);
    const was = s.getThread(id)!;
    s.completeItem(id)!.undo();
    const now = s.getThread(id)!;
    expect(now.status).toBe('active');
    expect(now.nextStep).toBe(was.nextStep);
    expect(now.dueDate).toBe(was.dueDate);
    expect(s.snapshot().entries.find((e) => e.threadId === id)?.stepDone).toBeFalsy();
    expect(reminders.at(-1)).toMatchObject({ id, status: 'active', dueDate: was.dueDate });
  });

  it('a project: Done finishes it but leaves its open steps as they were', () => {
    const s = mountStore();
    const id = shopThread(s, { kind: 'project', title: 'Website' });
    s.completeItem(id);
    expect(s.getThread(id)?.status).toBe('completed');
    expect(s.snapshot().entries.find((e) => e.threadId === id)?.stepDone).toBeFalsy();
  });

  it('finishing one thread touches no other', () => {
    const s = mountStore();
    const a = shopThread(s);
    const b = shopThread(s, { title: 'Pay the tailor' });
    const other = JSON.stringify([s.getThread(b), s.snapshot().entries.filter((e) => e.threadId === b)]);
    s.completeItem(a);
    expect(JSON.stringify([s.getThread(b), s.snapshot().entries.filter((e) => e.threadId === b)])).toBe(other);
  });
});
