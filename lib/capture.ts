import { Directory, File, Paths } from 'expo-file-system';
import { processAudioDump, processVoiceDump } from '@/lib/gemini';
import { transcribeAudio } from '@/lib/groq';
import { embedText, embeddableText, toBlob, EMBEDDING_MODEL, EMBEDDING_DIMS } from '@/lib/embeddings';
import { upsertEmbedding } from '@/lib/db';
import type { AISummary, Category, Entry, MnemoItem } from '@/types/mnemo';
import type { CaptureStore } from '@/hooks/use-mnemo-store';
import { buildBlocks } from '@/lib/threads';

export interface ProcessedRecording {
  title: string;
  notes: string;
  links: string[];
  tags?: string[];
  suggestedCategory?: string;
  summary?: AISummary;
}

/**
 * Turn a voice recording into a structured note, degrading gracefully:
 * 1. Gemini audio understanding (transcribe + structure in one call).
 * 2. Groq Whisper transcript, structured by Gemini text.
 * 3. Groq Whisper transcript as-is — a raw note beats a lost one.
 * Throws only when every provider is unreachable; callers keep their
 * offline "process later" path for that case.
 */
export async function processRecording(input: {
  fileUri: string;
  base64: string;
  mimeType: string;
}): Promise<ProcessedRecording> {
  try {
    return await processAudioDump(input.base64, input.mimeType);
  } catch {
    const transcript = await transcribeAudio(input.fileUri, input.mimeType);
    try {
      return await processVoiceDump(transcript);
    } catch {
      const words = transcript.split(/\s+/);
      return {
        title: words.slice(0, 5).join(' ') + (words.length > 5 ? '…' : ''),
        notes: transcript,
        links: [],
      };
    }
  }
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
 * Copies a finished recording out of its temp/cache location and saves it
 * as a pending voice entry, then kicks off background AI structuring.
 * With a `threadId` the entry joins that thread; without one it starts a
 * new thread. Shared by the full recording screen (dump.tsx), the capture
 * button's hold-to-record, and onboarding — one save path for all three.
 */
export async function saveVoiceRecording(params: {
  tempUri: string;
  category: Category;
  threadId?: string;
  store: CaptureStore;
}): Promise<{ threadId: string; entry: Entry }> {
  const { tempUri, category, threadId, store } = params;

  const recordingsDir = new Directory(Paths.document, 'recordings');
  try {
    recordingsDir.create({ intermediates: true, idempotent: true });
  } catch {
    // Directory already exists — safe to continue.
  }
  const permanentFile = new File(recordingsDir, `recording-${Date.now()}.m4a`);
  new File(tempUri).copy(permanentFile);

  const entryInput = {
    source: 'voice' as const,
    blocks: [],
    pending: true,
    pendingAudioUri: permanentFile.uri,
  };

  if (threadId) {
    const entry = store.addEntry(threadId, entryInput);
    resolvePendingEntry(entry, store);
    return { threadId, entry };
  }

  const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const created = store.createThread(
    {
      title: `Voice note · ${timestamp}`,
      category,
      tags: [],
      status: 'active',
      // The thread itself is pending until its first entry is structured:
      // its title is a placeholder the AI replaces.
      pending: true,
    },
    entryInput,
  );

  // Fire-and-forget — the caller shouldn't wait on a network round trip to
  // see their note land.
  resolvePendingEntry(created.entry, store);
  return { threadId: created.thread.id, entry: created.entry };
}

/** Deletes the whole recordings directory. Used by "Clear all data" in Settings. */
export function deleteAllRecordings(): void {
  try {
    new Directory(Paths.document, 'recordings').delete();
  } catch {
    // Never existed, or already gone — nothing to do.
  }
}

/**
 * Best-effort cleanup for a recording that's being discarded (cancelled
 * hold, or too short to be intentional) rather than saved. The temp file
 * lives in a cache dir the OS reclaims anyway, so failures here are fine
 * to ignore.
 */
export function discardRecordingFile(tempUri?: string | null): void {
  if (!tempUri) return;
  try {
    new File(tempUri).delete();
  } catch {
    // Already gone, or never existed — nothing to do.
  }
}

type PendingEntry = Pick<
  Entry,
  'id' | 'threadId' | 'blocks' | 'leftOff' | 'nextStep' | 'transcript' | 'pendingAudioUri' | 'pendingRawText'
>;

/**
 * Structures a pending entry (voice or text) and writes the result back.
 * Throws on failure — callers that show their own error feedback (the
 * manual "Retry" button) should call this directly; silent background
 * callers should use `resolvePendingEntry` instead.
 *
 * - The entry gets the cleaned-up text and any links; a checklist the user
 *   made by hand is kept. Their own left-off / next step win over the AI's.
 * - If the entry started a new thread (the thread is still `pending`), the
 *   thread takes the AI's title, tags and summary. An existing thread keeps
 *   its title; it only gains new tags.
 */
export async function structurePendingEntry(
  entry: PendingEntry,
  store: CaptureStore,
): Promise<void> {
  let processed: ProcessedRecording;
  let transcript = entry.transcript;

  if (entry.pendingAudioUri) {
    const audioFile = new File(entry.pendingAudioUri);
    if (!audioFile.exists) {
      store.updateEntry(entry.id, { pending: false, pendingAudioUri: undefined });
      return;
    }
    const base64 = await audioFile.base64();
    processed = await processRecording({
      fileUri: entry.pendingAudioUri,
      base64,
      mimeType: 'audio/m4a',
    });
    try { audioFile.delete(); } catch { /* already deleted — safe to ignore */ }
  } else if (entry.pendingRawText) {
    transcript = transcript ?? entry.pendingRawText;
    processed = await processVoiceDump(entry.pendingRawText);
  } else {
    store.updateEntry(entry.id, { pending: false });
    return;
  }

  const handMadeChecklists = entry.blocks.filter((b) => b.kind === 'checklist');
  const existingLinks = entry.blocks.flatMap((b) => (b.kind === 'link' ? [b.url] : []));
  const links = [...new Set([...existingLinks, ...(processed.links ?? [])])];
  const blocks = [
    ...buildBlocks({ text: processed.notes }),
    ...handMadeChecklists,
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

  const thread = store.getThread(entry.threadId);
  if (!thread) return;
  const tags = processed.tags ?? [];
  if (thread.pending) {
    store.updateItem(thread.id, {
      title: processed.title,
      tags,
      aiSummary: processed.summary,
      pending: false,
      pendingAudioUri: undefined,
      pendingRawText: undefined,
      status: 'active',
    });
  } else if (tags.length > 0) {
    store.updateItem(thread.id, { tags: [...new Set([...thread.tags, ...tags])].slice(0, 8) });
  }

  await embedAndStore({
    id: thread.id,
    title: thread.pending ? processed.title : thread.title,
    // The thread's earlier text plus this entry's, so the vector describes
    // the whole thread rather than its latest capture alone.
    content: [processed.notes, thread.content].filter(Boolean).join('\n\n'),
    whereLeftOff: leftOff,
    nextStep,
    tags: [...new Set([...thread.tags, ...tags])],
    category: thread.category,
  });
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
