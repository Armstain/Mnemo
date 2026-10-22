import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { finishOnDevice, resolvePendingEntry, retryWaitingNow } from '@/lib/capture';
import { deleteUnusedAudio } from '@/lib/voice-audio';
import { getPreferences, setPreferences, usePreferences } from '@/lib/preferences';
import { confirmAction } from '@/utils/confirm';
import { onApiKeyChanged } from '@/lib/api-key';
import { aiEnabled, appReady } from '@/lib/ai-mode';
import { embedBatch, embeddableText, embeddingModel, toBlob, EMBEDDING_DIMS } from '@/lib/embeddings';
import { getEmbeddedItemIds, upsertEmbedding } from '@/lib/db';
import type { MnemoItem } from '@/types/mnemo';

// One request per batch, bounded so a single call can't grow unbounded as
// the library does. Non-critical background maintenance — if a batch fails
// (offline, rate-limited), the remaining items are simply picked up on the
// next launch, so there's no need to retry within the same sweep.
const BACKFILL_BATCH_SIZE = 20;

/** Made before Gemini was turned on, and not agreed to be sent since. */
function earlier(item: MnemoItem): boolean {
  const before = getPreferences().earlierNotesBefore;
  return before !== undefined && item.createdAt < before;
}

async function unembeddedOf(items: MnemoItem[]): Promise<MnemoItem[]> {
  const embeddedIds = await getEmbeddedItemIds(await embeddingModel());
  // Only structured (non-pending) items have stable enough content to
  // embed — a pending item's text is about to be rewritten once its own
  // structuring finishes, which will embed it then.
  return items.filter((item) => !item.pending && !embeddedIds.has(item.id));
}

/**
 * Once after Gemini is turned on: notes written before stay on the phone
 * (keyword search only) unless the person says to make them searchable by
 * meaning, which sends their text to Google. Not asked when there are none.
 */
async function askAboutEarlierNotes(items: MnemoItem[], onYes: () => void): Promise<void> {
  const prefs = getPreferences();
  if (prefs.earlierNotesBefore === undefined || prefs.earlierNotesAsked) return;
  const count = (await unembeddedOf(items)).filter(earlier).length;
  if (count === 0) {
    setPreferences({ earlierNotesAsked: true });
    return;
  }
  confirmAction({
    title: 'Your earlier notes',
    message:
      `${count} ${count === 1 ? 'thread was' : 'threads were'} written before Gemini was on, and stayed on this phone. ` +
      'Make them searchable by meaning too? Their text is sent to Google to do it. Either way, they keep their titles and stay where they are.',
    confirmLabel: 'Make searchable',
    cancelLabel: 'Keep on phone',
    onConfirm: () => {
      setPreferences({ earlierNotesAsked: true, earlierNotesBefore: undefined });
      onYes();
    },
    onCancel: () => setPreferences({ earlierNotesAsked: true }),
  });
}

async function backfillEmbeddings(items: MnemoItem[]): Promise<void> {
  try {
    const model = await embeddingModel();
    const unembedded = (await unembeddedOf(items)).filter((item) => !earlier(item));

    for (let i = 0; i < unembedded.length; i += BACKFILL_BATCH_SIZE) {
      const batch = unembedded.slice(i, i + BACKFILL_BATCH_SIZE);
      try {
        const vectors = await embedBatch(batch.map((item) => embeddableText(item)));
        await Promise.all(
          batch.map((item, idx) => {
            const vector = vectors[idx];
            if (!vector || vector.length === 0) return undefined;
            return upsertEmbedding({
              itemId: item.id,
              vector: toBlob(vector),
              model,
              dims: EMBEDDING_DIMS,
            });
          }),
        );
      } catch {
        // Stop this sweep — offline or rate-limited. Retried next launch.
        break;
      }
    }
  } catch {
    // Background maintenance only — never let it surface to the user.
  }
}

const SWEEP_EVERY_MS = 60_000;

/**
 * Invisible component mounted at the app root. It:
 * 1. Sends notes still waiting for Gemini, at startup, whenever the app
 *    comes back to the foreground, and every minute while any wait (each
 *    note backs off on its own after a failure; see resolvePendingEntry).
 * 2. Offline, finishes any waiting note with the phone's own reading.
 * 3. Backfills embeddings for notes that don't have one yet, except
 *    notes written before Gemini was turned on, until the person agrees.
 */
export function PendingProcessor() {
  const store = useMnemoStore();
  const { isLoaded } = store;
  const { aiMode } = usePreferences();
  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;
    let backfilled = false;

    const sweep = () => {
      if (cancelled) return;
      const current = storeRef.current;
      const { entries, items } = current.snapshot();
      const pending = entries.filter((e) => e.pending);
      if (!aiEnabled()) {
        // Nothing will come from Gemini: finish them as the phone reads them.
        // A recording with no words yet waits (the phone can't write one out):
        // turning Gemini back on writes it out.
        const waiting = pending.filter((e) => e.pendingAudioUri && !e.pendingRawText);
        for (const entry of pending) if (!waiting.includes(entry)) finishOnDevice(entry, current);
        for (const item of items.filter((i) => i.pending && !waiting.some((e) => e.threadId === i.id))) {
          current.updateItem(item.id, { pending: false });
        }
        return;
      }
      for (const entry of pending) resolvePendingEntry(entry, current);
      if (!backfilled) {
        backfilled = true;
        backfillEmbeddings(items);
        askAboutEarlierNotes(items, () => backfillEmbeddings(storeRef.current.snapshot().items));
      }
    };

    appReady.then(() => {
      // Recordings of notes deleted before they were written out.
      deleteUnusedAudio(storeRef.current.snapshot().entries.filter((e) => e.pending).map((e) => e.pendingAudioUri));
      sweep();
    });
    const timer = setInterval(() => {
      if (storeRef.current.snapshot().entries.some((e) => e.pending)) sweep();
    }, SWEEP_EVERY_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      // Back in the app: try every waiting note now, not after its back-off.
      retryWaitingNow();
      sweep();
    });
    // A new key: try the waiting notes right away (after it's stored).
    const offKey = onApiKeyChanged(() => setTimeout(sweep, 0));
    return () => {
      cancelled = true;
      offKey();
      clearInterval(timer);
      subscription.remove();
    };
  }, [isLoaded, aiMode]);

  return null;
}
