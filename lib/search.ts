import { embedText, fromBlob, dot } from '@/lib/embeddings';
import { getAllEmbeddings } from '@/lib/db';
import { bm25Scored } from '@/lib/bm25';
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

/**
 * Ranks items by embedding similarity to the query, best first. Returns
 * `[]` — never throws — if there are no vectors yet or the query embed
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
    .filter((x): x is { doc: MnemoItem; score: number } => x !== null)
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

/**
 * Related notes for the detail screen: nearest neighbors by embedding
 * similarity, excluding the note itself. Returns `[]` if the note has no
 * vector yet (still pending, or embedding failed and hasn't been
 * backfilled) rather than throwing — this is a supplementary UI section,
 * never a blocking one.
 */
export async function relatedItems(
  itemId: string,
  items: MnemoItem[],
  limit = 5,
  minSimilarity = 0.75,
): Promise<MnemoItem[]> {
  try {
    const rows = await getAllEmbeddings();
    const selfRow = rows.find((r) => r.itemId === itemId);
    if (!selfRow) return [];

    const selfVector = fromBlob(selfRow.vector);
    const byId = new Map(items.map((item) => [item.id, item]));

    return rows
      .filter((row) => row.itemId !== itemId)
      .map((row) => {
        const item = byId.get(row.itemId);
        return item ? { doc: item, score: dot(selfVector, fromBlob(row.vector)) } : null;
      })
      .filter((x): x is { doc: MnemoItem; score: number } => x !== null && x.score >= minSimilarity)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ doc }) => doc);
  } catch {
    return [];
  }
}
