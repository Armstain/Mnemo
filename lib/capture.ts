import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, Paths } from 'expo-file-system';
import {
  processAudioDump,
  processVoiceDump,
  AiOffError,
  type ProcessedCapture,
} from '@/lib/gemini';
import { aiEnabled, setAiProblem } from '@/lib/ai-mode';
import { aiErrorText, classifyAiError, isNoConnection, onApiKeyChanged } from '@/lib/api-key';
import { logError } from '@/lib/errors';
import {
  embedText,
  embeddableText,
  toBlob,
  embeddingModel,
  EMBEDDING_DIMS,
} from '@/lib/embeddings';
import { getVectors, upsertEmbedding } from '@/lib/db';
import type { Block, Category, ChecklistItem, Entry, Filing, LaterStep, MnemoItem, PlaceReminder, ThreadKind } from '@/types/mnemo';
import { queueSteps } from '@/lib/when';
import type { CaptureStore } from '@/hooks/use-mnemo-store';
import { buildBlocks } from '@/lib/threads';
import { summarizeMeasures, trackedMetrics, verifyMeasures } from '@/lib/measures';
import { understand, type KnownMetric } from '@/lib/understand';
import { asKind } from '@/lib/kind';
import { getPlaces } from '@/lib/place-store';
import { readPlaceReminder } from '@/lib/places';
import { imageBase64, imagesOf } from '@/lib/images';
import { fetchLinkPreview, type LinkPreview, type PageContext } from '@/lib/link-preview';
import { languageOf } from '@/lib/language';
import { getPreferences, setPreferences } from '@/lib/preferences';
import { deleteAllAudio, deleteAudio, joinAudio, loadAudio, splitAudio } from '@/lib/voice-audio';
import { hasGroq, transcribeAudio } from '@/lib/groq';
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

/** Best-effort: a failure must never throw out of `structurePendingEntry` or leave the entry `pending`. */
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
    // PendingProcessor's backfill sweep retries.
  }
}

interface NoteInput {
  text: string;
  category: Category;
  threadId?: string;
  filing?: Filing;
  checklistItems?: ChecklistItem[];
  leftOff?: string;
  nextStep?: string;
  dueDate?: number;
  images?: Block[];
  links?: string[];
  title?: string;
  audio?: string[];
  place?: Pick<PlaceReminder, 'placeId' | 'on'>;
  store: CaptureStore;
}

function knownMetrics(store: CaptureStore, threadId?: string): KnownMetric[] {
  if (!threadId) return [];
  const entries = store.snapshot().entries.filter((e) => e.threadId === threadId);
  return summarizeMeasures(entries).map((m) => ({ metric: m.metric, unit: m.unit }));
}

// Shown by components/FilingNotifier.tsx.
export interface ReminderSetEvent {
  threadId: string;
  at: number;
  previous?: number;
}
const reminderListeners = new Set<(event: ReminderSetEvent) => void>();
export function onReminderSet(listener: (event: ReminderSetEvent) => void): () => void {
  reminderListeners.add(listener);
  return () => reminderListeners.delete(listener);
}
const reminderSet = (event: ReminderSetEvent) => reminderListeners.forEach((l) => l(event));

function withReminders(
  thread: MnemoItem,
  add: { due: number; step?: string; later: LaterStep[]; repeat?: MnemoItem['repeat']; force?: boolean },
): Partial<MnemoItem> {
  if (add.force || !thread.dueDate || thread.dueDate < Date.now()) {
    return { dueDate: add.due, repeat: add.repeat, ...(add.later.length > 0 ? { laterSteps: queueSteps(thread.laterSteps, add.later) } : {}) };
  }
  const queued = [{ at: add.due, step: add.step }, ...add.later].filter((l) => l.at !== thread.dueDate && (!thread.repeat || l.at > Date.now()));
  return queued.length > 0 ? { laterSteps: queueSteps(thread.laterSteps, queued) } : {};
}

