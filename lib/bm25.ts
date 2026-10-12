import type { MnemoItem } from '@/types/mnemo';

const K1 = 1.5; // Term frequency saturation — controls how quickly TF effect diminishes
const B = 0.75;  // Document length normalization — 0 = no length norm, 1 = full length norm

/** Minimum number of characters for a token to be indexed. Excludes noise like "a", "I". */
const MIN_TOKEN_LENGTH = 2;

// Bangla words carry their endings ("ট্যুরের", "ঢাকায়", "বইগুলো"); without
// them "ট্যুর" finds "ট্যুরের". Longest first.
const BANGLA_ENDINGS = ['গুলোর', 'গুলো', 'গুলি', 'দের', 'েরা', 'ের', 'এর', 'য়ের', 'কে', 'তে', 'টা', 'টি', 'টার', 'য়', 'র', 'ে']
  .map((e) => e.normalize('NFC'))
  .sort((a, b) => b.length - a.length);

function stem(token: string): string {
  if (/[\u0980-\u09FF]/.test(token)) {
    for (const ending of BANGLA_ENDINGS) {
      if (token.length > ending.length + 1 && token.endsWith(ending)) return token.slice(0, -ending.length);
    }
    return token;
  }
  // English plurals: "tickets" finds "ticket".
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

/**
 * Words for matching, in any script the app meets: Latin (with accents),
 * Bangla and digits. Punctuation splits words; Bangla vowel signs don't.
 */
export function tokenize(text: string): string[] {
  let normal = text.toLowerCase();
  try {
    normal = normal.normalize('NFC');
  } catch {
    // Older engines: compare as typed.
  }
  return normal
    .replace(/[^a-z0-9\u00c0-\u024f\u0980-\u09ff]+/g, ' ')
    .replace(/[\u0964\u0965]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= MIN_TOKEN_LENGTH)
    .map(stem);
}

export interface ScoredItem {
  doc: MnemoItem;
  score: number;
}

interface IndexedDoc {
  /** How often each word appears. */
  tf: Map<string, number>;
  length: number;
}

interface Corpus {
  docs: IndexedDoc[];
  /** How many documents each word appears in. */
  df: Map<string, number>;
  avgdl: number;
}

// Tokenizing every note on every keystroke was most of a search's cost. A
// note's words are kept until it changes (its updatedAt moves), and a list
// of notes' word counts until the list itself changes.
const docCache = new Map<string, { updatedAt: number; doc: IndexedDoc }>();
const corpusCache = new WeakMap<MnemoItem[], Corpus>();

function indexDoc(item: MnemoItem): IndexedDoc {
  const cached = docCache.get(item.id);
  if (cached && cached.updatedAt === item.updatedAt) return cached.doc;
  const tokens = tokenize(
    `${item.title} ${item.content} ${item.nextStep ?? ''} ${item.whereLeftOff ?? ''} ${item.tags?.join(' ') ?? ''} ${item.category}`,
  );
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  const doc = { tf, length: tokens.length };
  docCache.set(item.id, { updatedAt: item.updatedAt, doc });
  return doc;
}

function corpusOf(documents: MnemoItem[]): Corpus {
  const cached = corpusCache.get(documents);
  if (cached) return cached;
  const docs = documents.map(indexDoc);
  const df = new Map<string, number>();
  let total = 0;
  for (const d of docs) {
    total += d.length;
    for (const term of d.tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const corpus = { docs, df, avgdl: total / (docs.length || 1) };
  corpusCache.set(documents, corpus);
  return corpus;
}

/**
 * Rank documents by BM25 score against the given query, keeping the raw
 * score — `lib/search.ts` needs it to fuse this ranking with vector
 * search. Returns `[]` for an empty query (no ranking to do); callers that
 * want "show everything when there's no query" handle that themselves, see
 * `bm25Search` below.
 */
export function bm25Scored(query: string, documents: MnemoItem[]): ScoredItem[] {
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0) return [];

  const { docs, df, avgdl } = corpusOf(documents);
  const N = documents.length;
  const idf = new Map(queryTerms.map((term) => {
    const ni = df.get(term) ?? 0;
    return [term, Math.log((N - ni + 0.5) / (ni + 0.5) + 1)] as const;
  }));

  const scored: ScoredItem[] = [];
  docs.forEach((d, i) => {
    let score = 0;
    for (const term of queryTerms) {
      const tf = d.tf.get(term);
      if (!tf) continue;
      score += idf.get(term)! * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (d.length / avgdl))));
    }
    if (score > 0) scored.push({ doc: documents[i], score });
  });
  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Rank documents by BM25 score against the given query.
 * Returns all documents when the query is empty (preserving original order).
 * Searches across title, content, nextStep, whereLeftOff, tags, and category.
 */
export function bm25Search(query: string, documents: MnemoItem[]): MnemoItem[] {
  if (!query.trim()) return documents;
  return bm25Scored(query, documents).map(({ doc }) => doc);
}
