import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import { isOpenStatus, type MnemoItem, type Entry } from '@/types/mnemo';
import { UNDO_WINDOW_MS, type CaptureStore, type FileResult, type NewEntry, type NewThread } from '@/types/store';
import { deleteAllAudio } from '@/lib/voice-audio';
import { clearLegacyStorage, readLegacyItems } from '@/lib/legacy-import';
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
import { deriveThreadCache, newestFirst } from '@/lib/threads';
import { generateId } from '@/lib/ids';
import { logError } from '@/lib/errors';
import { syncReminderForItem, cancelReminder, cancelAllReminders, REMINDER_FIELDS } from '@/lib/reminders';
import { removeAllPlaces } from '@/lib/place-store';
import { afterReminder, nextOccurrence } from '@/lib/when';
import { completeOccurrence } from '@/lib/places';
import { finishModel } from '@/lib/done';
import { foldReminders } from '@/lib/reminder-ownership';
import { deleteAllImages, forgetImages, restoreImage } from '@/lib/images';
import { focusIsIdle } from '@/lib/filing';
import { storage } from '@/lib/storage';

/** The thread quick captures go to, if the person picked one: `{ id, since }`. */
const FOCUS_KEY = 'mnemo-focus-thread';

interface Focus {
  id: string;
  since: number;
}

