import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { MnemoItem, Category, ItemStatus } from '@/types/mnemo';
import { migrateStoredData } from '@/utils/migration';
import { initDb, countItems, getAllItems, insertItem, insertItems, updatePartialItem, deleteItemRow, deleteAllItems } from '@/lib/db';
import { deleteAllRecordings } from '@/lib/capture';
import { UNDO_WINDOW_MS } from '@/hooks/use-undo-toast';

// ─── Legacy storage keys ────────────────────────────────────────
// SQLite (lib/db.ts) is now the source of truth. These are read exactly
// once, on first launch after this migration, to pull in existing data.
const STORAGE_KEY_V2 = 'mnemo-items-v2';
const LEGACY_STORAGE_KEY = 'mnemo-work-contexts';

// ─── Store interface ────────────────────────────────────────────
interface MnemoStoreType {
  items: MnemoItem[];
  isLoaded: boolean;

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
  const [items, setItems] = useState<MnemoItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load on mount: SQLite is the source of truth once it has any rows.
  // On the very first run after this migration, SQLite is empty, so we
  // pull in whatever the old AsyncStorage/SecureStore chain has, write it
  // into SQLite once, and stop touching the old keys from then on.
  useEffect(() => {
    async function load() {
      try {
        await initDb();

        const existing = await countItems();
        if (existing > 0) {
          setItems(await getAllItems());
          return;
        }

        const legacyItems = await readLegacyItems();
        if (legacyItems.length > 0) {
          await insertItems(legacyItems);
          await clearLegacyStorage();
        }
        setItems(legacyItems);
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
      setItems((prev) => [newItem, ...prev]);
      insertItem(newItem).catch((e) => console.error('Failed to persist new item', e));
      return newItem;
    },
    [],
  );

  const updateItem = useCallback((id: string, updates: Partial<MnemoItem>) => {
    const updatedAt = Date.now();
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, ...updates, updatedAt } : item,
      ),
    );
    updatePartialItem(id, { ...updates, updatedAt }).catch((e) =>
      console.error('Failed to persist item update', e),
    );
  }, []);

  // Snapshots of items pulled out of view by deleteItem, keyed by id, so
  // undoDelete can put them back before the grace-period timer commits the
  // delete to SQLite. If the app is killed mid-window the timer never
  // fires and the row survives in the DB — reload just brings it back,
  // which is the safe failure mode for a "delete" action.
  const removedItemsRef = useRef<Record<string, MnemoItem>>({});
  const deleteTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const deleteItem = useCallback((id: string) => {
    setItems((prev) => {
      const found = prev.find((item) => item.id === id);
      if (found) removedItemsRef.current[id] = found;
      return prev.filter((item) => item.id !== id);
    });

    deleteTimersRef.current[id] = setTimeout(() => {
      delete removedItemsRef.current[id];
      delete deleteTimersRef.current[id];
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

    setItems((prev) => (prev.some((item) => item.id === id) ? prev : [restored, ...prev]));
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
    setItems([]);
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
      isLoaded,
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
      isLoaded,
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
