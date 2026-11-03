import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';
import type { MnemoItem, Category, ItemStatus, Entry } from '@/types/mnemo';
import { migrateStoredData } from '@/utils/migration';
import {
  initDb,
  countItems,
  getAllItems,
  insertItem,
  insertItems,
  updatePartialItem,
  deleteItemRow,
  deleteAllItems,
  ensureEntriesForItems,
  getAllEntries,
  insertEntry,
  deleteEntryRow,
  saveThreadsAndEntries,
} from '@/lib/db';
import { mergeBackup, type BackupPayload, type MergeResult } from '@/lib/backup';
import { deriveThreadCache, generateEntryId, newestFirst } from '@/lib/threads';
import { deleteAllRecordings } from '@/lib/capture';
import { syncReminderForItem, cancelReminder, cancelAllReminders } from '@/lib/reminders';
import { removeAllPlaces } from '@/lib/place-store';
import { afterReminder, nextOccurrence } from '@/lib/when';
import { deleteAllImages, forgetImages, restoreImage } from '@/lib/images';
import { UNDO_WINDOW_MS } from '@/hooks/use-undo-toast';
import { focusIsIdle } from '@/lib/filing';

// Legacy keys: read once to migrate into SQLite (lib/db.ts), the source of truth.
const STORAGE_KEY_V2 = 'mnemo-items-v2';
const LEGACY_STORAGE_KEY = 'mnemo-work-contexts';
/** The thread quick captures go to, if the person picked one: `{ id, since }`. */
const FOCUS_KEY = 'mnemo-focus-thread';

function parseFocus(raw: string | null): { id: string; since: number } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === 'string') {
      return { id: parsed.id, since: Number(parsed.since) || Date.now() };
    }
  } catch {
    // Written by an earlier build as a bare id.
  }
  return { id: raw, since: Date.now() };
}

/** What callers supply for a new entry; the store fills in ids and times. */
export type NewEntry = Omit<Entry, 'id' | 'threadId' | 'createdAt' | 'updatedAt' | 'filing'> & {
  filing?: Entry['filing'];
};

/** What callers supply for a new thread; its text comes from its first entry. */
export type NewThread = Omit<
  MnemoItem,
  'id' | 'createdAt' | 'updatedAt' | 'content' | 'checklistItems' | 'links' | 'type'
>;

interface MnemoStoreType {
  items: MnemoItem[];
  /** Every entry of every thread. Use `getEntries` for one thread's timeline. */
  entries: Entry[];
  isLoaded: boolean;

  // Threads & entries
  /** Starts a thread with its first entry. */
  createThread: (thread: NewThread, entry: NewEntry) => { thread: MnemoItem; entry: Entry };
  /** Adds an entry to an existing thread; the thread's next step and text follow it. */
  addEntry: (threadId: string, entry: NewEntry) => Entry;
  updateEntry: (id: string, updates: Partial<Omit<Entry, 'id' | 'threadId'>>) => void;
  /** Undoable removal; the thread goes too if this was its last entry. Returns whether it did. */
  deleteEntry: (id: string) => { threadRemoved: boolean };
  undoDeleteEntry: (id: string) => void;
  /** Ticks off the next step (a one-off reminder for it goes too). Returns an undo. */
  completeNextStep: (threadId: string) => () => void;
  /** One thread's entries, newest first. */
  getEntries: (threadId: string) => Entry[];
  /** The thread as of right now, including changes made earlier in the same tick. */
  getThread: (id: string) => MnemoItem | undefined;
  /** Every thread and entry as of right now, for background work outside render. */
  snapshot: () => { items: MnemoItem[]; entries: Entry[] };
  /** Moves an entry into another thread; both threads' text and next step follow. */
  moveEntry: (entryId: string, toThreadId: string, filing: Entry['filing']) => void;
  /** Gives an entry a thread of its own (Undo of an auto-file, or "Keep separate"). */
  moveEntryToNewThread: (
    entryId: string,
    thread: Pick<MnemoItem, 'title' | 'category' | 'tags'>,
  ) => MnemoItem | undefined;
  /** Deletes a thread at once, without the undo window. For a thread left empty by a move. */
  removeThreadNow: (id: string) => void;

