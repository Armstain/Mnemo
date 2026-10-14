import { Directory, File, Paths } from 'expo-file-system';
import {
  processAudioDump,
  processVoiceDump,
  AiOffError,
  type ProcessedCapture,
} from '@/lib/gemini';
import { aiEnabled, setAiProblem } from '@/lib/ai-mode';
import { classifyAiError, onApiKeyChanged } from '@/lib/api-key';
import { logError } from '@/lib/errors';
import {
  embedText,
  embeddableText,
  toBlob,
  embeddingModel,
  EMBEDDING_DIMS,
} from '@/lib/embeddings';
import { getVectors, upsertEmbedding } from '@/lib/db';
import type { Block, Category, ChecklistItem, Entry, Filing, MnemoItem } from '@/types/mnemo';
import type { CaptureStore } from '@/hooks/use-mnemo-store';
import { buildBlocks } from '@/lib/threads';
import { summarizeMeasures, trackedMetrics, verifyMeasures } from '@/lib/measures';
import { understand, type KnownMetric } from '@/lib/understand';
import { imageBase64, imagesOf } from '@/lib/images';
import { fetchLinkPreview, type LinkPreview } from '@/lib/link-preview';
import {
  ATTACH_CONFIDENCE,
  decideFiling,
  emitFiling,
  gatherCandidates,
  keywordMatch,
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
      model: await embeddingModel(),
      dims: EMBEDDING_DIMS,
    });
  } catch {
    // Left un-embedded — PendingProcessor's backfill sweep retries it later.
  }
}

interface NoteInput {
  text: string;
  category: Category;
  threadId?: string;
  /** How it got into `threadId`: picked there by the person, or their focus thread. */
  filing?: Filing;
  checklistItems?: ChecklistItem[];
  leftOff?: string;
  nextStep?: string;
  dueDate?: number;
  /** Photos already kept (lib/images). */
  images?: Block[];
  /** Links given apart from the text (a shared page). */
  links?: string[];
  /** A name for a new thread, when there's a better one than the text's (a shared page's title). */
  title?: string;
  store: CaptureStore;
}

/** What a thread already tracks, so the phone reuses its names. */
function knownMetrics(store: CaptureStore, threadId?: string): KnownMetric[] {
  if (!threadId) return [];
  const entries = store.snapshot().entries.filter((e) => e.threadId === threadId);
  return summarizeMeasures(entries).map((m) => ({ metric: m.metric, unit: m.unit }));
}

/**
 * Every note is read on the phone the moment it's saved (lib/understand):
 * offline that's all it gets; with AI on it's what shows until Gemini's
 * version arrives, and what stays if Gemini never answers.
 */
// A capture that set a reminder says so (components/FilingNotifier.tsx shows it).
export interface ReminderSetEvent {
  threadId: string;
  at: number;
  /** What the thread's reminder was before, for Undo. */
  previous?: number;
}
const reminderListeners = new Set<(event: ReminderSetEvent) => void>();
export function onReminderSet(listener: (event: ReminderSetEvent) => void): () => void {
  reminderListeners.add(listener);
  return () => reminderListeners.delete(listener);
}
const reminderSet = (event: ReminderSetEvent) => reminderListeners.forEach((l) => l(event));

