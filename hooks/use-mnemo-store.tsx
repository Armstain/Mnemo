import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
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
} from '@/lib/db';
import { deriveThreadCache, generateEntryId, newestFirst } from '@/lib/threads';
import { deleteAllRecordings } from '@/lib/capture';
import { syncReminderForItem, cancelReminder, cancelAllReminders } from '@/lib/reminders';
import { UNDO_WINDOW_MS } from '@/hooks/use-undo-toast';

// ─── Legacy storage keys ────────────────────────────────────────
// SQLite (lib/db.ts) is now the source of truth. These are read exactly
// once, on first launch after this migration, to pull in existing data.
const STORAGE_KEY_V2 = 'mnemo-items-v2';
const LEGACY_STORAGE_KEY = 'mnemo-work-contexts';

/** What callers supply for a new entry; the store fills in ids and times. */
export type NewEntry = Omit<Entry, 'id' | 'threadId' | 'createdAt' | 'updatedAt' | 'filing'> & {
  filing?: Entry['filing'];
};

/** What callers supply for a new thread; its text comes from its first entry. */
export type NewThread = Omit<
  MnemoItem,
  'id' | 'createdAt' | 'updatedAt' | 'content' | 'checklistItems' | 'links' | 'type'
>;

// ─── Store interface ────────────────────────────────────────────
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
  deleteEntry: (id: string) => void;
  /** One thread's entries, newest first. */
  getEntries: (threadId: string) => Entry[];
  /** The thread as of right now, including changes made earlier in the same tick. */
  getThread: (id: string) => MnemoItem | undefined;

  // CRUD
  addItem: (item: Omit<MnemoItem, 'id' | 'createdAt' | 'updatedAt'>) => MnemoItem;
  updateItem: (id: string, updates: Partial<MnemoItem>) => void;
  /** Removes from view immediately; only persisted as gone after UNDO_WINDOW_MS unless undoDelete() is called first. */
  deleteItem: (id: string) => void;
  /** Restores an item removed by deleteItem, as long as its grace window hasn't lapsed. */
  undoDelete: (id: string) => void;
  /** Irreversibly wipes every item, embedding, and voice recording on disk. */
  clearAllData: () => Promise<void>;

  // Status transitions
  resumeItem: (id: string) => void;
  pauseItem: (id: string) => void;
  completeItem: (id: string) => void;
  archiveItem: (id: string) => void;

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
  'createThread' | 'addEntry' | 'updateEntry' | 'updateItem' | 'getThread'
>;

const StoreContext = createContext<MnemoStoreType | undefined>(undefined);

// ─── Helpers ────────────────────────────────────────────────────
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

/**
 * Reads whatever pre-SQLite data exists, in the same three-tier order the
 * app has always checked, without touching SQLite. Returns `[]` if there's
 * nothing to migrate.
 */
async function readLegacyItems(): Promise<MnemoItem[]> {
  // 1. Old current home: AsyncStorage (localStorage on web)
  const stored = await readStorage(STORAGE_KEY_V2);
  if (stored) {
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) return parsed;
  }

  // 2. Older builds kept v2 items in SecureStore.
  const secureV2 = await readSecureLegacy(STORAGE_KEY_V2);
  if (secureV2) {
    const parsed = JSON.parse(secureV2);
    if (Array.isArray(parsed)) return parsed;
  }

  // 3. Oldest format: legacy context dumps.
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