  // Focus: the thread quick captures go to while it's set (a trip, a project).
  focusThreadId: string | null;
  setFocusThread: (id: string | null) => void;
  /** Current focus, readable outside render. */
  getFocusThreadId: () => string | null;

  // CRUD
  addItem: (item: Omit<MnemoItem, 'id' | 'createdAt' | 'updatedAt'>) => MnemoItem;
  /** Moves updatedAt unless `touch: false` (snoozes, undos that restore updatedAt). */
  updateItem: (id: string, updates: Partial<MnemoItem>, opts?: { touch?: boolean }) => void;
  /** Removes from view immediately; only persisted as gone after UNDO_WINDOW_MS unless undoDelete() is called first. */
  deleteItem: (id: string) => void;
  /** Restores an item removed by deleteItem, as long as its grace window hasn't lapsed. */
  undoDelete: (id: string) => void;
  /** Irreversibly wipes every thread, entry, embedding, photo and reminder on this phone. */
  clearAllData: () => Promise<void>;
  /** Everything to put in an encrypted backup. */
  exportBackup: () => BackupPayload;
  /** Merges a decrypted backup in (nothing here is deleted; newer copies win). */
  importBackup: (payload: BackupPayload) => Promise<Omit<MergeResult, 'items' | 'entries'>>;

  // Status transitions
  resumeItem: (id: string) => void;
  pauseItem: (id: string) => void;
  completeItem: (id: string) => void;
  archiveItem: (id: string) => void;
  /** Undo for a status change: the thread's status and timestamps as they were in `prev`. */
  restoreItem: (prev: MnemoItem) => void;

  // Filtered views
  getActiveItems: () => MnemoItem[];
  getByCategory: (category: Category) => MnemoItem[];
  getByStatus: (status: ItemStatus) => MnemoItem[];
  getTodayItems: () => MnemoItem[];
  getRecentlyCompleted: (limit?: number) => MnemoItem[];
}

/** The slice of the store the capture pipeline (lib/capture.ts) works through. */
export type CaptureStore = Pick<
  MnemoStoreType,
  | 'createThread'
  | 'addEntry'
  | 'updateEntry'
  | 'updateItem'
  | 'getThread'
  | 'snapshot'
  | 'moveEntry'
  | 'moveEntryToNewThread'
  | 'removeThreadNow'
  | 'getFocusThreadId'
>;

const StoreContext = createContext<MnemoStoreType | undefined>(undefined);

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
}

function isToday(timestamp: number): boolean {
  const d = new Date(timestamp);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

async function readStorage(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return localStorage.getItem(key);
  }
  return AsyncStorage.getItem(key);
}

async function writeStorage(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.setItem(key, value);
  } else {
    await AsyncStorage.setItem(key, value);
  }
}

async function removeStorage(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.removeItem(key);
  } else {
    await AsyncStorage.removeItem(key);
  }
}

/** Read a legacy value that older builds kept in SecureStore (native only). */
async function readSecureLegacy(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function removeSecureLegacy(key: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Nothing to clean up.
  }
}

/** Pre-SQLite data in the old three-tier order, or `[]`. */
async function readLegacyItems(): Promise<MnemoItem[]> {
  const stored = await readStorage(STORAGE_KEY_V2);
  if (stored) {
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) return parsed;
  }

  const secureV2 = await readSecureLegacy(STORAGE_KEY_V2);
  if (secureV2) {
    const parsed = JSON.parse(secureV2);
    if (Array.isArray(parsed)) return parsed;
  }

  const legacy =
    (await readStorage(LEGACY_STORAGE_KEY)) ?? (await readSecureLegacy(LEGACY_STORAGE_KEY));
  if (legacy) {
    const parsed = JSON.parse(legacy);
    if (Array.isArray(parsed)) return migrateStoredData(parsed);
  }

  return [];
}

async function clearLegacyStorage(): Promise<void> {
  await removeStorage(STORAGE_KEY_V2);
  await removeStorage(LEGACY_STORAGE_KEY);
  await removeSecureLegacy(STORAGE_KEY_V2);
  await removeSecureLegacy(LEGACY_STORAGE_KEY);
}

