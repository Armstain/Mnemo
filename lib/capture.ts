import { Directory, File, Paths } from 'expo-file-system';
import {
  processAudioDump,
  processVoiceDump,
  type CaptureContext,
  type ProcessedCapture,
} from '@/lib/gemini';
import { aiEnabled } from '@/lib/ai-mode';
import {
  embedText,
  embeddableText,
  fromBlob,
  toBlob,
  EMBEDDING_MODEL,
  EMBEDDING_DIMS,
} from '@/lib/embeddings';
import { getAllEmbeddings, upsertEmbedding } from '@/lib/db';
import type { Block, Category, ChecklistItem, Entry, Filing } from '@/types/mnemo';
import type { CaptureStore } from '@/hooks/use-mnemo-store';
import { buildBlocks } from '@/lib/threads';
import { trackedMetrics, verifyMeasures } from '@/lib/measures';
import {
  ATTACH_CONFIDENCE,
  decideFiling,
  emitFiling,
  gatherCandidates,
  similarityTo,
  type FilingDecision,
} from '@/lib/filing';

const CATEGORIES: Category[] = ['work', 'personal', 'study', 'shopping', 'health', 'ideas', 'errands', 'general'];

function asCategory(value: unknown): Category | undefined {
  return CATEGORIES.includes(value as Category) ? (value as Category) : undefined;
}

/**
 * Embeds a just-structured note and stores the vector, for semantic search
 * and "related notes". Best-effort by design: embedding is an enhancement
 * on top of an already-saved, already-searchable (via BM25) note — a
 * failure here must never throw out of `structurePendingEntry` or leave the
 * entry `pending`. An un-embedded note just stays keyword-only until the
 * next backfill sweep picks it up.
 */
async function embedAndStore(item: {
  id: string;
  title: string;
  content: string;
  nextStep?: string;
  whereLeftOff?: string;
  tags?: string[];
  category: Category;
}): Promise<void> {
  try {
    const vector = await embedText(embeddableText(item), 'RETRIEVAL_DOCUMENT');
    await upsertEmbedding({
      itemId: item.id,
      vector: toBlob(vector),
      model: EMBEDDING_MODEL,
      dims: EMBEDDING_DIMS,
    });
  } catch {
    // Left un-embedded — PendingProcessor's backfill sweep retries it later.
  }
}

/**
 * Saves what was said in a voice note (transcribed live on the phone; no
 * audio is kept) as a voice entry. With a `threadId` it joins that thread;
 * otherwise it starts one. When AI is on, it's then tidied up and filed in
 * the background; offline, the words are the note.
 */
export function saveVoiceNote(params: {
  text: string;
  category: Category;
  threadId?: string;
  /** How it got into `threadId`: picked there by the person, or their focus thread. */
  filing?: Filing;
  store: CaptureStore;
}): { threadId: string; entry: Entry } {
  const { text, category, threadId, filing, store } = params;
  const words = text.trim();
  const ai = aiEnabled();
  const entryInput = {
    source: 'voice' as const,
    transcript: words,
    blocks: buildBlocks({ text: words }),
    pending: ai,
    pendingRawText: ai ? words : undefined,
  };

  let saved: { threadId: string; entry: Entry };
  if (threadId) {
    saved = { threadId, entry: store.addEntry(threadId, { ...entryInput, filing: filing ?? { by: 'user' } }) };
  } else {
    const firstLine = words.split(/[.!?\n]/)[0].trim();
    const created = store.createThread(
      {
        title: firstLine.length > 50 ? `${firstLine.slice(0, 50)}…` : firstLine || 'Voice note',
        category,
        tags: [],
        status: 'active',
        // A placeholder title the AI replaces, when AI is on.
        pending: ai,
      },
      entryInput,
    );
    saved = { threadId: created.thread.id, entry: created.entry };
  }
  if (ai) resolvePendingEntry(saved.entry, store);
  return saved;
}

/**
 * Saves a typed note. Same shape as `saveVoiceNote`: with a `threadId` it
 * joins that thread, otherwise it starts one titled from its first line.
 */
