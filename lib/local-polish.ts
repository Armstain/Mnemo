import { localAiEnabled, readNoteLocally } from '@/lib/local-ai';
import { mergeLocal } from '@/lib/local-prompt';
import { ideaCategory } from '@/lib/kind';
import { readJson, writeJson } from '@/lib/storage';
import { gist, noteTopic, trace } from '@/lib/trace';
import { MAX_TAGS, understand } from '@/lib/understand';
import type { Entry, MnemoItem } from '@/types/mnemo';
import type { CaptureStore } from '@/types/store';

// With the on-device model on, offline (or while Gemini can't answer): a note is saved and read by the phone's own reader at once,
// exactly as without it, and then the model names and tags it a few seconds later. The note is
// never waiting on the model and never changed by it: only its thread's title (when the reader's
// was cut off or generic and nobody has renamed it), kind, category (when unset) and tags.

type Store = Pick<CaptureStore, 'snapshot' | 'getThread' | 'updateItem'>;

const KEY = 'mnemo-local-waiting';
/** Notes saved but not yet read by the model; kept on disk so a note isn't skipped if the app closes first. */
let waiting: string[] = [];
const loaded: Promise<void> = readJson(KEY)
  .then((saved) => {
    if (Array.isArray(saved)) waiting = [...new Set([...saved.filter((s): s is string => typeof s === 'string'), ...waiting])];
  })
  .catch(() => undefined);

function save(): void {
  writeJson(KEY, waiting).catch(() => {
    // Saved again with the next change.
  });
}

const textOf = (e: Pick<Entry, 'blocks' | 'transcript'>): string => {
  const block = e.blocks.find((b) => b.kind === 'text');
  return (e.transcript ?? (block && block.kind === 'text' ? block.markdown : '')).trim();
};

/** After saveNote, offline: queues the note for the model and starts on it. */
export function polishLater(entryId: string, store: Store): void {
  if (!localAiEnabled()) return;
  waiting = [...waiting.filter((id) => id !== entryId), entryId];
  save();
  void polishWaiting(store);
}

let running = false;
const polished = new Set<string>();

/** Reads every queued note. Called after a save and by the background sweep (components/PendingProcessor). */
export async function polishWaiting(store: Store): Promise<void> {
  await loaded;
  if (running || waiting.length === 0 || !localAiEnabled()) return;
  running = true;
  try {
    while (waiting.length > 0 && localAiEnabled()) {
      const id = waiting[0];
      try {
        await polishOne(id, store);
      } catch {
        // The model couldn't run (out of memory, a broken file): the phone's reading stands, and
        // the note isn't retried, so one bad note can't block the queue.
      }
      waiting = waiting.filter((w) => w !== id);
      save();
    }
  } finally {
    running = false;
  }
}

function mergeTags(have: string[], add: string[]): string[] {
  return [...new Set([...have, ...add])].slice(0, MAX_TAGS);
}

async function polishOne(entryId: string, store: Store): Promise<void> {
  const entry = store.snapshot().entries.find((e) => e.id === entryId);
  if (!entry) return;
  const geminiLater = !!entry.pending;
  const words = textOf(entry);
  if (words.length < 3 || polished.has(`${entryId}:${words}`)) return;
  polished.add(`${entryId}:${words}`);
  const topic = noteTopic(entryId);
  const local = await readNoteLocally(words, topic);
  if (!local) return;

  // The note or its thread may have changed while the model read it.
  const now = store.snapshot().entries.find((e) => e.id === entryId);
  if (!now || textOf(now) !== words) return;
  const thread = store.getThread(now.threadId);
  if (!thread) return;

  const rule = understand(words);
  const ownThread = !store.snapshot().entries.some((e) => e.threadId === thread.id && e.id !== entryId);
  const merged = mergeLocal({ title: thread.title, kind: thread.kind, category: thread.category }, local);
  const updates: Partial<MnemoItem> = {};

  // Only a thread this note started, and only while it still has the name the phone gave it.
  const untouchedTitle = !thread.pinned?.title && (thread.title === rule.title.slice(0, 80) || !rule.title);
  if (ownThread && merged.title && untouchedTitle) updates.title = merged.title.slice(0, 80);
  if (ownThread && !geminiLater && merged.kind && !thread.pinned?.kind) updates.kind = merged.kind;
  const category = ideaCategory(merged.category, updates.kind ?? thread.kind);
  if (ownThread && !geminiLater && thread.category === 'general' && category && category !== 'general') updates.category = category;
  const tags = mergeTags(thread.tags, merged.tags);
  if (tags.length !== thread.tags.length) updates.tags = tags;

  if (Object.keys(updates).length === 0) return;
  store.updateItem(thread.id, updates);
  trace(
    topic,
    `on-device model: ${updates.title ? `named ${gist(updates.title, 40)}` : 'kept the name'}` +
      `${updates.kind ? ` · ${updates.kind}` : ''}${updates.category ? ` · ${updates.category}` : ''}` +
      `${updates.tags ? ` · tags ${merged.tags.join(', ')}` : ''}`,
    'ok',
  );
}
