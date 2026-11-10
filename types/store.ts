import type { Entry, MnemoItem } from '@/types/mnemo';

/** How long a soft delete waits before it is persisted for real; the toast shows Undo for the same time. */
export const UNDO_WINDOW_MS = 6000;

/** What callers supply for a new entry; the store fills in ids and times. */
export type NewEntry = Omit<Entry, 'id' | 'threadId' | 'createdAt' | 'updatedAt' | 'filing'> & {
  filing?: Entry['filing'];
};

/** What callers supply for a new thread; its text comes from its first entry. */
export type NewThread = Omit<
  MnemoItem,
  'id' | 'createdAt' | 'updatedAt' | 'content' | 'checklistItems' | 'links' | 'type'
>;

export type FileResult =
  | { moved: true; removedThreadId?: string; carried?: Partial<MnemoItem> }
  | { moved: false; reason?: string };

export interface CaptureStore {
  /** Starts a thread with its first entry. */
  createThread: (thread: NewThread, entry: NewEntry) => { thread: MnemoItem; entry: Entry };
  /** Adds an entry to an existing thread; the thread's next step and text follow it. */
  addEntry: (threadId: string, entry: NewEntry) => Entry;
  updateEntry: (id: string, updates: Partial<Omit<Entry, 'id' | 'threadId'>>) => void;
  /** Moves updatedAt unless `touch: false` (snoozes, undos that restore updatedAt). */
  updateItem: (id: string, updates: Partial<MnemoItem>, opts?: { touch?: boolean }) => void;
  /** The thread as of right now, including changes made earlier in the same tick. */
  getThread: (id: string) => MnemoItem | undefined;
  /** Every thread and entry as of right now, for background work outside render. */
  snapshot: () => { items: MnemoItem[]; entries: Entry[] };
  /** Moves an entry into another thread; both threads' text and next step follow. */
  moveEntry: (entryId: string, toThreadId: string, filing: Entry['filing']) => void;
  /** Gives an entry a thread of its own (Undo of an auto-file, or "Keep separate"); a thread it empties hands over its reminders and goes. */
  moveEntryToNewThread: (
    entryId: string,
    thread: Pick<MnemoItem, 'title' | 'category' | 'tags'>,
  ) => MnemoItem | undefined;
  /** Deletes a thread at once, without the undo window. For a thread left empty by a move. */
  removeThreadNow: (id: string) => void;
  /**
   * Moves a note into another thread: the one way to connect notes by moving them. When it was
   * its thread's last note, that thread goes and its reminders move along, or, if they would
   * overwrite the other thread's, nothing moves and `reason` says why (lib/reminder-ownership.ts).
   */
  fileEntry: (entryId: string, toThreadId: string, filing: Entry['filing']) => FileResult;
  /** Current focus, readable outside render. A focus that has gone idle (or whose thread is closed) is dropped as it is read. */
  getFocusThreadId: () => string | null;
}