function parseFocus(raw: string | null): Focus | null {
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

function persist(work: Promise<unknown>, what: string): void {
  work.catch((e) => {
    console.error(`Failed to ${what}`, e);
    logError(what, e);
  });
}

interface MnemoStoreType extends CaptureStore {
  items: MnemoItem[];
  /** Every entry of every thread. Use `getEntries` for one thread's timeline. */
  entries: Entry[];
  isLoaded: boolean;

  /** Undoable removal; the thread goes too if this was its last entry. Returns whether it did. */
  deleteEntry: (id: string) => { threadRemoved: boolean };
  undoDeleteEntry: (id: string) => void;
  /** Ticks off the next step (a one-off reminder for it goes too). Returns an undo. */
  completeNextStep: (threadId: string) => () => void;
  /** One thread's entries, newest first. */
  getEntries: (threadId: string) => Entry[];

  /** The thread quick captures go to while it's set (a trip, a project). */
  focusThreadId: string | null;
  setFocusThread: (id: string | null) => void;

  addItem: (item: Omit<MnemoItem, 'id' | 'createdAt' | 'updatedAt'>) => MnemoItem;
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

  resumeItem: (id: string) => void;
  /**
   * Finishes the thread, once: a second call (double tap, two screens) does nothing and returns
   * null. A thread that is one thing to do (`finishModel` 'single') has its step ticked in the
   * same change. Returns the thread as it was and one undo for all of it.
   */
  completeItem: (id: string) => { before: MnemoItem; undo: () => void } | null;
  /**
   * Marks today's ring of the thread's place reminder done, and nothing else: the reminder, its
   * repeat and the thread stay as they are. Returns an undo, or null when there's nothing to complete.
   */
  completePlaceOccurrence: (id: string) => (() => void) | null;
  /** Undo for a status change: the thread's status and timestamps as they were in `prev`. */
  restoreItem: (prev: MnemoItem) => void;

  getActiveItems: () => MnemoItem[];
}

const StoreContext = createContext<MnemoStoreType | undefined>(undefined);

function createHeld<T>(onExpire: (id: string, value: T) => void) {
  const values = new Map<string, T>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  return {
    hold(id: string, value: T) {
      if (values.has(id)) return;
      values.set(id, value);
      timers.set(
        id,
        setTimeout(() => {
          values.delete(id);
          timers.delete(id);
          onExpire(id, value);
        }, UNDO_WINDOW_MS),
      );
    },
    take(id: string): T | undefined {
      clearTimeout(timers.get(id));
      timers.delete(id);
      const value = values.get(id);
      values.delete(id);
      return value;
    },
    clear() {
      timers.forEach(clearTimeout);
      timers.clear();
      values.clear();
    },
  };
}

export function MnemoStoreProvider({ children }: { children: React.ReactNode }) {
  // Refs are the sync source of truth (callbacks are stable and may chain mutations in one tick); state mirrors them. Mutate via commitItems/commitEntries.
  const itemsRef = useRef<MnemoItem[]>([]);
  const entriesRef = useRef<Entry[]>([]);
  const [items, setItems] = useState<MnemoItem[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const focusRef = useRef<Focus | null>(null);
  const [focusThreadId, setFocusState] = useState<string | null>(null);

  const setFocusThread = useCallback((id: string | null) => {
    const focus = id ? { id, since: Date.now() } : null;
    focusRef.current = focus;
    setFocusState(id);
    (focus ? storage.set(FOCUS_KEY, JSON.stringify(focus)) : storage.remove(FOCUS_KEY)).catch(() => {
      // Losing the focus on restart is harmless; it's one tap to set again.
    });
  }, []);

  /** Drops focus once the thread has been idle for days. Returns the focus still current. */
  const expireIdleFocus = useCallback((): string | null => {
    const focus = focusRef.current;
    if (!focus) return null;
    const thread = itemsRef.current.find((i) => i.id === focus.id);
    const open = thread && isOpenStatus(thread.status);
    if (!open || focusIsIdle({ threadId: focus.id, since: focus.since, entries: entriesRef.current })) {
      setFocusThread(null);
      return null;
    }
    return focus.id;
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
        const focus = parseFocus(await storage.get(FOCUS_KEY));
        if (focus) {
          focusRef.current = focus;
          setFocusState(focus.id);
          expireIdleFocus();
        }
      } catch (e) {
        console.error('Failed to load items', e);
        logError('load items', e);
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
      persist(insertItem(newItem), 'persist new item');
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
    persist(updatePartialItem(id, { ...updates, updatedAt }), 'persist item update');

    if (id === focusRef.current?.id && updates.status && !isOpenStatus(updates.status)) {
      setFocusThread(null);
    }

    if (REMINDER_FIELDS.some((k) => k in updates)) {
      if (current) syncReminderForItem({ ...current, ...updates });
    }
  }, [setFocusThread]);

  const saveEntry = (next: Entry, what: string) => {
    commitEntries(entriesRef.current.map((e) => (e.id === next.id ? next : e)));
    persist(insertEntry(next), what);
  };

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
        id: generateId('e'),
        threadId,
        createdAt: now,
        updatedAt: now,
      };
      commitEntries([...entriesRef.current, entry]);
      persist(insertEntry(entry), 'persist new entry');
      syncThreadFromEntries(threadId);
      return entry;
    },
    [syncThreadFromEntries],
  );

  const updateEntry = useCallback(
    (id: string, updates: Partial<Omit<Entry, 'id' | 'threadId'>>) => {
      const current = entriesRef.current.find((e) => e.id === id);
      if (!current) return;
      saveEntry({ ...current, ...updates, updatedAt: Date.now() }, 'persist entry update');
      syncThreadFromEntries(current.threadId);
    },
    [syncThreadFromEntries],
  );

  // Deleted but still undoable: out of view and out of every read at once, only dropped from disk when the
  // window lapses. If the app dies mid-window the row survives and the next load restores it (a safe failure).
  const [heldThreads] = useState(() =>
    createHeld<{ item?: MnemoItem; entries: Entry[] }>((id, { entries: gone }) => {
      forgetImages(gone);
      persist(deleteItemRow(id), 'delete thread');
    }),
  );
  const [heldEntries] = useState(() =>
    createHeld<{ entry: Entry; threadRemoved: boolean }>((id, { entry }) => {
      forgetImages([entry]);
      persist(deleteEntryRow(id), 'delete entry');
    }),
  );

  const deleteItem = useCallback(
    (id: string) => {
      const item = itemsRef.current.find((i) => i.id === id);
      const entriesOfThread = entriesRef.current.filter((e) => e.threadId === id);
      if (focusRef.current?.id === id) setFocusThread(null);
      commitItems(itemsRef.current.filter((i) => i.id !== id));
      commitEntries(entriesRef.current.filter((e) => e.threadId !== id));
      cancelReminder(id);
      heldThreads.hold(id, { item, entries: entriesOfThread });
    },
    [heldThreads, setFocusThread],
  );

  const undoDelete = useCallback(
    (id: string) => {
      const held = heldThreads.take(id);
      if (!held?.item) return;
      if (!itemsRef.current.some((i) => i.id === id)) commitItems([held.item, ...itemsRef.current]);
      const back = held.entries.filter((e) => !entriesRef.current.some((x) => x.id === e.id));
      if (back.length > 0) commitEntries([...entriesRef.current, ...back]);
      syncReminderForItem(held.item);
    },
    [heldThreads],
  );

  const deleteEntry = useCallback(
    (id: string) => {
      const current = entriesRef.current.find((e) => e.id === id);
      if (!current) return { threadRemoved: false };
      const lastOne = !entriesRef.current.some((e) => e.id !== id && e.threadId === current.threadId);
      commitEntries(entriesRef.current.filter((e) => e.id !== id));
      if (lastOne) deleteItem(current.threadId);
      else syncThreadFromEntries(current.threadId);
      heldEntries.hold(id, { entry: current, threadRemoved: lastOne });
      return { threadRemoved: lastOne };
    },
    [deleteItem, heldEntries, syncThreadFromEntries],
  );

  const undoDeleteEntry = useCallback(
    (id: string) => {
      const removed = heldEntries.take(id);
      if (!removed) return;
      if (removed.threadRemoved) undoDelete(removed.entry.threadId);
      if (!entriesRef.current.some((e) => e.id === id)) commitEntries([...entriesRef.current, removed.entry]);
      syncThreadFromEntries(removed.entry.threadId);
    },
    [heldEntries, syncThreadFromEntries, undoDelete],
  );

  const completeNextStep = useCallback(
    (threadId: string) => {
      const thread = itemsRef.current.find((i) => i.id === threadId);
      if (!thread?.nextStep) return () => {};
      const step = thread.nextStep;
      const before = { nextStep: thread.nextStep, pinned: thread.pinned, dueDate: thread.dueDate, laterSteps: thread.laterSteps };
      const done = entriesRef.current.filter((e) => e.threadId === threadId && e.nextStep === step && !e.stepDone);
      for (const e of done) saveEntry({ ...e, stepDone: true, updatedAt: Date.now() }, 'persist step done');
      updateItem(
        threadId,
        thread.repeat ? { pinned: { ...thread.pinned, nextStep: false }, nextStep: undefined } : afterReminder(thread),
      );
      syncThreadFromEntries(threadId);
      return () => {
        for (const e of done) {
          const current = entriesRef.current.find((x) => x.id === e.id);
          if (!current) continue;
          saveEntry({ ...current, stepDone: undefined, updatedAt: Date.now() }, 'persist step undo');
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

  const moveEntry = useCallback(
    (entryId: string, toThreadId: string, filing: Entry['filing']) => {
      const current = entriesRef.current.find((e) => e.id === entryId);
      if (!current || current.threadId === toThreadId) return;
      if (!itemsRef.current.some((i) => i.id === toThreadId)) return;
      saveEntry({ ...current, threadId: toThreadId, filing, updatedAt: Date.now() }, 'persist entry move');
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
      if (focusRef.current?.id === id) setFocusThread(null);
      persist(deleteItemRow(id), 'delete thread');
    },
    [setFocusThread],
  );

  const fileEntry = useCallback(
    (entryId: string, toThreadId: string, filing: Entry['filing']): FileResult => {
      const entry = entriesRef.current.find((e) => e.id === entryId);
      const to = itemsRef.current.find((i) => i.id === toThreadId);
      if (!entry || !to || entry.threadId === toThreadId) return { moved: false };
      const from = itemsRef.current.find((i) => i.id === entry.threadId);
      const last = !entriesRef.current.some((e) => e.threadId === entry.threadId && e.id !== entryId);
      if (!last || !from) {
        moveEntry(entryId, toThreadId, filing);
        return { moved: true };
      }
      // Checked before anything moves, so a refusal leaves both threads exactly as they were.
      const fold = foldReminders(from, to);
      if (!fold.ok) return { moved: false, reason: fold.reason };
      moveEntry(entryId, toThreadId, filing);
      if (Object.keys(fold.carry).length > 0) updateItem(to.id, fold.carry);
      removeThreadNow(from.id);
      return { moved: true, removedThreadId: from.id, carried: fold.carry };
    },
    [moveEntry, removeThreadNow, updateItem],
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
      // A new thread has no reminders, so a thread this empties hands its own over and goes.
      fileEntry(entryId, created.id, { by: 'user' });
      return itemsRef.current.find((i) => i.id === created.id);
    },
    [addItem, fileEntry],
  );

  const getEntries = useCallback(
    (threadId: string) => entriesByThread.get(threadId) ?? [],
    [entriesByThread],
  );

  const clearAllData = useCallback(async () => {
    heldThreads.clear();
    heldEntries.clear();

    await deleteAllItems();
    deleteAllAudio();
    deleteAllImages();
    await cancelAllReminders();
    await removeAllPlaces();
    commitItems([]);
    commitEntries([]);
    setFocusThread(null);
  }, [heldEntries, heldThreads, setFocusThread]);

  const exportBackup = useCallback(
    (): BackupPayload => ({
      app: 'mnemo',
      exportedAt: Date.now(),
      items: itemsRef.current,
      entries: entriesRef.current,
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

  const restoreItem = useCallback(
    (prev: MnemoItem) => {
      const { status, completedAt, quietUntil, lastResumedAt, updatedAt } = prev;
      updateItem(prev.id, { status, completedAt, quietUntil, lastResumedAt, updatedAt }, { touch: false });
    },
    [updateItem],
  );

  const completeItem = useCallback(
    (id: string) => {
      const before = itemsRef.current.find((i) => i.id === id);
      if (!before || before.status === 'completed') return null;
      const mine = entriesRef.current.filter((e) => e.threadId === id);
      // Its one step is the task: ticked with it, so it counts as done (not left "open" on a finished thread).
      const undoStep = before.nextStep && finishModel(before, mine) === 'single' ? completeNextStep(id) : null;
      updateItem(id, { status: 'completed', completedAt: Date.now() });
      return {
        before,
        undo: () => {
          undoStep?.();
          restoreItem(before);
        },
      };
    },
    [updateItem, completeNextStep, restoreItem],
  );

  const completePlaceOccurrence = useCallback(
    (id: string) => {
      const current = itemsRef.current.find((i) => i.id === id);
      const done = current?.place ? completeOccurrence(current.place, Date.now()) : null;
      if (!current?.place || !done) return null;
      const previous = current.place.doneAt;
      // Not activity on the thread: Home's order stays.
      updateItem(id, { place: done }, { touch: false });
      return () => {
        const place = itemsRef.current.find((i) => i.id === id)?.place;
        if (place) updateItem(id, { place: { ...place, doneAt: previous } }, { touch: false });
      };
    },
    [updateItem],
  );

  const getActiveItems = useCallback(
    () =>
      items
        .filter((i) => isOpenStatus(i.status))
        .sort((a, b) => b.updatedAt - a.updatedAt),
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
      fileEntry,
      focusThreadId,
      setFocusThread,
      getFocusThreadId: expireIdleFocus,
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
      completeItem,
      completePlaceOccurrence,
      restoreItem,
      getActiveItems,
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
      fileEntry,
      focusThreadId,
      setFocusThread,
      expireIdleFocus,
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
      completeItem,
      completePlaceOccurrence,
      restoreItem,
      getActiveItems,
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