export function MnemoStoreProvider({ children }: { children: React.ReactNode }) {
  // Refs are the sync source of truth (callbacks are stable and may chain mutations in one tick); state mirrors them. Mutate via commitItems/commitEntries.
  const itemsRef = useRef<MnemoItem[]>([]);
  const entriesRef = useRef<Entry[]>([]);
  const [items, setItems] = useState<MnemoItem[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const focusRef = useRef<string | null>(null);
  const focusSinceRef = useRef(0);
  const [focusThreadId, setFocusState] = useState<string | null>(null);

  const setFocusThread = useCallback((id: string | null) => {
    focusRef.current = id;
    focusSinceRef.current = id ? Date.now() : 0;
    setFocusState(id);
    (id
      ? writeStorage(FOCUS_KEY, JSON.stringify({ id, since: focusSinceRef.current }))
      : removeStorage(FOCUS_KEY)
    ).catch(() => {
      // Losing the focus on restart is harmless; it's one tap to set again.
    });
  }, []);

  /** Drops focus once the thread has been idle for days. Returns the focus still current. */
  const expireIdleFocus = useCallback((): string | null => {
    const id = focusRef.current;
    if (!id) return null;
    const thread = itemsRef.current.find((i) => i.id === id);
    const open = thread && (thread.status === 'active' || thread.status === 'paused');
    if (!open || focusIsIdle({ threadId: id, since: focusSinceRef.current, entries: entriesRef.current })) {
      setFocusThread(null);
      return null;
    }
    return id;
  }, [setFocusThread]);

  const commitItems = (next: MnemoItem[]) => {
    itemsRef.current = next;
    setItems(next);
  };
  const commitEntries = (next: Entry[]) => {
    entriesRef.current = next;
    setEntries(next);
  };

  // Empty SQLite means first run after migration: import legacy data once, then clear the old keys.
  useEffect(() => {
    async function load() {
      try {
        await initDb();

        let loaded: MnemoItem[];
        if ((await countItems()) > 0) {
          loaded = await getAllItems();
        } else {
          loaded = await readLegacyItems();
          if (loaded.length > 0) {
            await insertItems(loaded);
            await clearLegacyStorage();
          }
        }
        // Pre-threads notes get the one entry they are made of (no-op once done).
        await ensureEntriesForItems(loaded);
        // Repeating reminders that came round while closed show their next time, not "overdue".
        const now = Date.now();
        loaded = loaded.map((item) => {
          if (!item.repeat) return item;
          const ahead = item.laterSteps?.filter((l) => l.at > now);
          return {
            ...item,
            dueDate: item.dueDate && nextOccurrence(item.dueDate, item.repeat, now),
            laterSteps: ahead?.length ? ahead : undefined,
          };
        });
        commitItems(loaded);
        commitEntries(await getAllEntries());
        const focus = parseFocus(await readStorage(FOCUS_KEY));
        if (focus) {
          focusRef.current = focus.id;
          focusSinceRef.current = focus.since;
          setFocusState(focus.id);
          expireIdleFocus();
        }
      } catch (e) {
        console.error('Failed to load items', e);
      } finally {
        setIsLoaded(true);
      }
    }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') expireIdleFocus();
    });
    return () => sub.remove();
  }, [expireIdleFocus]);


  // ─── CRUD ───────────────────────────────────────────────────
  const addItem = useCallback(
    (item: Omit<MnemoItem, 'id' | 'createdAt' | 'updatedAt'>): MnemoItem => {
      const now = Date.now();
      const newItem: MnemoItem = {
        ...item,
        id: generateId(),
        createdAt: now,
        updatedAt: now,
      };
      commitItems([newItem, ...itemsRef.current]);
      insertItem(newItem).catch((e) => console.error('Failed to persist new item', e));
      syncReminderForItem(newItem);
      return newItem;
    },
    [],
  );

  const updateItem = useCallback((id: string, updates: Partial<MnemoItem>, opts?: { touch?: boolean }) => {
    const current = itemsRef.current.find((item) => item.id === id);
    const updatedAt = opts?.touch === false ? (updates.updatedAt ?? current?.updatedAt ?? Date.now()) : Date.now();
    commitItems(
      itemsRef.current.map((item) => (item.id === id ? { ...item, ...updates, updatedAt } : item)),
    );
    updatePartialItem(id, { ...updates, updatedAt }).catch((e) =>
      console.error('Failed to persist item update', e),
    );

    if (
      id === focusRef.current &&
      (updates.status === 'completed' || updates.status === 'archived')
    ) {
      setFocusThread(null);
    }

    // Only reschedule when a field the reminder depends on changed.
    if (['dueDate', 'status', 'title', 'repeat', 'nextStep', 'whereLeftOff', 'laterSteps'].some((k) => k in updates)) {
      if (current) syncReminderForItem({ ...current, ...updates });
    }
  }, [setFocusThread]);

  // Derived text, left-off and next step follow entries unless pinned.
  const syncThreadFromEntries = useCallback(
    (threadId: string) => {
      const thread = itemsRef.current.find((i) => i.id === threadId);
      if (!thread) return;
      const threadEntries = newestFirst(entriesRef.current.filter((e) => e.threadId === threadId));
      const updates: Partial<MnemoItem> = deriveThreadCache(threadEntries);
      if (!thread.pinned?.whereLeftOff) {
        updates.whereLeftOff = threadEntries.find((e) => e.leftOff)?.leftOff ?? thread.whereLeftOff;
      }
      if (!thread.pinned?.nextStep) {
        // All entry steps done means none; notes without entry steps keep theirs.
        const open = threadEntries.find((e) => e.nextStep && !e.stepDone)?.nextStep;
        updates.nextStep = open ?? (threadEntries.some((e) => e.nextStep) ? undefined : thread.nextStep);
      }
      updateItem(threadId, updates);
    },
    [updateItem],
  );

  const addEntry = useCallback(
    (threadId: string, input: NewEntry): Entry => {
      const now = Date.now();
      const entry: Entry = {
        filing: { by: 'user' },
        ...input,
        id: generateEntryId(),
        threadId,
        createdAt: now,
        updatedAt: now,
      };
      commitEntries([...entriesRef.current, entry]);
      insertEntry(entry).catch((e) => console.error('Failed to persist new entry', e));
      syncThreadFromEntries(threadId);
      return entry;
    },
    [syncThreadFromEntries],
  );

  const updateEntry = useCallback(
    (id: string, updates: Partial<Omit<Entry, 'id' | 'threadId'>>) => {
      const current = entriesRef.current.find((e) => e.id === id);
      if (!current) return;
      const next: Entry = { ...current, ...updates, updatedAt: Date.now() };
      commitEntries(entriesRef.current.map((e) => (e.id === id ? next : e)));
      insertEntry(next).catch((e) => console.error('Failed to persist entry update', e));
      syncThreadFromEntries(current.threadId);
    },
    [syncThreadFromEntries],
  );

  // deleteItem and undoDelete are defined further down, so reached through refs.
  const deleteItemRef = useRef<((id: string) => void) | null>(null);
  const undoDeleteRef = useRef<((id: string) => void) | null>(null);
  const removedEntriesRef = useRef<Record<string, { entry: Entry; threadRemoved: boolean }>>({});
  const entryTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const deleteEntry = useCallback(
    (id: string) => {
      const current = entriesRef.current.find((e) => e.id === id);
      if (!current) return { threadRemoved: false };
      const lastOne = !entriesRef.current.some((e) => e.id !== id && e.threadId === current.threadId);
      removedEntriesRef.current[id] = { entry: current, threadRemoved: lastOne };
      commitEntries(entriesRef.current.filter((e) => e.id !== id));
      if (lastOne) {
        deleteItemRef.current?.(current.threadId);
      } else {
        syncThreadFromEntries(current.threadId);
      }
      entryTimersRef.current[id] = setTimeout(() => {
        delete removedEntriesRef.current[id];
        delete entryTimersRef.current[id];
        forgetImages([current]);
        deleteEntryRow(id).catch((e) => console.error('Failed to delete entry', e));
      }, UNDO_WINDOW_MS);
      return { threadRemoved: lastOne };
    },
    [syncThreadFromEntries],
  );

  const undoDeleteEntry = useCallback(
    (id: string) => {
      const removed = removedEntriesRef.current[id];
      if (!removed) return;
      clearTimeout(entryTimersRef.current[id]);
      delete entryTimersRef.current[id];
      delete removedEntriesRef.current[id];
      if (removed.threadRemoved) undoDeleteRef.current?.(removed.entry.threadId);
      if (!entriesRef.current.some((e) => e.id === id)) commitEntries([...entriesRef.current, removed.entry]);
      syncThreadFromEntries(removed.entry.threadId);
    },
    [syncThreadFromEntries],
  );

  const completeNextStep = useCallback(
    (threadId: string) => {
      const thread = itemsRef.current.find((i) => i.id === threadId);
      if (!thread?.nextStep) return () => {};
      const step = thread.nextStep;
      const before = { nextStep: thread.nextStep, pinned: thread.pinned, dueDate: thread.dueDate, laterSteps: thread.laterSteps };
      const done = entriesRef.current.filter((e) => e.threadId === threadId && e.nextStep === step && !e.stepDone);
      for (const e of done) {
        const next = { ...e, stepDone: true, updatedAt: Date.now() };
        commitEntries(entriesRef.current.map((x) => (x.id === e.id ? next : x)));
        insertEntry(next).catch((err) => console.error('Failed to persist step done', err));
      }
      updateItem(
        threadId,
        thread.repeat ? { pinned: { ...thread.pinned, nextStep: false }, nextStep: undefined } : afterReminder(thread),
      );
      syncThreadFromEntries(threadId);
      return () => {
        for (const e of done) {
          const current = entriesRef.current.find((x) => x.id === e.id);
          if (!current) continue;
          const back = { ...current, stepDone: undefined, updatedAt: Date.now() };
          commitEntries(entriesRef.current.map((x) => (x.id === e.id ? back : x)));
          insertEntry(back).catch((err) => console.error('Failed to persist step undo', err));
        }
        updateItem(threadId, before);
      };
    },
    [updateItem, syncThreadFromEntries],
  );

  const createThread = useCallback(
    (thread: NewThread, input: NewEntry) => {
      const created = addItem({ ...thread, content: '', links: [], type: 'note' });
      // May still be filed into an existing thread later (lib/filing.ts).
      const entry = addEntry(created.id, { filing: { by: 'new' }, ...input });
      return { thread: itemsRef.current.find((i) => i.id === created.id) ?? created, entry };
    },
    [addItem, addEntry],
  );

  const entriesByThread = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const entry of entries) {
      const list = map.get(entry.threadId);
      if (list) list.push(entry);
      else map.set(entry.threadId, [entry]);
    }
    for (const [key, list] of map) map.set(key, newestFirst(list));
    return map;
  }, [entries]);

  const getThread = useCallback((id: string) => itemsRef.current.find((i) => i.id === id), []);

  const snapshot = useCallback(
    () => ({ items: itemsRef.current, entries: entriesRef.current }),
    [],
  );

  const getFocusThreadId = useCallback(() => expireIdleFocus(), [expireIdleFocus]);

  const moveEntry = useCallback(
    (entryId: string, toThreadId: string, filing: Entry['filing']) => {
      const current = entriesRef.current.find((e) => e.id === entryId);
      if (!current || current.threadId === toThreadId) return;
      if (!itemsRef.current.some((i) => i.id === toThreadId)) return;
      const next: Entry = { ...current, threadId: toThreadId, filing, updatedAt: Date.now() };
      commitEntries(entriesRef.current.map((e) => (e.id === entryId ? next : e)));
      insertEntry(next).catch((e) => console.error('Failed to persist entry move', e));
      syncThreadFromEntries(current.threadId);
      syncThreadFromEntries(toThreadId);
    },
    [syncThreadFromEntries],
  );

  const removeThreadNow = useCallback(
    (id: string) => {
      commitItems(itemsRef.current.filter((i) => i.id !== id));
      commitEntries(entriesRef.current.filter((e) => e.threadId !== id));
      cancelReminder(id);
      if (focusRef.current === id) setFocusThread(null);
      deleteItemRow(id).catch((e) => console.error('Failed to delete thread', e));
    },
    [setFocusThread],
  );

  const moveEntryToNewThread = useCallback(
    (entryId: string, thread: Pick<MnemoItem, 'title' | 'category' | 'tags'>) => {
      const current = entriesRef.current.find((e) => e.id === entryId);
      if (!current) return undefined;
      const created = addItem({
        ...thread,
        status: 'active',
        content: '',
        links: [],
        type: 'note',
      });
      moveEntry(entryId, created.id, { by: 'user' });
      return itemsRef.current.find((i) => i.id === created.id);
    },
    [addItem, moveEntry],
  );

  const getEntries = useCallback(
    (threadId: string) => entriesByThread.get(threadId) ?? [],
    [entriesByThread],
  );

  // If the app dies mid-window the row survives in the DB and reload restores it (safe failure).
  const removedItemsRef = useRef<Record<string, MnemoItem>>({});
  deleteItemRef.current = (id: string) => deleteItemImpl(id);
  undoDeleteRef.current = (id: string) => undoDeleteImpl(id);
  const deleteTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  function deleteItemImpl(id: string) {
    const found = itemsRef.current.find((item) => item.id === id);
    if (found) removedItemsRef.current[id] = found;
    if (focusRef.current === id) setFocusThread(null);
    commitItems(itemsRef.current.filter((item) => item.id !== id));
    // undoDelete reschedules it.
    cancelReminder(id);

    deleteTimersRef.current[id] = setTimeout(() => {
      delete removedItemsRef.current[id];
      delete deleteTimersRef.current[id];
      forgetImages(entriesRef.current.filter((e) => e.threadId === id));
      commitEntries(entriesRef.current.filter((e) => e.threadId !== id));
      deleteItemRow(id).catch((e) => console.error('Failed to persist item delete', e));
    }, UNDO_WINDOW_MS);
  }

  function undoDeleteImpl(id: string) {
    const timer = deleteTimersRef.current[id];
    if (timer) clearTimeout(timer);
    delete deleteTimersRef.current[id];

    const restored = removedItemsRef.current[id];
    if (!restored) return;
    delete removedItemsRef.current[id];

    if (!itemsRef.current.some((item) => item.id === id)) {
      commitItems([restored, ...itemsRef.current]);
    }
    syncReminderForItem(restored);
  }

  const deleteItem = useCallback((id: string) => deleteItemRef.current?.(id), []);
  const undoDelete = useCallback((id: string) => undoDeleteRef.current?.(id), []);

  const clearAllData = useCallback(async () => {
    // Clear pending undo timers first so none fires after the wipe.
    Object.values(deleteTimersRef.current).forEach(clearTimeout);
    deleteTimersRef.current = {};
    removedItemsRef.current = {};
    Object.values(entryTimersRef.current).forEach(clearTimeout);
    entryTimersRef.current = {};
    removedEntriesRef.current = {};

    await deleteAllItems();
    deleteAllRecordings();
    deleteAllImages();
    await cancelAllReminders();
    await removeAllPlaces();
    commitItems([]);
    commitEntries([]);
    setFocusThread(null);
  }, [setFocusThread]);

  const exportBackup = useCallback(
    (): BackupPayload => ({
      app: 'mnemo',
      exportedAt: Date.now(),
      items: itemsRef.current.filter((i) => !removedItemsRef.current[i.id]),
      entries: entriesRef.current.filter((e) => !removedItemsRef.current[e.threadId]),
    }),
    [],
  );

  const importBackup = useCallback(async (payload: BackupPayload) => {
    for (const [name, data] of Object.entries(payload.images ?? {})) {
      try {
        restoreImage(name, data);
      } catch {
        // A photo that can't be written shows as "not on this phone".
      }
    }
    const merged = mergeBackup({ items: itemsRef.current, entries: entriesRef.current }, payload);
    // Persist first: if the write fails, nothing on screen claims it worked.
    await saveThreadsAndEntries(merged.items, merged.entries);
    commitItems(merged.items);
    commitEntries(merged.entries);
    merged.items.forEach((item) => syncReminderForItem(item));
    return { added: merged.added, updated: merged.updated, unchanged: merged.unchanged };
  }, []);

  const resumeItem = useCallback(
    (id: string) => {
      updateItem(id, { status: 'active', lastResumedAt: Date.now() });
    },
    [updateItem],
  );

  const pauseItem = useCallback(
    (id: string) => {
      updateItem(id, { status: 'paused' });
    },
    [updateItem],
  );

  const completeItem = useCallback(
    (id: string) => {
      updateItem(id, { status: 'completed', completedAt: Date.now() });
    },
    [updateItem],
  );

  const archiveItem = useCallback(
    (id: string) => {
      updateItem(id, { status: 'archived' });
    },
    [updateItem],
  );

  const restoreItem = useCallback(
    (prev: MnemoItem) => {
      const { status, completedAt, quietUntil, lastResumedAt, updatedAt } = prev;
      updateItem(prev.id, { status, completedAt, quietUntil, lastResumedAt, updatedAt }, { touch: false });
    },
    [updateItem],
  );

  const getActiveItems = useCallback(
    () =>
      items
        .filter((i) => i.status === 'active' || i.status === 'paused')
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [items],
  );

  const getByCategory = useCallback(
    (category: Category) => items.filter((i) => i.category === category),
    [items],
  );

  const getByStatus = useCallback(
    (status: ItemStatus) => items.filter((i) => i.status === status),
    [items],
  );

  const getTodayItems = useCallback(
    () =>
      items
        .filter(
          (i) =>
            i.dueDate &&
            isToday(i.dueDate) &&
            i.status !== 'completed' &&
            i.status !== 'archived',
        )
        .sort((a, b) => (a.dueDate ?? 0) - (b.dueDate ?? 0)),
    [items],
  );

  const getRecentlyCompleted = useCallback(
    (limit = 3) =>
      items
        .filter((i) => i.status === 'completed')
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit),
    [items],
  );

  const value = useMemo<MnemoStoreType>(
    () => ({
      items,
      entries,
      isLoaded,
      createThread,
      addEntry,
      updateEntry,
      deleteEntry,
      getEntries,
      getThread,
      snapshot,
      moveEntry,
      moveEntryToNewThread,
      removeThreadNow,
      focusThreadId,
      setFocusThread,
      getFocusThreadId,
      addItem,
      updateItem,
      deleteItem,
      undoDelete,
      undoDeleteEntry,
      completeNextStep,
      clearAllData,
      exportBackup,
      importBackup,
      resumeItem,
      pauseItem,
      completeItem,
      archiveItem,
      restoreItem,
      getActiveItems,
      getByCategory,
      getByStatus,
      getTodayItems,
      getRecentlyCompleted,
    }),
    [
      items,
      entries,
      isLoaded,
      createThread,
      addEntry,
      updateEntry,
      deleteEntry,
      getEntries,
      getThread,
      snapshot,
      moveEntry,
      moveEntryToNewThread,
      removeThreadNow,
      focusThreadId,
      setFocusThread,
      getFocusThreadId,
      addItem,
      updateItem,
      deleteItem,
      undoDelete,
      undoDeleteEntry,
      completeNextStep,
      clearAllData,
      exportBackup,
      importBackup,
      resumeItem,
      pauseItem,
      completeItem,
      archiveItem,
      restoreItem,
      getActiveItems,
      getByCategory,
      getByStatus,
      getTodayItems,
      getRecentlyCompleted,
    ],
  );

  return (
    <StoreContext.Provider value={value}>
      {children}
    </StoreContext.Provider>
  );
}

export function useMnemoStore() {
  const context = useContext(StoreContext);
  if (context === undefined) {
    throw new Error('useMnemoStore must be used within a MnemoStoreProvider');
  }
  return context;
}
