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

// Note-to-note (document-document) similarity is noisier than
// query-to-document: calibrated samples showed a genuinely related pair
// scoring as low as 0.60 while an unrelated pair scored 0.61 — the two
// distributions overlap, so no single cutoff cleanly separates them for
// short, topically-varied notes. 0.75 (the original value here) was
// higher than every related sample observed, meaning this almost never
// matched anything. Set low enough to admit real matches; `limit` below
// is what actually keeps this useful — ranking (closest few notes) is
// more reliable than an absolute quality gate in this embedding space.
const DOC_MIN_SIMILARITY = 0.6;

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
  minSimilarity = DOC_MIN_SIMILARITY,
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