export function saveTextNote(params: {
  text: string;
  category: Category;
  threadId?: string;
  filing?: Filing;
  checklistItems?: ChecklistItem[];
  leftOff?: string;
  nextStep?: string;
  dueDate?: number;
  store: CaptureStore;
}): { threadId: string; entry: Entry } {
  const { text, category, threadId, filing, checklistItems, store } = params;
  const words = text.trim();
  const ai = aiEnabled() && words.length > 0;
  const entryInput = {
    source: 'text' as const,
    transcript: words || undefined,
    blocks: buildBlocks({ text: words, checklistItems }),
    leftOff: params.leftOff?.trim() || undefined,
    nextStep: params.nextStep?.trim() || undefined,
    pending: ai,
    pendingRawText: ai ? words : undefined,
  };

  let saved: { threadId: string; entry: Entry };
  if (threadId) {
    saved = { threadId, entry: store.addEntry(threadId, { ...entryInput, filing: filing ?? { by: 'user' } }) };
    if (params.dueDate) store.updateItem(threadId, { dueDate: params.dueDate });
  } else {
    const firstLine = words.split('\n')[0].trim();
    const title =
      firstLine.length > 50 ? `${firstLine.slice(0, 50)}…` : firstLine || (checklistItems?.length ? 'Checklist' : 'Quick note');
    const created = store.createThread(
      { title, category, tags: [], status: 'active', dueDate: params.dueDate, pending: ai },
      entryInput,
    );
    saved = { threadId: created.thread.id, entry: created.entry };
  }
  if (ai) resolvePendingEntry(saved.entry, store);
  return saved;
}

/** Deletes the whole recordings directory. Used by "Clear all data" in Settings. */
export function deleteAllRecordings(): void {
  try {
    new Directory(Paths.document, 'recordings').delete();
  } catch {
    // Never existed, or already gone — nothing to do.
  }
}

type PendingEntry = Pick<
  Entry,
  'id' | 'threadId' | 'blocks' | 'leftOff' | 'nextStep' | 'transcript' | 'pendingAudioUri' | 'pendingRawText'
>;

/**
 * Structures a pending entry (voice or text), writes the result back, and
 * decides where it belongs. Throws on failure — callers that show their own
 * error feedback (the manual "Retry" button) should call this directly;
 * silent background callers should use `resolvePendingEntry` instead.
 *
 * - The entry gets the cleaned-up text, links and any measures (each number
 *   checked against what was actually said). A hand-made checklist is kept,
 *   and the person's own left-off / next step win over the AI's.
 * - A quick capture (filed `new` or to the focus thread) is matched against
 *   open threads in the same AI call, then filed per lib/filing.ts:
 *   attached to an existing thread, suggested, or moved out of the focus
 *   thread. The UI hears about it through `emitFiling`.
 * - If the entry still has its own new thread, that thread takes the AI's
 *   title, tags and summary; an existing thread only gains tags.
 */
