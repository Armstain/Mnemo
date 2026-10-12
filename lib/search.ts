import { embedText, fromBlob, dot } from '@/lib/embeddings';
import { getAllEmbeddings } from '@/lib/db';
import { bm25Scored, tokenize } from '@/lib/bm25';
import { telling } from '@/lib/filing';
import type { MnemoItem } from '@/types/mnemo';

// The standard constant from the original Reciprocal Rank Fusion paper —
// dampens the impact of rank 1 vs rank 2 so one retriever's top pick
// doesn't automatically dominate.
const RRF_K = 60;

// Cap the vector side to its best matches before fusing. Without this, a
// long tail of low-similarity notes (every embedded note has *some*
// similarity to any query) would all enter the fusion and dilute results
// that keyword search found precisely.
const VECTOR_TOP_K = 30;

// Query-to-document cosine similarity has a high floor — it is NOT close
// to 0 for unrelated content, because query/document embeddings share
// general language structure regardless of topic. Calibrated against
// gemini-embedding-2 (768 dims, RETRIEVAL_QUERY vs RETRIEVAL_DOCUMENT):
// clearly unrelated notes scored 0.56-0.62, a strongly relevant note
// scored 0.75. Below this floor, *everything* embedded scores as a
// "match" regardless of topic — which is exactly the bug where searching
// "software" surfaced unrelated notes: with no threshold, `vectorRank`
// returned its top 30 by score no matter how low that score was, and
// those all entered the RRF fusion below. Biased toward precision (fewer
// false positives) since BM25 already catches literal keyword matches
// that this filters out — nothing is lost, only the weak semantic boost.
const QUERY_MIN_SIMILARITY = 0.65;

/**
 * Ranks items by embedding similarity to the query, best first, excluding
 * anything below `QUERY_MIN_SIMILARITY`. Returns `[]` — never throws — if
 * there are no vectors yet, nothing clears the bar, or the query embed
 * fails (offline, rate-limited); `hybridSearch` degrades to pure BM25 in
 * that case, same as the rest of the AI layer's contract.
 */
async function vectorRank(query: string, items: MnemoItem[]): Promise<MnemoItem[]> {
  const rows = await getAllEmbeddings();
  if (rows.length === 0) return [];

  const byId = new Map(items.map((item) => [item.id, item]));
  const queryVector = await embedText(query, 'RETRIEVAL_QUERY');

  return rows
    .map((row) => {
      const item = byId.get(row.itemId);
      return item ? { doc: item, score: dot(queryVector, fromBlob(row.vector)) } : null;
    })
    .filter((x): x is { doc: MnemoItem; score: number } => x !== null && x.score >= QUERY_MIN_SIMILARITY)
    .sort((a, b) => b.score - a.score)
    .slice(0, VECTOR_TOP_K)
    .map(({ doc }) => doc);
}

/**
 * Fuses any number of best-first rankings via Reciprocal Rank Fusion —
 * rank-based rather than score-based, since BM25 and cosine similarity
 * live on incompatible scales and comparing raw scores between them would
 * be meaningless. A doc missing from a ranking simply contributes nothing
 * from that source; it only needs to appear in at least one.
 */
function reciprocalRankFusion(rankings: MnemoItem[][]): MnemoItem[] {
  const scores = new Map<string, number>();
  const byId = new Map<string, MnemoItem>();

  for (const ranking of rankings) {
    ranking.forEach((doc, rank) => {
      byId.set(doc.id, doc);
      scores.set(doc.id, (scores.get(doc.id) ?? 0) + 1 / (RRF_K + rank + 1));
    });
  }

  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => byId.get(id)!);
}

/**
 * Hybrid keyword + semantic search — finds notes that share the query's
 * meaning even with zero shared words (e.g. query "travel documents"
 * matching a note about "passport renewal"). Falls back to pure BM25
 * whenever the vector side is unavailable: search must never break.
 */
export async function hybridSearch(query: string, items: MnemoItem[]): Promise<MnemoItem[]> {
  if (!query.trim()) return items;

  const keywordRanking = bm25Scored(query, items).map(({ doc }) => doc);

  let semanticRanking: MnemoItem[] = [];
  try {
    semanticRanking = await vectorRank(query, items);
  } catch {
    // Offline / rate-limited — degrade to keyword-only below.
  }

  if (semanticRanking.length === 0) return keywordRanking;
  return reciprocalRankFusion([keywordRanking, semanticRanking]);
}

// Shown on a thread as "Related threads", so each one needs a reason the
// person can see. Note-to-note similarity is noisy: calibrated samples had
// a genuinely related pair as low as 0.60 and an unrelated pair at 0.61,
// so no single cutoff separates them for short notes. A match therefore
// needs a shared tag on top of fair similarity, or very high similarity on
// its own.
const RELATED_WITH_TAG = 0.66;
const RELATED_ALONE = 0.8;

export interface RelatedThread {
  item: MnemoItem;
  /** One line saying why, e.g. "Also tagged #travel". */
  reason: string;
}

/** A few threads clearly connected to this one, each with its reason. */
export async function relatedThreads(
  itemId: string,
  items: MnemoItem[],
  limit = 3,
): Promise<RelatedThread[]> {
  try {
    const self = items.find((i) => i.id === itemId);
    const rows = await getAllEmbeddings();
    const selfRow = rows.find((r) => r.itemId === itemId);
    if (!self) return [];
    if (!selfRow) return relatedByWords(self, items, limit);

    const selfVector = fromBlob(selfRow.vector);
    const selfTags = new Set(self.tags.map((t) => t.toLowerCase()));
    const byId = new Map(items.map((item) => [item.id, item]));
    const found: (RelatedThread & { score: number })[] = [];

    for (const row of rows) {
      if (row.itemId === itemId) continue;
      const item = byId.get(row.itemId);
      if (!item || item.status === 'archived') continue;
      const score = dot(selfVector, fromBlob(row.vector));
      const shared = item.tags.filter((t) => selfTags.has(t.toLowerCase()));
      if (shared.length > 0 && score >= RELATED_WITH_TAG) {
        found.push({ item, score, reason: `Also tagged ${shared.slice(0, 2).map((t) => `#${t}`).join(' ')}` });
      } else if (score >= RELATED_ALONE) {
        found.push({ item, score, reason: 'Very similar topic' });
      }
    }
    return found
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ item, reason }) => ({ item, reason }));
  } catch {
    return [];
  }
}

/**
 * Without embeddings (offline, or not embedded yet): threads that share a
 * tag, or a telling word in both titles. Few and plainly explained.
 */
export function relatedByWords(self: MnemoItem, items: MnemoItem[], limit = 3): RelatedThread[] {
  const selfTags = new Set(self.tags.map((t) => t.toLowerCase()));
  const selfTitle = telling(tokenize(self.title));
  const found: (RelatedThread & { score: number })[] = [];
  for (const item of items) {
    if (item.id === self.id || item.status === 'archived' || item.pending) continue;
    const shared = item.tags.filter((t) => selfTags.has(t.toLowerCase()));
    if (shared.length > 0) {
      found.push({ item, score: 2 + shared.length, reason: `Also tagged ${shared.slice(0, 2).map((t) => `#${t}`).join(' ')}` });
      continue;
    }
    const words = [...telling(tokenize(item.title))].filter((w) => selfTitle.has(w));
    if (words.length > 0) found.push({ item, score: words.length, reason: `Also about “${words[0]}”` });
  }
  return found
    .sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt)
    .slice(0, limit)
    .map(({ item, reason }) => ({ item, reason }));
}
