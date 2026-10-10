import { useEffect, useRef } from 'react';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { resolvePendingEntry } from '@/lib/capture';
import { embedBatch, embeddableText, toBlob, EMBEDDING_MODEL, EMBEDDING_DIMS } from '@/lib/embeddings';
import { getEmbeddedItemIds, upsertEmbedding } from '@/lib/db';
import type { MnemoItem } from '@/types/mnemo';

// One request per batch, bounded so a single call can't grow unbounded as
// the library does. Non-critical background maintenance — if a batch fails
// (offline, rate-limited), the remaining items are simply picked up on the
// next launch, so there's no need to retry within the same sweep.
const BACKFILL_BATCH_SIZE = 20;

async function backfillEmbeddings(items: MnemoItem[]): Promise<void> {
  try {
    const embeddedIds = await getEmbeddedItemIds();
    // Only structured (non-pending) items have stable enough content to
    // embed — a pending item's text is about to be rewritten once its own
    // structuring finishes, which will embed it then.
    const unembedded = items.filter((item) => !item.pending && !embeddedIds.has(item.id));

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
              model: EMBEDDING_MODEL,
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

/**
 * Invisible component mounted at the app root. On startup it:
 * 1. Retries AI structuring for any entry saved while offline or that
 *    never finished.
 * 2. Backfills embeddings for already-structured notes that don't have one
 *    yet — covers notes created before this feature shipped, and any that
 *    failed to embed earlier (rate limits, offline).
 */
export function PendingProcessor() {
  const store = useMnemoStore();
  const { items, entries, isLoaded } = store;
  const hasRun = useRef(false);

  useEffect(() => {
    if (!isLoaded || hasRun.current) return;
    hasRun.current = true;

    for (const entry of entries.filter((e) => e.pending)) {
      resolvePendingEntry(entry, store);
    }

    backfillEmbeddings(items);
  }, [isLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