function saveNote(source: Entry['source'], params: NoteInput): { threadId: string; entry: Entry } {
  const { category, threadId, store } = params;
  const words = params.text.trim();
  const images = params.images ?? [];
  const recorded = params.audio ?? [];
  const ai = aiEnabled() && (words.length > 0 || images.length > 0 || recorded.length > 0 || (params.links?.length ?? 0) > 0);
  const audio = ai ? recorded : [];
  if (!ai) deleteAudio(recorded);
  const reading = understand(words, { known: knownMetrics(store, threadId), monthFirst: monthFirst(), currency: localCurrency() });

  // With AI on the text stays as said, so an edit made meanwhile is detected against it.
  const later = params.dueDate ? [] : reading.later;
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
    nextStep: params.nextStep?.trim() || (ai && later.length === 0 ? undefined : reading.nextStep),
    pending: ai,
    pendingRawText: ai ? words : undefined,
    pendingAudioUri: joinAudio(audio),
  };
  const due = params.dueDate ?? reading.due;
  const placeHit = getPreferences().places ? (params.place ?? readPlaceReminder(words, getPlaces())) : undefined;
  const place = placeHit ? { ...placeHit, step: params.nextStep?.trim() || reading.nextStep, setAt: Date.now() } : undefined;

  let saved: { threadId: string; entry: Entry };
  if (threadId) {
    saved = { threadId, entry: store.addEntry(threadId, { ...entryInput, filing: params.filing ?? { by: 'user' } }) };
    const thread = store.getThread(threadId);
    if (thread) {
      const updates: Partial<MnemoItem> = due
        ? withReminders(thread, {
            due,
            step: reading.nextStep,
            later,
            repeat: params.dueDate ? thread.repeat : reading.repeat,
            force: !!params.dueDate,
          })
        : {};
      if (reading.tags.some((t) => !thread.tags.includes(t))) updates.tags = [...new Set([...thread.tags, ...reading.tags])].slice(0, 8);
      if (place) updates.place = place;
      if (Object.keys(updates).length > 0) store.updateItem(threadId, updates);
      if (updates.dueDate) reminderSet({ threadId, at: updates.dueDate, previous: thread.dueDate });
    }
  } else {
    const fallback =
      checklist.length > 0 ? 'Checklist' : images.length > 0 ? 'Photo' : source === 'voice' ? 'Voice note' : 'Quick note';
    const created = store.createThread(
      {
        title: (reading.title || params.title?.trim() || fallback).slice(0, 80),
        category:
          category === 'general' && !ai
            ? reading.category ?? (words || !params.title ? undefined : understand(params.title, { monthFirst: monthFirst() }).category) ?? 'general'
            : category,
        // Replaced by Gemini's in resolvePendingEntry.
        kind: reading.kind,
        tags: reading.tags,
        status: 'active',
        dueDate: due,
        laterSteps: later.length > 0 ? later : undefined,
        repeat: params.dueDate ? undefined : reading.repeat,
        place,
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
const previews = new Map<string, Promise<LinkPreview | null>>();

function previewOf(url: string): Promise<LinkPreview | null> {
  let preview = previews.get(url);
  if (!preview) {
    preview = fetchLinkPreview(url);
    previews.set(url, preview);
    // Failed reads (no signal) are evicted so they retry.
    preview.then((p) => p || previews.delete(url));
  }
  return preview;
}

export function rememberPreview(url: string, preview: LinkPreview): void {
  previews.set(url, Promise.resolve(preview));
}

async function pagesOf(entry: Pick<Entry, 'blocks'>): Promise<PageContext[]> {
  const urls = [...new Set(entry.blocks.flatMap((b) => (b.kind === 'link' ? [b.url] : [])))].slice(0, 3);
  const read = await Promise.all(urls.map(async (url) => ({ url, preview: await previewOf(url) })));
  return read.flatMap((r) => (r.preview ? [{ url: r.url, ...r.preview }] : []));
}

/** Fire-and-forget; each link is tried once. */
export async function enrichLinks(entryId: string, store: CaptureStore): Promise<void> {
  const entry = store.snapshot().entries.find((e) => e.id === entryId);
  if (!entry) return;
  const todo = entry.blocks.flatMap((b) => (b.kind === 'link' && !b.title && !previewed.has(b.url) ? [b.url] : []));
  for (const url of todo) {
    previewed.add(url);
    const preview = await previewOf(url);
    if (!preview) continue;
    // Entry may have changed while the page loaded.
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

const REGION_CURRENCY: Record<string, string> = { BD: 'BDT', IN: 'INR', US: 'USD', GB: 'GBP', IE: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', PT: 'EUR', BE: 'EUR', AT: 'EUR', FI: 'EUR', GR: 'EUR' };
function localCurrency(): string | undefined {
  try {
    const { locale, timeZone } = Intl.DateTimeFormat().resolvedOptions();
    if (timeZone === 'Asia/Dhaka') return 'BDT';
    const region = locale.split('-').find((p) => /^[A-Z]{2}$/.test(p));
    return region ? REGION_CURRENCY[region] : undefined;
  } catch {
    return undefined;
  }
}

/** 3/4 is March 4 on phones set to US English, 3 April elsewhere. */
function monthFirst(): boolean {
  try {
    return /^en-US$/i.test(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return false;
  }
}

export function saveVoiceNote(params: Omit<NoteInput, 'checklistItems' | 'leftOff' | 'nextStep' | 'dueDate'>) {
  return saveNote('voice', params);
}

export function saveTextNote(params: NoteInput) {
  return saveNote('text', params);
}

export function saveSharedNote(params: NoteInput) {
  return saveNote('share', params);
}

/** For a pending note whose AI won't come (switched offline). */
/** An idea is filed under Ideas: one place for them, not a kind and a category that disagree. */
function ideaCategory(category: Category | undefined, kind: ThreadKind | undefined): Category | undefined {
  return kind === 'idea' && (!category || category === 'general') ? 'ideas' : category;
}

export function finishOnDevice(entry: Entry, store: CaptureStore): void {
  deleteAudio(entry.pendingAudioUri);
  const words = (entry.pendingRawText ?? textOf(entry)).trim();
  const reading = understand(words, { known: knownMetrics(store, entry.threadId), monthFirst: monthFirst(), currency: localCurrency() });
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
    pendingAudioUri: undefined,
  });
  const thread = store.getThread(entry.threadId);
  if (thread?.pending) {
    store.updateItem(thread.id, {
      title: thread.pinned?.title ? thread.title : reading.title || thread.title,
      category: thread.category === 'general' ? ideaCategory(reading.category, reading.kind) ?? 'general' : thread.category,
      kind: thread.kind ?? reading.kind,
      pending: false,
    });
  }
}

export function deleteAllRecordings(): void {
  try {
    new Directory(Paths.document, 'recordings').delete();
  } catch {
    // Already gone.
  }
  deleteAllAudio();
}

type PendingEntry = Pick<
  Entry,
  'id' | 'threadId' | 'blocks' | 'leftOff' | 'nextStep' | 'transcript' | 'pendingAudioUri' | 'pendingRawText'
>;

/** Throws on failure: for callers with their own error feedback (manual Retry). Background callers use `resolvePendingEntry`. */
export async function structurePendingEntry(
  entry: PendingEntry,
  store: CaptureStore,
): Promise<void> {
  // A manual Retry during a background run would process (and bill) the note twice.
  if (inFlight.has(entry.id)) return;
  inFlight.add(entry.id);
  try {
    await structure(entry, store);
  } finally {
    inFlight.delete(entry.id);
  }
}

const inFlight = new Set<string>();

/** For a Groq-written voice note while Gemini can't tidy it: titles the thread and sets a spoken reminder. */
function nameFromWords(store: CaptureStore, threadId: string, words: string): void {
  const thread = store.getThread(threadId);
  if (!thread) return;
  const reading = understand(words, { monthFirst: monthFirst(), currency: localCurrency() });
  const updates: Partial<MnemoItem> = {};
  if (thread.pending && !thread.pinned?.title && reading.title) updates.title = reading.title.slice(0, 80);
  if (reading.due && reading.due > Date.now() && !(thread.dueDate && thread.dueDate > Date.now())) {
    updates.dueDate = reading.due;
    updates.repeat = reading.repeat;
  }
  if (Object.keys(updates).length > 0) store.updateItem(threadId, updates);
  if (updates.dueDate) reminderSet({ threadId, at: updates.dueDate, previous: thread.dueDate });
}
/** More photos would be slow and costly. */
const MAX_PHOTOS_TO_AI = 3;

export function isStructuring(entryId: string): boolean {
  return inFlight.has(entryId);
}

function textOf(e: Pick<Entry, 'blocks'>): string {
  const block = e.blocks.find((b) => b.kind === 'text');
  return block && block.kind === 'text' ? block.markdown.trim() : '';
}

async function structure(entry: PendingEntry, store: CaptureStore): Promise<void> {
  const snap = store.snapshot();
  const live = snap.entries.find((e) => e.id === entry.id);
  if (!live) return deleteAudio(entry.pendingAudioUri);
  // Thread deleted or in its undo window: don't bring it back.
  if (!store.getThread(live.threadId)) return;
  const filedBy = live.filing.by;
  const named = filedBy === 'new' && !!store.getThread(live.threadId)?.pinned?.title;
  const matching = (filedBy === 'new' && !named) || filedBy === 'focus';
  const candidates = matching
    ? gatherCandidates({
        threads: snap.items,
        entries: snap.entries,
        // A new capture's placeholder thread isn't a candidate; the focus thread is.
        excludeId: filedBy === 'new' ? live.threadId : undefined,
        focusId: store.getFocusThreadId(),
        text: entry.pendingRawText,
      })
    : [];
  const tracks =
    filedBy === 'new' ? [] : trackedMetrics(snap.entries.filter((e) => e.threadId === live.threadId));
  const ctx = candidates.length > 0 || tracks.length > 0 ? { candidates, tracks } : undefined;

  let processed: ProcessedCapture;
  let transcript = entry.transcript;
  const photos = imagesOf([live]);
  const pages = await pagesOf(live);

  // Text as sent: an edit made meanwhile is detected against it.
  let shownText = (entry.pendingRawText ?? '').trim();
  let said: string | undefined;
  const recordings = splitAudio(entry.pendingAudioUri);
  const sound = recordings.length > 0 ? await loadAudio(recordings) : [];
  if (sound.length > 0) {
    try {
      processed = await processAudioDump(sound.map((a) => ({ data: a.data, mimeType: a.mimeType })), ctx, pages);
      said = processed.transcript?.trim() || undefined;
    } catch (e) {
      if (e instanceof AiOffError) throw e;
      // Fall back to Groq Whisper if a key exists; otherwise retried later with the recording.
      const words = hasGroq()
        ? await transcribeAudio(sound, { banglaSpeaker: getPreferences().speechLang === 'bn-BD' }).catch((groqError) => {
            // Surfaces in the Settings problem report.
            logError('groq', groqError);
            return '';
          })
        : '';
      if (!words) throw e;
      said = words;
      const nowEntry = store.snapshot().entries.find((x) => x.id === entry.id);
      if (!nowEntry) return deleteAudio(recordings);
      if (!textOf(nowEntry)) {
        store.updateEntry(entry.id, { blocks: [...buildBlocks({ text: words }), ...nowEntry.blocks], transcript: words });
        shownText = words;
      }
      store.updateEntry(entry.id, { pendingRawText: words, pendingAudioUri: undefined });
      deleteAudio(recordings);
      nameFromWords(store, nowEntry.threadId, words);
      processed = await processVoiceDump(words, ctx, [], pages);
    }
    deleteAudio(recordings);
  } else if (recordings.length > 0 && !entry.pendingRawText) {
    store.updateEntry(entry.id, { pending: false, pendingAudioUri: undefined });
    return;
  } else if (entry.pendingRawText || photos.length > 0 || pages.length > 0) {
    transcript = transcript ?? (entry.pendingRawText || undefined);
    const images = (await Promise.all(photos.slice(0, MAX_PHOTOS_TO_AI).map(imageBase64))).filter(
      (b): b is string => !!b,
    );
    processed = await processVoiceDump(entry.pendingRawText ?? '', ctx, images, pages);
  } else {
    store.updateEntry(entry.id, { pending: false });
    return;
  }
  // Text Gemini read off a photo is not something the person said.
  transcript = said ?? transcript ?? (photos.length > 0 ? undefined : processed.transcript);
  const spoken = said ? languageOf(said) : null;
  if (spoken && spoken !== getPreferences().speechLang) setPreferences({ speechLang: spoken });

  // Edits made during the AI call win; numbers and links are still extracted from them.
  const now = store.snapshot().entries.find((e) => e.id === entry.id);
  if (!now || !store.getThread(now.threadId)) return;
  const editedMeanwhile = textOf(now) !== shownText;

  // Every number must appear in the person's words (for a photo, in what Gemini read off it).
  const measures = verifyMeasures(
    processed.measures,
    editedMeanwhile
      ? textOf(now)
      : [entry.pendingRawText, said, photos.length > 0 ? processed.transcript : undefined].filter(Boolean).join('\n') ||
          processed.transcript ||
          processed.notes,
  );
  const handMadeChecklists = now.blocks.filter((b) => b.kind === 'checklist');
  const existingLinks = now.blocks.flatMap((b) => (b.kind === 'link' ? [b.url] : []));
  const links = [...new Set([...existingLinks, ...(processed.links ?? [])])];
  // Hand corrections stay; a link preview arriving meanwhile isn't one.
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
  // "note" comes back as no kind, which is an answer too.
  const aiKind = asKind(processed.kind);
  const aiCategory = ideaCategory(asCategory(processed.suggestedCategory), aiKind);

  // A recording had no words to find a reminder in at save time; the written-out words do.
  const heard =
    said && !editedMeanwhile
      ? understand(said, { now: now.createdAt, monthFirst: monthFirst(), currency: localCurrency() })
      : undefined;
  const heardPlace = said && !editedMeanwhile && getPreferences().places ? readPlaceReminder(said, getPlaces()) : undefined;
  const remindFromSound = (threadId: string) => {
    const t = store.getThread(threadId);
    if (!t) return;
    if (heardPlace && !(t.place && !t.place.firedAt && t.place.placeId === heardPlace.placeId && t.place.on === heardPlace.on)) {
      store.updateItem(threadId, { place: { ...heardPlace, step: nextStep ?? heard?.nextStep, setAt: Date.now() } });
    }
    if (!heard?.due || heard.due < Date.now() || (t.dueDate && t.dueDate > Date.now())) return;
    store.updateItem(threadId, { dueDate: heard.due, repeat: heard.repeat });
    reminderSet({ threadId, at: heard.due, previous: t.dueDate });
  };

  // ─── Filing ───
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
        // The model's answer stands alone.
      }
    }
    decision = decideFiling({ filedBy, match: processed.thread, candidates, similarity });
  }

  if (decision.action === 'attach') {
    const own = store.getThread(now.threadId);
    store.moveEntry(entry.id, decision.threadId, { by: 'auto', confidence: decision.confidence });
    const emptied = own && !store.snapshot().entries.some((e) => e.threadId === own.id) ? own : undefined;
    if (emptied) store.removeThreadNow(emptied.id);
    const target = store.getThread(decision.threadId);
    if (!target) return;
    if (emptied?.dueDate) {
      const carried = withReminders(target, {
        due: emptied.dueDate,
        step: nextStep ?? emptied.nextStep,
        later: emptied.laterSteps ?? [],
        repeat: emptied.repeat,
      });
      if (Object.keys(carried).length > 0) store.updateItem(target.id, carried);
      if (carried.dueDate) reminderSet({ threadId: target.id, at: carried.dueDate, previous: target.dueDate });
    }
    if (emptied?.place && !emptied.place.firedAt && !(target.place && !target.place.firedAt)) {
      store.updateItem(target.id, { place: emptied.place });
    }
    if (tags.length > 0) {
      store.updateItem(target.id, { tags: [...new Set([...target.tags, ...tags])].slice(0, 8) });
    }
    remindFromSound(target.id);
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
    store.updateItem(created.id, { kind: aiKind, ...(processed.summary ? { aiSummary: processed.summary } : {}) });
    remindFromSound(created.id);
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
      ...(thread.category === 'general' && aiCategory ? { category: aiCategory } : {}),
      ...(thread.pinned?.kind || processed.kind === undefined ? {} : { kind: aiKind }),
      aiSummary: processed.summary,
      pending: false,
      pendingAudioUri: undefined,
      pendingRawText: undefined,
      status: 'active',
    });
  } else if (tags.length > 0) {
    store.updateItem(thread.id, { tags: [...new Set([...thread.tags, ...tags])].slice(0, 8) });
  }
  remindFromSound(thread.id);

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

async function embedThread(store: CaptureStore, threadId: string): Promise<void> {
  const thread = store.getThread(threadId);
  if (!thread) return;
  await embedAndStore(thread);
}

const BACKOFF_MS = [30_000, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 30 * 60_000];
const attempts = new Map<string, { count: number; nextAt: number }>();

// ─── Safety-blocked notes ───
// Same content gets the same block, so the sweep skips it. Kept apart from `attempts`
// (which "try everything now" clears) and persisted. Keyed on content: an edit lets it through.

const BLOCKED_KEY = 'mnemo-ai-blocked';
let blocked = new Map<string, string>();
const blockedLoaded: Promise<void> = AsyncStorage.getItem(BLOCKED_KEY)
  .then((raw) => {
    const saved = raw ? JSON.parse(raw) : null;
    if (saved && typeof saved === 'object') blocked = new Map(Object.entries(saved).filter((e): e is [string, string] => typeof e[1] === 'string'));
  })
  .catch(() => undefined);

function saveBlocked(): void {
  AsyncStorage.setItem(BLOCKED_KEY, JSON.stringify(Object.fromEntries(blocked))).catch(() => {
    // Retried on the next change.
  });
}

function sentContent(e: Pick<Entry, 'pendingRawText' | 'pendingAudioUri' | 'blocks'>): string {
  return `${(e.pendingRawText ?? textOf(e)).trim()}|${e.pendingAudioUri ?? ''}`;
}

export function isBlockedNote(e: Pick<Entry, 'id' | 'pendingRawText' | 'pendingAudioUri' | 'blocks'>): boolean {
  const declined = blocked.get(e.id);
  return declined !== undefined && declined === sentContent(e);
}

function markBlocked(entryId: string, store: CaptureStore): void {
  const now = store.snapshot().entries.find((x) => x.id === entryId);
  if (!now) return;
  blocked.set(entryId, sentContent(now));
  saveBlocked();
}

function clearBlocked(entryId: string): void {
  if (blocked.delete(entryId)) saveBlocked();
}

/**
 * Google's filter misfires on ordinary notes ("remind me when I get to …"). Text the phone can
 * read is finished here, like offline, instead of waiting on a warning; a recording stays blocked
 * for Retry. True when it was finished.
 */
function declined(entryId: string, store: CaptureStore): boolean {
  const now = store.snapshot().entries.find((x) => x.id === entryId);
  if (now && !now.pendingAudioUri && (now.pendingRawText ?? textOf(now)).trim()) {
    clearBlocked(entryId);
    finishOnDevice(now, store);
    return true;
  }
  markBlocked(entryId, store);
  return false;
}

/** Sends now, safety block included. Throws like structurePendingEntry, except for a declined note the phone finished. */
export async function retryEntryNow(entry: PendingEntry, store: CaptureStore): Promise<void> {
  await blockedLoaded;
  clearBlocked(entry.id);
  attempts.delete(entry.id);
  try {
    await structurePendingEntry(entry, store);
  } catch (e) {
    if (classifyAiError(e) === 'blocked' && declined(entry.id, store)) return;
    throw e;
  }
}

/** Never throws; retries with back-off. Resolves true when every other waiting note would fail the same way, so a sweep stops. */
export async function resolvePendingEntry(entry: PendingEntry, store: CaptureStore): Promise<boolean> {
  await blockedLoaded;
  const current = store.snapshot().entries.find((x) => x.id === entry.id) ?? entry;
  // Declined before this version left it waiting; finish it now if the phone can.
  if (isBlockedNote(current)) {
    declined(entry.id, store);
    return false;
  }
  clearBlocked(entry.id);
  const previous = attempts.get(entry.id);
  if (previous && Date.now() < previous.nextAt) return false;
  try {
    await structurePendingEntry(entry, store);
    attempts.delete(entry.id);
    setAiProblem(null);
    return false;
  } catch (e) {
    if (e instanceof AiOffError) return true;
    // Nothing reached Gemini, so no back-off.
    if (isNoConnection(e)) {
      attempts.delete(entry.id);
      return true;
    }
    const problem = classifyAiError(e);
    if (problem === 'blocked') {
      attempts.delete(entry.id);
      logError('ai', e);
      declined(entry.id, store);
      return false;
    }
    const count = (previous?.count ?? 0) + 1;
    attempts.set(entry.id, { count, nextAt: Date.now() + BACKOFF_MS[Math.min(count, BACKOFF_MS.length) - 1] });
    if (problem === 'invalid' || problem === 'quota') setAiProblem(problem, problem === 'quota' ? aiErrorText(e) : null);
    // Only the first failure is logged; retries would repeat it.
    const worthLogging = problem === 'other' || problem === 'truncated' || problem === 'empty';
    if (worthLogging && !previous) logError('ai', e);
    return problem === 'invalid' || problem === 'quota' || problem === 'busy' || problem === 'offline';
  }
}

export function retryWaitingNow(): void {
  attempts.clear();
}

onApiKeyChanged(retryWaitingNow);
