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

function termFrequency(term: string, tokens: string[]): number {
  let count = 0;
  for (const t of tokens) {
    if (t === term) count++;
  }
  return count;
}

export interface ScoredItem {
  doc: MnemoItem;
  score: number;
}

/**
 * Rank documents by BM25 score against the given query, keeping the raw
 * score — `lib/search.ts` needs it to fuse this ranking with vector
 * search. Returns `[]` for an empty query (no ranking to do); callers that
 * want "show everything when there's no query" handle that themselves, see
 * `bm25Search` below.
 */
export function bm25Scored(query: string, documents: MnemoItem[]): ScoredItem[] {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  const docTokens = documents.map((doc) =>
    tokenize(
      `${doc.title} ${doc.content} ${doc.nextStep ?? ''} ${doc.whereLeftOff ?? ''} ${doc.tags?.join(' ') ?? ''} ${doc.category}`
    )
  );

  const N = documents.length;
  const avgdl =
    docTokens.reduce((sum, tokens) => sum + tokens.length, 0) / (N || 1);

  const idf = (term: string): number => {
    const ni = docTokens.filter((tokens) => tokens.includes(term)).length;
    return Math.log((N - ni + 0.5) / (ni + 0.5) + 1);
  };

  const scored = documents.map((doc, i) => {
    const tokens = docTokens[i];
    const dl = tokens.length;
    let score = 0;

    for (const term of queryTerms) {
      const tf = termFrequency(term, tokens);
      if (tf === 0) continue;
      const termIdf = idf(term);
      score +=
        termIdf *
        ((tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (dl / avgdl))));
    }

    return { doc, score };
  });

  return scored.filter(({ score }) => score > 0).sort((a, b) => b.score - a.score);
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