export async function structurePendingEntry(
  entry: PendingEntry,
  store: CaptureStore,
): Promise<void> {
  const snap = store.snapshot();
  const live = snap.entries.find((e) => e.id === entry.id);
  if (!live) return; // Deleted while it waited.
  const filedBy = live.filing.by;
  const matching = filedBy === 'new' || filedBy === 'focus';
  const candidates = matching
    ? gatherCandidates({
        threads: snap.items,
        entries: snap.entries,
        // A new capture's own placeholder thread isn't a candidate; the focus
        // thread it was saved into is.
        excludeId: filedBy === 'new' ? live.threadId : undefined,
        focusId: store.getFocusThreadId(),
        text: entry.pendingRawText,
      })
    : [];
  // Names the entry's own thread already tracks, so "spent" stays "spent".
  const tracks =
    filedBy === 'new' ? [] : trackedMetrics(snap.entries.filter((e) => e.threadId === live.threadId));
  const ctx = candidates.length > 0 || tracks.length > 0 ? { candidates, tracks } : undefined;

  let processed: ProcessedCapture;
  let transcript = entry.transcript;

  if (entry.pendingAudioUri) {
    // Only from versions that kept recordings. Transcribe it once, then the
    // file goes: audio is never kept now.
    const audioFile = new File(entry.pendingAudioUri);
    if (!audioFile.exists) {
      store.updateEntry(entry.id, { pending: false, pendingAudioUri: undefined });
      return;
    }
    try {
      processed = await processAudioDump(await audioFile.base64(), 'audio/m4a', ctx);
    } finally {
      try { audioFile.delete(); } catch { /* already gone */ }
    }
  } else if (entry.pendingRawText) {
    transcript = transcript ?? entry.pendingRawText;
    processed = await processVoiceDump(entry.pendingRawText, ctx);
  } else {
    store.updateEntry(entry.id, { pending: false });
    return;
  }
  transcript = transcript ?? processed.transcript;

  // Every number must appear in the person's own words, not only the AI's notes.
  const measures = verifyMeasures(
    processed.measures,
    entry.pendingRawText ?? processed.transcript ?? processed.notes,
  );
  const handMadeChecklists = entry.blocks.filter((b) => b.kind === 'checklist');
  const existingLinks = entry.blocks.flatMap((b) => (b.kind === 'link' ? [b.url] : []));
  const links = [...new Set([...existingLinks, ...(processed.links ?? [])])];
  const blocks: Block[] = [
    ...buildBlocks({ text: processed.notes }),
    ...handMadeChecklists,
    ...(measures.length > 0 ? [{ kind: 'measures' as const, items: measures }] : []),
    ...buildBlocks({ links }),
  ];
  const leftOff = entry.leftOff || processed.summary?.leftOff;
  const nextStep = entry.nextStep || processed.summary?.nextSteps?.[0];

  store.updateEntry(entry.id, {
    transcript,
    blocks,
    leftOff,
    nextStep,
    pending: false,
    pendingAudioUri: undefined,
    pendingRawText: undefined,
  });

  const tags = processed.tags ?? [];
  const aiCategory = asCategory(processed.suggestedCategory);

  // ─── Where it belongs ──────────────────────────────────────
  let decision: FilingDecision = { action: 'stay' };
  if (matching && processed.thread) {
    let similarity: Map<string, number> | undefined;
    if (
      filedBy === 'new' &&
      processed.thread.match === 'existing' &&
      processed.thread.confidence >= ATTACH_CONFIDENCE
    ) {
      try {
        const vector = await embedText(processed.notes, 'RETRIEVAL_DOCUMENT');
        const ids = new Set(candidates.map((c) => c.id));
        const rows = (await getAllEmbeddings()).filter((r) => ids.has(r.itemId));
        similarity = similarityTo(vector, new Map(rows.map((r) => [r.itemId, fromBlob(r.vector)])));
      } catch {
        // Offline or not embedded yet: the model's answer stands alone.
      }
    }
    decision = decideFiling({ filedBy, match: processed.thread, candidates, similarity });
  }

  if (decision.action === 'attach') {
    const own = store.getThread(live.threadId);
    store.moveEntry(entry.id, decision.threadId, { by: 'auto', confidence: decision.confidence });
    if (own && !store.snapshot().entries.some((e) => e.threadId === own.id)) {
      store.removeThreadNow(own.id);
    }
    const target = store.getThread(decision.threadId);
    if (!target) return;
    if (tags.length > 0) {
      store.updateItem(target.id, { tags: [...new Set([...target.tags, ...tags])].slice(0, 8) });
    }
    emitFiling({
      type: 'attached',
      entryId: entry.id,
      fromThreadId: live.threadId,
      toThreadId: target.id,
      toTitle: target.title,
      ownTitle: processed.title,
      ownCategory: aiCategory ?? own?.category ?? 'general',
    });
    await embedThread(store, target.id);
    return;
  }

  if (decision.action === 'release') {
    const from = store.getThread(live.threadId);
    const created = store.moveEntryToNewThread(entry.id, {
      title: processed.title,
      category: aiCategory ?? 'general',
      tags,
    });
    if (!created) return;
    if (processed.summary) store.updateItem(created.id, { aiSummary: processed.summary });
    emitFiling({
      type: 'released',
      entryId: entry.id,
      fromThreadId: live.threadId,
      fromTitle: from?.title ?? '',
      toThreadId: created.id,
    });
    await embedThread(store, created.id);
    return;
  }

  const thread = store.getThread(live.threadId);
  if (!thread) return;
  if (thread.pending) {
    store.updateItem(thread.id, {
      title: processed.title,
      tags,
      // The category picker defaults to General; a better guess wins.
      ...(thread.category === 'general' && aiCategory ? { category: aiCategory } : {}),
      aiSummary: processed.summary,
      pending: false,
      pendingAudioUri: undefined,
      pendingRawText: undefined,
      status: 'active',
    });
  } else if (tags.length > 0) {
    store.updateItem(thread.id, { tags: [...new Set([...thread.tags, ...tags])].slice(0, 8) });
  }

  if (decision.action === 'suggest') {
    const target = store.getThread(decision.threadId);
    if (target) {
      store.updateEntry(entry.id, {
        filing: { by: 'suggested', threadId: target.id, confidence: decision.confidence },
      });
      emitFiling({
        type: 'suggested',
        entryId: entry.id,
        threadId: thread.id,
        toThreadId: target.id,
        toTitle: target.title,
        reason: decision.reason,
      });
    }
  }

  await embedThread(store, thread.id);
}

/** Re-embeds a thread from its current text (best-effort, see embedAndStore). */
async function embedThread(store: CaptureStore, threadId: string): Promise<void> {
  const thread = store.getThread(threadId);
  if (!thread) return;
  await embedAndStore(thread);
}

/**
 * Fire-and-forget version of `structurePendingEntry` for background callers
 * (freshly saved entries, PendingProcessor's startup sweep). Never throws —
 * on failure the entry simply stays pending, retried on next launch or by
 * hand from the thread screen.
 */
export async function resolvePendingEntry(
  entry: PendingEntry,
  store: CaptureStore,
): Promise<void> {
  try {
    await structurePendingEntry(entry, store);
  } catch {
    // Keep the entry as pending — retried next launch or by hand.
  }
}
