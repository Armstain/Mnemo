import { embedText, embeddingModel } from '@/lib/embeddings';
import { getChunkVectors, getVectors } from '@/lib/db';
import { bm25Scored, rrfScore } from '@/lib/bm25';
import { relatedLocally, type RelatedOptions, type RelatedThread } from '@/lib/related';
import { chunkEntries, MIN_SIMILARITY, retrieve, type Hit, type RetrieveOptions } from '@/lib/retrieve';
import { dot } from '@/lib/vector-math';
import type { Entry, MnemoItem } from '@/types/mnemo';

/** The vector side is capped to its best matches before fusing, so a long tail of weak matches doesn't dilute what keyword search found precisely. */
const VECTOR_TOP_K = 30;

// The search box and "Ask your notes" ask about the same words moments
// apart: the question is embedded once.
let lastQuery: { text: string; model: string; vector: Promise<Float32Array> } | null = null;

async function embedQuery(query: string): Promise<Float32Array> {
  const text = query.trim();
  const model = await embeddingModel();
  if (lastQuery?.text !== text || lastQuery.model !== model) {
    const vector = embedText(text, 'RETRIEVAL_QUERY');
    lastQuery = { text, model, vector };
    vector.catch(() => {
      if (lastQuery?.vector === vector) lastQuery = null;
    });
  }
  return lastQuery.vector;
}

/**
 * Ranks items by embedding similarity to the query, best first, excluding
 * anything below `MIN_SIMILARITY`. Returns `[]` — never throws — if
 * there are no vectors yet, nothing clears the bar, or the query embed
 * fails (offline, rate-limited); `hybridSearch` degrades to pure BM25 in
 * that case, same as the rest of the AI layer's contract.
 */
async function vectorRank(query: string, items: MnemoItem[]): Promise<MnemoItem[]> {
  const vectors = await getVectors(await embeddingModel());
  if (vectors.size === 0) return [];

  const queryVector = await embedQuery(query);

  return items
    .map((item) => {
      const vector = vectors.get(item.id);
      return vector ? { doc: item, score: dot(queryVector, vector) } : null;
    })
    .filter((x): x is { doc: MnemoItem; score: number } => x !== null && x.score >= MIN_SIMILARITY)
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
      scores.set(doc.id, (scores.get(doc.id) ?? 0) + rrfScore(rank));
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
  options: Pick<RelatedOptions, 'entries' | 'places'> = {},
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

/** How many passages answer a question: enough to answer from, few enough to keep the request small. */
const PASSAGES = 6;

/**
 * "What did I say about X": the passages of these threads that best answer
 * a question (lib/retrieve.ts). Words are always read; meaning is added
 * when search by meaning is on and the passages have vectors; with it off
 * nothing leaves the phone. Never throws: without vectors, or offline, it
 * is the keyword ranking.
 */
export async function findPassages(query: string, items: MnemoItem[], entries: Entry[]): Promise<Hit[]> {
  const chunks = chunkEntries(items, entries);
  let vectors: RetrieveOptions = {};
  try {
    const model = await embeddingModel();
    const chunkVectors = await getChunkVectors(model);
    if (chunkVectors.size > 0) {
      vectors = { queryVector: await embedQuery(query), chunkVectors, threadVectors: await getVectors(model) };
    }
  } catch {
    // Search by meaning is off, or there's no connection.
  }
  return retrieve(query, chunks, { ...vectors, limit: PASSAGES });
}