function saveNote(source: Entry['source'], params: NoteInput): { threadId: string; entry: Entry } {
  const { category, threadId, store } = params;
  const words = params.text.trim();
  const images = params.images ?? [];
  // Gemini can read a photo too (a receipt, a whiteboard), so one alone is worth sending.
  const ai = aiEnabled() && (words.length > 0 || images.length > 0);
  const reading = understand(words, { known: knownMetrics(store, threadId), monthFirst: monthFirst() });

  // With AI on, the text stays exactly as said: Gemini rewrites it, and an
  // edit made meanwhile is noticed against it. Offline, list lines become a
  // checklist.
  const checklist = [...(params.checklistItems ?? []), ...(ai ? [] : reading.checklist)];
  const blocks: Block[] = [
    ...buildBlocks({ text: ai ? words : reading.text }),
    ...images,
    ...buildBlocks({ checklistItems: checklist }),
    ...(reading.measures.length > 0 ? [{ kind: 'measures' as const, items: reading.measures }] : []),
    ...buildBlocks({ links: [...new Set([...(params.links ?? []), ...reading.links])] }),
  ];
  const entryInput = {
    source,
    transcript: words || undefined,
    blocks,
    leftOff: params.leftOff?.trim() || (ai ? undefined : reading.leftOff),
    nextStep: params.nextStep?.trim() || (ai ? undefined : reading.nextStep),
    pending: ai,
    pendingRawText: ai ? words : undefined,
  };
  const due = params.dueDate ?? reading.due;

  let saved: { threadId: string; entry: Entry };
  if (threadId) {
    saved = { threadId, entry: store.addEntry(threadId, { ...entryInput, filing: params.filing ?? { by: 'user' } }) };
    const thread = store.getThread(threadId);
    if (thread) {
      const updates: Partial<MnemoItem> = {};
      // A day named in the note sets the reminder, unless one's already coming.
      if (due && (params.dueDate || !thread.dueDate || thread.dueDate < Date.now())) updates.dueDate = due;
      if (reading.tags.some((t) => !thread.tags.includes(t))) updates.tags = [...new Set([...thread.tags, ...reading.tags])].slice(0, 8);
      if (Object.keys(updates).length > 0) store.updateItem(threadId, updates);
      if (updates.dueDate) reminderSet({ threadId, at: updates.dueDate, previous: thread.dueDate });
    }
  } else {
    const fallback =
      checklist.length > 0 ? 'Checklist' : images.length > 0 ? 'Photo' : source === 'voice' ? 'Voice note' : 'Quick note';
    const created = store.createThread(
      {
        title: (reading.title || params.title?.trim() || fallback).slice(0, 80),
        // Offline, the phone's guess beats "General"; with AI on, Gemini guesses.
        category: category === 'general' && !ai ? reading.category ?? 'general' : category,
        tags: reading.tags,
        status: 'active',
        dueDate: due,
        // A placeholder title the AI replaces, when AI is on.
        pending: ai,
      },
      entryInput,
    );
    saved = { threadId: created.thread.id, entry: created.entry };
    if (due) reminderSet({ threadId: saved.threadId, at: due });
    if (!ai) suggestByKeywords(saved, words, store);
  }
  if (ai) resolvePendingEntry(saved.entry, store);
  enrichLinks(saved.entry.id, store);
  return saved;
}

const previewed = new Set<string>();
const knownPreviews = new Map<string, LinkPreview>();

/** A preview already fetched (the share screen shows one): no need to fetch again. */
export function rememberPreview(url: string, preview: LinkPreview): void {
  knownPreviews.set(url, preview);
}

/**
 * Gives an entry's links their page title, site and picture, read by the
 * phone (lib/link-preview). Fire-and-forget; each link is tried once.
 */
export async function enrichLinks(entryId: string, store: CaptureStore): Promise<void> {
  const entry = store.snapshot().entries.find((e) => e.id === entryId);
  if (!entry) return;
  const todo = entry.blocks.flatMap((b) => (b.kind === 'link' && !b.title && !previewed.has(b.url) ? [b.url] : []));
  for (const url of todo) {
    previewed.add(url);
    const preview = knownPreviews.get(url) ?? (await fetchLinkPreview(url));
    if (!preview) continue;
    // Re-read: the entry may have changed while the page loaded.
    const now = store.snapshot().entries.find((e) => e.id === entryId);
    if (!now) return;
    store.updateEntry(entryId, {
      blocks: now.blocks.map((b) =>
        b.kind === 'link' && b.url === url && !b.title
          ? { ...b, title: preview.title, site: preview.site, description: preview.description, imageUrl: preview.imageUrl }
          : b,
      ),
    });
  }
}

/** Offline: point out an open thread the note clearly shares words with. */
function suggestByKeywords(saved: { threadId: string; entry: Entry }, text: string, store: CaptureStore) {
  const match = keywordMatch({ text, threads: store.snapshot().items, excludeId: saved.threadId });
  if (!match) return;
  store.updateEntry(saved.entry.id, {
    filing: { by: 'suggested', threadId: match.threadId, confidence: match.confidence },
  });
  emitFiling({
    type: 'suggested',
    entryId: saved.entry.id,
    threadId: saved.threadId,
    toThreadId: match.threadId,
    toTitle: match.title,
    reason: match.reason,
  });
}