// ─── Provider ───────────────────────────────────────────────────
export function MnemoStoreProvider({ children }: { children: React.ReactNode }) {
  // The refs are the synchronous source of truth for CRUD callbacks (which
  // keep stable `[]` identities and may run several mutations in one tick,
  // e.g. create a thread then add to it); state mirrors them for rendering.
  // Every mutation goes through commitItems/commitEntries to keep both in step.
  const itemsRef = useRef<MnemoItem[]>([]);
  const entriesRef = useRef<Entry[]>([]);
  const [items, setItems] = useState<MnemoItem[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  const commitItems = (next: MnemoItem[]) => {
    itemsRef.current = next;
    setItems(next);
  };
  const commitEntries = (next: Entry[]) => {
    entriesRef.current = next;
    setEntries(next);
  };

  // Load on mount: SQLite is the source of truth once it has any rows.
  // On the very first run after this migration, SQLite is empty, so we
  // pull in whatever the old AsyncStorage/SecureStore chain has, write it
  // into SQLite once, and stop touching the old keys from then on.
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
        commitItems(loaded);
        commitEntries(await getAllEntries());
      } catch (e) {
        console.error('Failed to load items', e);
      } finally {
        setIsLoaded(true);
      }
    }
    load();
  }, []);


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

  const updateItem = useCallback((id: string, updates: Partial<MnemoItem>) => {
    const updatedAt = Date.now();
    const current = itemsRef.current.find((item) => item.id === id);
    commitItems(
      itemsRef.current.map((item) => (item.id === id ? { ...item, ...updates, updatedAt } : item)),
    );
    updatePartialItem(id, { ...updates, updatedAt }).catch((e) =>
      console.error('Failed to persist item update', e),
    );

    // Only re-sync the reminder when a field it actually depends on
    // changed — avoids a redundant cancel+reschedule round trip on every
    // unrelated edit (title tweak, category change, etc).
    if ('dueDate' in updates || 'status' in updates || 'title' in updates) {
      if (current) syncReminderForItem({ ...current, ...updates });
    }
  }, []);

  // ─── Entries ────────────────────────────────────────────────
  // After any entry change, the thread's derived text cache and its
  // left-off / next step (unless the user pinned them) follow its entries.
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
        updates.nextStep = threadEntries.find((e) => e.nextStep)?.nextStep ?? thread.nextStep;
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

  const deleteEntry = useCallback(
    (id: string) => {
      const current = entriesRef.current.find((e) => e.id === id);
      if (!current) return;
      commitEntries(entriesRef.current.filter((e) => e.id !== id));
      deleteEntryRow(id).catch((e) => console.error('Failed to delete entry', e));
      syncThreadFromEntries(current.threadId);
    },
    [syncThreadFromEntries],
  );

  const createThread = useCallback(
    (thread: NewThread, input: NewEntry) => {
      const created = addItem({ ...thread, content: '', links: [], type: 'note' });
      const entry = addEntry(created.id, input);
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

  const getEntries = useCallback(
    (threadId: string) => entriesByThread.get(threadId) ?? [],
    [entriesByThread],
  );

  // Snapshots of items pulled out of view by deleteItem, keyed by id, so
  // undoDelete can put them back before the grace-period timer commits the
  // delete to SQLite. If the app is killed mid-window the timer never
  // fires and the row survives in the DB — reload just brings it back,
  // which is the safe failure mode for a "delete" action.
  const removedItemsRef = useRef<Record<string, MnemoItem>>({});
  const deleteTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const deleteItem = useCallback((id: string) => {
    const found = itemsRef.current.find((item) => item.id === id);
    if (found) removedItemsRef.current[id] = found;
    commitItems(itemsRef.current.filter((item) => item.id !== id));
    // Cancel immediately, matching "removed from view" — undoDelete
    // reschedules it if the item comes back within the grace window.
    cancelReminder(id);

    deleteTimersRef.current[id] = setTimeout(() => {
      delete removedItemsRef.current[id];
      delete deleteTimersRef.current[id];
      // Its entries go too, now that the delete is final.
      commitEntries(entriesRef.current.filter((e) => e.threadId !== id));
      deleteItemRow(id).catch((e) => console.error('Failed to persist item delete', e));
    }, UNDO_WINDOW_MS);
  }, []);

  const undoDelete = useCallback((id: string) => {
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
  }, []);

  const clearAllData = useCallback(async () => {
    // Cancel every in-flight undo-delete timer first — otherwise one could
    // still fire after the wipe and try to persist a delete for a row
    // that's already gone.
    Object.values(deleteTimersRef.current).forEach(clearTimeout);
    deleteTimersRef.current = {};
    removedItemsRef.current = {};

    await deleteAllItems();
    deleteAllRecordings();
    await cancelAllReminders();
    commitItems([]);
    commitEntries([]);
  }, []);

  // ─── Status transitions ─────────────────────────────────────
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
      updateItem(id, { status: 'completed' });
    },
    [updateItem],
  );

  const archiveItem = useCallback(
    (id: string) => {
      updateItem(id, { status: 'archived' });
    },
    [updateItem],
  );

  // ─── Filtered views ─────────────────────────────────────────
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
      addItem,
      updateItem,
      deleteItem,
      undoDelete,
      clearAllData,
      resumeItem,
      pauseItem,
      completeItem,
      archiveItem,
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
      addItem,
      updateItem,
      deleteItem,
      undoDelete,
      clearAllData,
      resumeItem,
      pauseItem,
      completeItem,
      archiveItem,
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

// ─── Hook ───────────────────────────────────────────────────────
export function useMnemoStore() {
  const context = useContext(StoreContext);
  if (context === undefined) {
    throw new Error('useMnemoStore must be used within a MnemoStoreProvider');
  }
  return context;
}
