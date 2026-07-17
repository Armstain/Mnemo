import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { MnemoItem, Category, ItemStatus } from '@/types/mnemo';
import { migrateStoredData } from '@/utils/migration';

// ─── Storage keys ───────────────────────────────────────────────
const STORAGE_KEY_V2 = 'mnemo-items-v2';
const LEGACY_STORAGE_KEY = 'mnemo-work-contexts';

// ─── Store interface ────────────────────────────────────────────
interface MnemoStoreType {
  items: MnemoItem[];
  isLoaded: boolean;

  // CRUD
  addItem: (item: Omit<MnemoItem, 'id' | 'createdAt' | 'updatedAt'>) => MnemoItem;
  updateItem: (id: string, updates: Partial<MnemoItem>) => void;
  deleteItem: (id: string) => void;

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

// Items live in AsyncStorage (localStorage on web). SecureStore is only read
// during migration: it has a ~2KB per-value limit on Android, so it cannot
// hold a growing item list — early builds stored it there anyway.
async function readStorage(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return localStorage.getItem(key);
  }
  return AsyncStorage.getItem(key);
}

async function writeStorage(key: string, data: string): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.setItem(key, data);
  } else {
    await AsyncStorage.setItem(key, data);
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

// ─── Provider ───────────────────────────────────────────────────
export function MnemoStoreProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<MnemoItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load & migrate on mount
  useEffect(() => {
    async function load() {
      try {
        // 1. Current home: AsyncStorage (localStorage on web)
        const stored = await readStorage(STORAGE_KEY_V2);
        if (stored) {
          const parsed = JSON.parse(stored);
          setItems(Array.isArray(parsed) ? parsed : []);
          return;
        }

        // 2. Older builds kept v2 items in SecureStore — move them over.
        const secureV2 = await readSecureLegacy(STORAGE_KEY_V2);
        if (secureV2) {
          const parsed = JSON.parse(secureV2);
          if (Array.isArray(parsed)) {
            setItems(parsed);
            await writeStorage(STORAGE_KEY_V2, secureV2);
            await removeSecureLegacy(STORAGE_KEY_V2);
            return;
          }
        }

        // 3. Oldest format: legacy context dumps.
        const legacy =
          (await readStorage(LEGACY_STORAGE_KEY)) ??
          (await readSecureLegacy(LEGACY_STORAGE_KEY));
        if (legacy) {
          const parsed = JSON.parse(legacy);
          if (Array.isArray(parsed)) {
            const migrated = migrateStoredData(parsed);
            setItems(migrated);
            await writeStorage(STORAGE_KEY_V2, JSON.stringify(migrated));
            await removeStorage(LEGACY_STORAGE_KEY);
            await removeSecureLegacy(LEGACY_STORAGE_KEY);
          }
        }
      } catch (e) {
        console.error('Failed to load items', e);
      } finally {
        setIsLoaded(true);
      }
    }
    load();
  }, []);

  // Persist whenever items change
  useEffect(() => {
    if (isLoaded) {
      writeStorage(STORAGE_KEY_V2, JSON.stringify(items));
    }
  }, [items, isLoaded]);

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
      return newItem;
    },
    [],
  );

  const updateItem = useCallback((id: string, updates: Partial<MnemoItem>) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, ...updates, updatedAt: Date.now() }
          : item,
      ),
    );
  }, []);

  const deleteItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
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