/** 3/4 is March 4 on phones set to US English, 3 April elsewhere. */
function monthFirst(): boolean {
  try {
    return /^en-US$/i.test(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return false;
  }
}

/**
 * Saves what was said in a voice note (transcribed live on the phone; no
 * audio is kept). With a `threadId` it joins that thread; otherwise it
 * starts one.
 */
export function saveVoiceNote(params: Omit<NoteInput, 'checklistItems' | 'leftOff' | 'nextStep' | 'dueDate'>) {
  return saveNote('voice', params);
}

/** Saves a typed note. Same shape as `saveVoiceNote`, plus the Write screen's own fields. */
export function saveTextNote(params: NoteInput) {
  return saveNote('text', params);
}

/** Saves something shared in from another app: text, a link, photos. */
export function saveSharedNote(params: NoteInput) {
  return saveNote('share', params);
}

/**
 * Finishes a note that was waiting for an AI that won't come (the person
 * switched to offline): it gets the phone's reading instead.
 */
export function finishOnDevice(entry: Entry, store: CaptureStore): void {
  const words = (entry.pendingRawText ?? textOf(entry)).trim();
  const reading = understand(words, { known: knownMetrics(store, entry.threadId), monthFirst: monthFirst() });
  const hasMeasures = entry.blocks.some((b) => b.kind === 'measures');
  const links = entry.blocks.flatMap((b) => (b.kind === 'link' ? [b.url] : []));
  const newLinks = reading.links.filter((l) => !links.includes(l));
  store.updateEntry(entry.id, {
    blocks: [
      ...entry.blocks,
      ...(!hasMeasures && reading.measures.length > 0 ? [{ kind: 'measures' as const, items: reading.measures }] : []),
      ...buildBlocks({ links: newLinks }),
    ],
    leftOff: entry.leftOff || reading.leftOff,
    nextStep: entry.nextStep || reading.nextStep,
    pending: false,
    pendingRawText: undefined,
  });
  const thread = store.getThread(entry.threadId);
  if (thread?.pending) {
    store.updateItem(thread.id, {
      title: thread.pinned?.title ? thread.title : reading.title || thread.title,
      category: thread.category === 'general' ? reading.category ?? 'general' : thread.category,
      pending: false,
    });
  }
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
  // One run per entry at a time: a manual Retry while the background run
  // is still out would otherwise process (and bill) the same note twice.
  if (inFlight.has(entry.id)) return;
  inFlight.add(entry.id);
  try {
    await structure(entry, store);
  } finally {
    inFlight.delete(entry.id);
  }
}

const inFlight = new Set<string>();
/** Photos sent along with one note; more would be slow and costly. */
const MAX_PHOTOS_TO_AI = 3;

/** Whether this entry is with the AI right now (an edit then keeps the person's words). */
export function isStructuring(entryId: string): boolean {
  return inFlight.has(entryId);
}

/** The text block of an entry, as it reads right now. */
function textOf(e: Pick<Entry, 'blocks'>): string {
  const block = e.blocks.find((b) => b.kind === 'text');
  return block && block.kind === 'text' ? block.markdown.trim() : '';
}

async function structure(entry: PendingEntry, store: CaptureStore): Promise<void> {
  const snap = store.snapshot();
  const live = snap.entries.find((e) => e.id === entry.id);
  if (!live) return; // Deleted while it waited.
  // Its thread was deleted (or is in its undo window): don't bring it back.
  if (!store.getThread(live.threadId)) return;
  const filedBy = live.filing.by;
  // A new note's thread the person has already named is where they want it.
  const named = filedBy === 'new' && !!store.getThread(live.threadId)?.pinned?.title;
  const matching = (filedBy === 'new' && !named) || filedBy === 'focus';
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
  const photos = imagesOf([live]);

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
  } else if (entry.pendingRawText || photos.length > 0) {
    transcript = transcript ?? (entry.pendingRawText || undefined);
    const images = (await Promise.all(photos.slice(0, MAX_PHOTOS_TO_AI).map(imageBase64))).filter(
      (b): b is string => !!b,
    );
    processed = await processVoiceDump(entry.pendingRawText ?? '', ctx, images);
  } else {
    store.updateEntry(entry.id, { pending: false });
    return;
  }
  // What Gemini read off a photo is not something the person said.
  transcript = transcript ?? (photos.length > 0 ? undefined : processed.transcript);

  // The AI call takes a while. Whatever happened meanwhile wins over it:
  const now = store.snapshot().entries.find((e) => e.id === entry.id);
  if (!now || !store.getThread(now.threadId)) return; // deleted meanwhile
  // …and if the person edited the note while it waited, their words stay
  // (numbers and links are still picked out, from what they wrote).
  const sentText = (entry.pendingRawText ?? '').trim();
  const editedMeanwhile = !!sentText && textOf(now) !== sentText;

  // Every number must appear in the person's own words, not only the AI's notes.
  // (A photo has no words of the person's: what Gemini read off it is checked instead.)
  const measures = verifyMeasures(
    processed.measures,
    editedMeanwhile
      ? textOf(now)
      : [entry.pendingRawText, photos.length > 0 ? processed.transcript : undefined].filter(Boolean).join('\n') ||
          processed.transcript ||
          processed.notes,
  );
  const handMadeChecklists = now.blocks.filter((b) => b.kind === 'checklist');
  const existingLinks = now.blocks.flatMap((b) => (b.kind === 'link' ? [b.url] : []));
  const links = [...new Set([...existingLinks, ...(processed.links ?? [])])];
  // Numbers, lists or links corrected by hand while it waited stay as they are.
  // (A link's fetched preview arriving meanwhile isn't a correction.)
  const rest = (e: Pick<Entry, 'blocks'>) =>
    JSON.stringify(e.blocks.filter((b) => b.kind !== 'text').map((b) => (b.kind === 'link' ? { kind: b.kind, url: b.url } : b)));
  const correctedMeanwhile = rest(now) !== rest(live);
  const text = buildBlocks({ text: editedMeanwhile ? textOf(now) : processed.notes });
  const blocks: Block[] = correctedMeanwhile
    ? [...text, ...now.blocks.filter((b) => b.kind !== 'text')]
    : [
        ...text,
        ...now.blocks.filter((b) => b.kind === 'image'),
        ...handMadeChecklists,
        ...(measures.length > 0 ? [{ kind: 'measures' as const, items: measures }] : []),
        ...buildBlocks({ links }),
      ];
  const leftOff = now.leftOff || (editedMeanwhile ? undefined : processed.summary?.leftOff);
  const nextStep = now.nextStep || (editedMeanwhile ? undefined : processed.summary?.nextSteps?.[0]);

  // Links the AI found get their previews too.
  setTimeout(() => enrichLinks(entry.id, store), 0);
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
        const all = await getVectors(await embeddingModel());
        similarity = similarityTo(vector, new Map([...ids].flatMap((id) => (all.has(id) ? [[id, all.get(id)!] as const] : []))));
      } catch {
        // Offline or not embedded yet: the model's answer stands alone.
      }
    }
    decision = decideFiling({ filedBy, match: processed.thread, candidates, similarity });
  }

  if (decision.action === 'attach') {
    const own = store.getThread(now.threadId);
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
      fromThreadId: now.threadId,
      toThreadId: target.id,
      toTitle: target.title,
      ownTitle: processed.title,
      ownCategory: aiCategory ?? own?.category ?? 'general',
    });
    await embedThread(store, target.id);
    return;
  }

  if (decision.action === 'release') {
    const from = store.getThread(now.threadId);
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
      fromThreadId: now.threadId,
      fromTitle: from?.title ?? '',
      toThreadId: created.id,
    });
    await embedThread(store, created.id);
    return;
  }

  const thread = store.getThread(now.threadId);
  if (!thread) return;
  if (thread.pending) {
    store.updateItem(thread.id, {
      title: thread.pinned?.title ? thread.title : processed.title,
      tags: [...new Set([...thread.tags, ...tags])].slice(0, 8),
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

// How long to wait before trying a note again after Gemini failed on it:
// half a minute, then longer each time, up to half an hour.
const BACKOFF_MS = [30_000, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 30 * 60_000];
const attempts = new Map<string, { count: number; nextAt: number }>();

/**
 * Fire-and-forget version of `structurePendingEntry` for background callers
 * (freshly saved entries, PendingProcessor's sweeps). Never throws. On
 * failure the entry stays pending (it already shows the phone's reading)
 * and is tried again later, backing off; a problem the person can fix
 * (bad key, quota) is reported through `setAiProblem`.
 */
export async function resolvePendingEntry(entry: PendingEntry, store: CaptureStore): Promise<void> {
  const previous = attempts.get(entry.id);
  if (previous && Date.now() < previous.nextAt) return;
  try {
    await structurePendingEntry(entry, store);
    attempts.delete(entry.id);
    setAiProblem(null);
  } catch (e) {
    if (e instanceof AiOffError) return;
    const count = (previous?.count ?? 0) + 1;
    attempts.set(entry.id, { count, nextAt: Date.now() + BACKOFF_MS[Math.min(count, BACKOFF_MS.length) - 1] });
    const problem = classifyAiError(e);
    if (problem === 'invalid' || problem === 'quota') setAiProblem(problem);
    if (problem === 'other') logError('ai', e);
  }
}

// A new key: forget past failures, so the next sweep tries everything.
onApiKeyChanged(() => attempts.clear());
