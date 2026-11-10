import { embedText, embeddingModel, dot } from '@/lib/embeddings';
import { getVectors } from '@/lib/db';
import { bm25Scored } from '@/lib/bm25';
import { relatedLocally, type RelatedOptions, type RelatedThread } from '@/lib/related';
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
  const vectors = await getVectors(await embeddingModel());
  if (vectors.size === 0) return [];

  const queryVector = await embedText(query, 'RETRIEVAL_QUERY');

  return items
    .map((item) => {
      const vector = vectors.get(item.id);
      return vector ? { doc: item, score: dot(queryVector, vector) } : null;
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

export type { RelatedThread } from '@/lib/related';

/**
 * A few threads clearly connected to this one, each with its reason. Worked
 * out on the phone (lib/related.ts); vectors already stored add to it, and
 * nothing is requested, so it's the same offline.
 */
export async function relatedThreads(
  itemId: string,
  items: MnemoItem[],
  options: Pick<RelatedOptions, 'entries' | 'places' | 'limit'> = {},
): Promise<RelatedThread[]> {
  const self = items.find((i) => i.id === itemId);
  if (!self) return [];
  let vectors: Map<string, Float32Array> | undefined;
  try {
    vectors = await getVectors(await embeddingModel());
  } catch {
    // No vectors to read: the other signs stand without them.
  }
  try {
    return relatedLocally(self, items, { ...options, vectors });
  } catch {
    return [];
  }
}
