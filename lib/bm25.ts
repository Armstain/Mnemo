import type { MnemoItem } from '@/types/mnemo';
import { nfc } from '@/utils/text';

export const K1 = 1.5;
export const B = 0.75;
const RRF_K = 60;

export const rrfScore = (rank: number): number => 1 / (RRF_K + rank + 1);

export const idf = (docsWith: number, docs: number): number => Math.log((docs - docsWith + 0.5) / (docsWith + 0.5) + 1);

export function termCounts(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}

export function searchableText(
  item: Pick<MnemoItem, 'title' | 'content' | 'nextStep' | 'whereLeftOff' | 'category'> & { tags?: string[] },
): string {
  return `${item.title} ${item.content} ${item.nextStep ?? ''} ${item.whereLeftOff ?? ''} ${item.tags?.join(' ') ?? ''} ${item.category}`;
}

const COMMON = new Set(
  (
    'the and for with this that from have has had was were are will would should could about into over just ' +
    'need today tomorrow yesterday then also some more very really what when where which who why how note ' +
    'taka spent paid got went did done make made take took call called get buy' +
    ' ami amar tumi ache ase gese hobe korte korbo kore kal aj ajke'
  ).split(' '),
);
const COMMON_BN = new Set('আমি আমার আজ কাল আজকে হবে করতে করবো করে আছে গেছে টাকা এবং আর'.split(' ').map(nfc));

/** The words in a text that could say what it's about. */
export function telling(words: string[]): Set<string> {
  return new Set(words.filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !COMMON.has(w) && !COMMON_BN.has(w)));
}

/** A word that only starts with what was typed counts this much of a whole match. */
const PREFIX_WEIGHT = 0.7;

/** Minimum number of characters for a token to be indexed. Excludes noise like "a", "I". */
const MIN_TOKEN_LENGTH = 2;

// Bangla words carry their endings ("ট্যুরের", "ঢাকায়", "বইগুলো"); without
// them "ট্যুর" finds "ট্যুরের". Longest first.
const BANGLA_ENDINGS = ['গুলোর', 'গুলো', 'গুলি', 'দের', 'েরা', 'ের', 'এর', 'য়ের', 'কে', 'তে', 'টা', 'টি', 'টার', 'য়', 'র', 'ে']
  .map((e) => e.normalize('NFC'))
  .sort((a, b) => b.length - a.length);

function stripBanglaEnding(token: string): string {
  for (const ending of BANGLA_ENDINGS) {
    if (token.length > ending.length + 1 && token.endsWith(ending)) return token.slice(0, -ending.length);
  }
  return token;
}

function stem(token: string): string {
  if (/[\u0980-\u09FF]/.test(token)) {
    // Twice, so a word and its forms land on the same key: "ডাক্তার" loses
    // its last "র" (it reads like "মামার"), so "ডাক্তারকে" and "ডাক্তারের"
    // must lose it too, not stop at "ডাক্তার". A key, not a word.
    return stripBanglaEnding(stripBanglaEnding(token));
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
  return nfc(text.toLowerCase())
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
  tf: Map<string, number>;
  length: number;
}

interface Corpus {
  docs: IndexedDoc[];
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
  const tokens = tokenize(searchableText(item));
  const doc = { tf: termCounts(tokens), length: tokens.length };
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
  const idfOf = (term: string) => idf(df.get(term) ?? 0, N);

  // The last word may be half typed: "passp" also counts words it starts,
  // a little less than the whole word would.
  const last = queryTerms[queryTerms.length - 1];
  const completions =
    last.length >= 2 && !/^\d+$/.test(last)
      ? [...df.keys()].filter((w) => w !== last && w.startsWith(last)).slice(0, 50)
      : [];
  const weighted: [string, number][] = [
    ...queryTerms.map((t) => [t, idfOf(t)] as [string, number]),
    ...completions.map((t) => [t, idfOf(t) * PREFIX_WEIGHT] as [string, number]),
  ];

  const scored: ScoredItem[] = [];
  docs.forEach((d, i) => {
    let score = 0;
    let lastMatched = false;
    for (const [term, weight] of weighted) {
      const tf = d.tf.get(term);
      if (!tf) continue;
      // One completion of the last word is enough; don't add up "pass", "passport", "passed".
      const isLast = term === last || completions.includes(term);
      if (isLast && lastMatched && term !== last) continue;
      if (isLast) lastMatched = true;
      score += weight * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (d.length / avgdl))));
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
