import { Directory, File, Paths } from 'expo-file-system';
import { processAudioDump, processVoiceDump } from '@/lib/gemini';
import { transcribeAudio } from '@/lib/groq';
import { embedText, embeddableText, toBlob, EMBEDDING_MODEL, EMBEDDING_DIMS } from '@/lib/embeddings';
import { upsertEmbedding } from '@/lib/db';
import type { AISummary, Category, MnemoItem } from '@/types/mnemo';

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

type UpdateItemFn = (id: string, updates: Partial<MnemoItem>) => void;
type AddItemFn = (item: Omit<MnemoItem, 'id' | 'createdAt' | 'updatedAt'>) => MnemoItem;
type PendingItem = Pick<
  MnemoItem,
  'id' | 'pendingAudioUri' | 'pendingRawText' | 'nextStep' | 'whereLeftOff' | 'category'
>;

/**
 * Embeds a just-structured note and stores the vector, for semantic search
 * and "related notes". Best-effort by design: embedding is an enhancement
 * on top of an already-saved, already-searchable (via BM25) note — a
 * failure here must never throw out of `structurePendingItem` or leave the
 * item `pending`. An un-embedded note just stays keyword-only until the
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
 * Copies a finished recording out of its temp/cache location, adds it as a
 * pending voice item, and kicks off background AI structuring. Shared by
 * the full manual recording screen (dump.tsx) and the FAB's quick
 * hold-to-record flow — one save path so both stay in sync.
 */
export async function saveVoiceRecording(params: {
  tempUri: string;
  category: Category;
  addItem: AddItemFn;
  updateItem: UpdateItemFn;
}): Promise<MnemoItem> {
  const { tempUri, category, addItem, updateItem } = params;

  const recordingsDir = new Directory(Paths.document, 'recordings');
  try {
    recordingsDir.create({ intermediates: true, idempotent: true });
  } catch {
    // Directory already exists — safe to continue.
  }
  const permanentFile = new File(recordingsDir, `recording-${Date.now()}.m4a`);
  new File(tempUri).copy(permanentFile);

  const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const newItem = addItem({
    type: 'voice',
    title: `Voice note · ${timestamp}`,
    content: 'Transcribing your recording…',
    links: [],
    category,
    tags: [],
    status: 'active',
    pending: true,
    pendingAudioUri: permanentFile.uri,
  });

  // Fire-and-forget — the caller shouldn't wait on a network round trip to
  // see their note land.
  resolvePendingItem(newItem, updateItem);

  return newItem;
}

/**
 * Best-effort cleanup for a recording that's being discarded (cancelled
 * hold, or too short to be intentional) rather than saved. The temp file
 * lives in a cache dir the OS reclaims anyway, so failures here are fine
 * to ignore.
 */
/** Deletes the whole recordings directory. Used by "Clear all data" in Settings. */
export function deleteAllRecordings(): void {
  try {
    new Directory(Paths.document, 'recordings').delete();
  } catch {
    // Never existed, or already gone — nothing to do.
  }
}

export function discardRecordingFile(tempUri?: string | null): void {
  if (!tempUri) return;
  try {
    new File(tempUri).delete();
  } catch {
    // Already gone, or never existed — nothing to do.
  }
}

/**
 * Structures a pending item (voice or text) and writes the result back via
 * updateItem. Throws on failure — callers that show their own error
 * feedback (the manual "Retry" button) should call this directly; silent
 * background callers should use `resolvePendingItem` instead. User-authored
 * nextStep/whereLeftOff always win over the AI's guess.
 */
export async function structurePendingItem(
  item: PendingItem,
  updateItem: UpdateItemFn,
): Promise<void> {
  if (item.pendingAudioUri) {
    const audioFile = new File(item.pendingAudioUri);
    if (!audioFile.exists) {
      updateItem(item.id, { pending: false, pendingAudioUri: undefined });
      return;
    }
    const base64 = await audioFile.base64();
    const processed = await processRecording({
      fileUri: item.pendingAudioUri,
      base64,
      mimeType: 'audio/m4a',
    });
    try { audioFile.delete(); } catch { /* already deleted — safe to ignore */ }
    const whereLeftOff = item.whereLeftOff || processed.summary?.leftOff;
    const nextStep = item.nextStep || processed.summary?.nextSteps?.[0];
    updateItem(item.id, {
      title: processed.title,
      content: processed.notes,
      links: processed.links,
      tags: processed.tags ?? [],
      aiSummary: processed.summary,
      whereLeftOff,
      nextStep,
      pending: false,
      pendingAudioUri: undefined,
      pendingRawText: undefined,
      status: 'active',
    });
    await embedAndStore({
      id: item.id,
      title: processed.title,
      content: processed.notes,
      whereLeftOff,
      nextStep,
      tags: processed.tags,
      category: item.category,
    });
  } else if (item.pendingRawText) {
    const processed = await processVoiceDump(item.pendingRawText);
    const whereLeftOff = item.whereLeftOff || processed.summary?.leftOff;
    const nextStep = item.nextStep || processed.summary?.nextSteps?.[0];
    updateItem(item.id, {
      title: processed.title,
      content: processed.notes,
      links: processed.links,
      tags: processed.tags ?? [],
      aiSummary: processed.summary,
      whereLeftOff,
      nextStep,
      pending: false,
      pendingRawText: undefined,
      status: 'active',
    });
    await embedAndStore({
      id: item.id,
      title: processed.title,
      content: processed.notes,
      whereLeftOff,
      nextStep,
      tags: processed.tags,
      category: item.category,
    });
  }
}

/**
 * Fire-and-forget version of `structurePendingItem` for background callers
 * (freshly saved items, PendingProcessor's startup sweep). Never throws —
 * on failure the item is simply left pending, retried on next launch or by
 * hand via the item's "Processing queued" banner.
 */
export async function resolvePendingItem(
  item: PendingItem,
  updateItem: UpdateItemFn,
): Promise<void> {
  try {
    await structurePendingItem(item, updateItem);
  } catch {
    // Keep the item as pending — retried next launch or by hand.
  }
}
