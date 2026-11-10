import { B, idf as idfOf, K1, rrfScore, telling, termCounts, tokenize } from '@/lib/bm25';
import { entryText } from '@/lib/threads';
import { dot } from '@/lib/vector-math';
import type { Entry, MnemoItem } from '@/types/mnemo';
import { nfc } from '@/utils/text';

// "Find what I said about X": the passages that answer a question, not the
// threads that mention its words. Notes are cut into passages; each is
// ranked by its words (always, on the phone) and by its meaning (when
// vectors are stored); the two rankings are fused; the best twenty are
// ranked again on how well they cover the question; near-copies are dropped.
// Nothing here makes a request: vectors are handed in by the caller.

export interface Chunk {
  /** `${entryId}#${n}`. */
  id: string;
  /** Of its text alone: the same words said twice share one vector. */
  hash: string;
  threadId: string;
  entryId: string;
  title: string;
  text: string;
  createdAt: number;
}

/** About a paragraph: long enough to hold a thought, short enough that its vector is about one thing. */
const CHUNK_CHARS = 700;

export function splitText(text: string, max = CHUNK_CHARS): string[] {
  const clean = text.replace(/\r/g, '').trim();
  if (clean.length <= max) return clean ? [clean] : [];
  const pieces: string[] = [];
  for (const paragraph of clean.split(/\n{2,}/)) {
    if (paragraph.length <= max) pieces.push(paragraph);
    else pieces.push(...(paragraph.match(/[^.!?।\n]+[.!?।]*\s*/g) ?? [paragraph]));
  }
  const out: string[] = [];
  let current = '';
  const flush = () => {
    if (current.trim()) out.push(current.trim());
    current = '';
  };
  for (let piece of pieces) {
    // A sentence longer than a passage is cut where it must be.
    while (piece.length > max) {
      flush();
      out.push(piece.slice(0, max).trim());
      piece = piece.slice(max);
    }
    if (current && current.length + piece.length + 1 > max) flush();
    current = current ? `${current}\n${piece}` : piece;
  }
  flush();
  return out;
}

/** A short key for a text, the same however it was spaced or cased. Two 32-bit FNV-1a hashes. */
export function textHash(text: string): string {
  const s = nfc(text).toLowerCase().replace(/\s+/g, ' ').trim();
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x85ebca6b) + 0x9e3779b9;
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

interface Piece {
  text: string;
  hash: string;
  /** Its words in order, for how close together a question's words fall. */
  tokens: string[];
  tf: Map<string, number>;
}

// Entries are replaced, never changed in place, so what's read from one holds until it's gone.
const pieceCache = new WeakMap<Entry, Piece[]>();

function piecesOf(entry: Entry): Piece[] {
  const cached = pieceCache.get(entry);
  if (cached) return cached;
  const pieces = splitText(entryText(entry)).map((text) => {
    const tokens = tokenize(text);
    return { text, hash: textHash(text), tokens, tf: termCounts(tokens) };
  });
  pieceCache.set(entry, pieces);
  return pieces;
}

const pieceOf = new WeakMap<Chunk, Piece>();

/** Every passage of these threads' entries. Notes still waiting to be read are left out. */
export function chunkEntries(items: MnemoItem[], entries: Entry[]): Chunk[] {
  const titles = new Map(items.filter((i) => i.status !== 'archived').map((i) => [i.id, i.title]));
  const out: Chunk[] = [];
  for (const entry of entries) {
    const title = titles.get(entry.threadId);
    if (title === undefined || entry.pending) continue;
    piecesOf(entry).forEach((piece, n) => {
      const chunk = {
        id: `${entry.id}#${n}`,
        hash: piece.hash,
        threadId: entry.threadId,
        entryId: entry.id,
        title,
        text: piece.text,
        createdAt: entry.createdAt,
      };
      pieceOf.set(chunk, piece);
      out.push(chunk);
    });
  }
  return out;
}

// Words of asking, not of what's asked about.
const ASKING = new Set(
  (
    'said say says tell told mention mentioned wrote write noted anything something everything thing things ' +
    'bolechi bolechilam bolsi likhechi likhechilam niye somporke ki kobe koto kothay keno'
  ).split(' '),
);

export function queryTerms(query: string): string[] {
  const all = [...new Set(tokenize(query))];
  const kept = [...telling(all)].filter((t) => !ASKING.has(t));
  // "what did I do" has none: better the plain words than nothing.
  return kept.length > 0 ? kept : all;
}

/**
 * What an English word keeps across its forms: "delivered" and "delivery",
 * "blocking" and "blocker". Undefined when too little would be left to
 * mean anything. Bangla words already lose their endings in `tokenize`.
 */
function rootOf(term: string): string | undefined {
  if (!/^[a-z]+$/.test(term) || term.length < 5) return undefined;
  const root = term.replace(/(ing|ed|er|ery|ion|ions|ies|es|ly|y|e)$/, '');
  return root.length >= 4 ? root : undefined;
}
/** Another form of the word counts this much of the word itself. */
const FORM_WEIGHT = 0.8;

/** How often a question's word is in a passage, counting its other forms for a little less. */
function countOf(tf: Map<string, number>, term: string, root: string | undefined): number {
  let count = tf.get(term) ?? 0;
  if (root) for (const [word, n] of tf) if (word !== term && word.startsWith(root)) count += n * FORM_WEIGHT;
  return count;
}

/** A thread's title counts as words of each of its passages, this many times over. */
const TITLE_TF = 2;

const KEYWORD_TOP = 50;
const VECTOR_TOP = 50;
/**
 * Query-to-document cosine similarity has a high floor, it is NOT close to 0 for unrelated content.
 * Calibrated against gemini-embedding-2 (768 dims, RETRIEVAL_QUERY vs RETRIEVAL_DOCUMENT): clearly
 * unrelated notes scored 0.56-0.62, a strongly relevant note 0.75. Below this, everything embedded
 * "matches". Biased toward precision: keyword search already catches the literal matches.
 */
export const MIN_SIMILARITY = 0.65;
const RERANK_TOP = 20;
/** Passages sharing this share of their words are the same thing said twice. */
const SAME_WORDS = 0.85;
const SAME_MEANING = 0.95;

export interface RetrieveOptions {
  /** `hybrid` (the default) is words alone when there are no vectors to read. */
  mode?: 'keyword' | 'vector' | 'hybrid';
  /** Rank the best twenty again on how well they cover the question. On unless said otherwise. */
  rerank?: boolean;
  /** The question's vector, if it could be made. */
  queryVector?: Float32Array;
  /** Passage vectors by `Chunk.hash`. */
  chunkVectors?: Map<string, Float32Array>;
  /** Thread vectors by thread id: what the passage's thread is about. */
  threadVectors?: Map<string, Float32Array>;
  minSimilarity?: number;
  limit?: number;
}

export interface Hit {
  chunk: Chunk;
  score: number;
}

/** Each part of the second ranking, 0 to 1, and what it counts for. */
const RERANK = { coverage: 0.45, title: 0.15, near: 0.15, phrase: 0.1, meaning: 0.35, thread: 0.1, prior: 0.2 };

function unit(similarity: number): number {
  return Math.max(0, Math.min(1, (similarity - 0.55) / 0.25));
}

/** How tightly the question's words sit together in a passage: all of them side by side is 1. */
function nearness(tokens: string[], terms: Set<string>): number {
  const present = new Set(tokens.filter((t) => terms.has(t)));
  if (present.size < 2) return 0;
  const counts = new Map<string, number>();
  let have = 0;
  let best = Infinity;
  let left = 0;
  for (let right = 0; right < tokens.length; right++) {
    const t = tokens[right];
    if (!present.has(t)) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
    if (counts.get(t) === 1) have += 1;
    while (have === present.size) {
      best = Math.min(best, right - left + 1);
      const l = tokens[left];
      if (present.has(l)) {
        counts.set(l, counts.get(l)! - 1);
        if (counts.get(l) === 0) have -= 1;
      }
      left += 1;
    }
  }
  return present.size / best;
}

export function retrieve(query: string, chunks: Chunk[], options: RetrieveOptions = {}): Hit[] {
  const { queryVector, chunkVectors, threadVectors, limit = 8 } = options;
  const minSimilarity = options.minSimilarity ?? MIN_SIMILARITY;
  const mode = options.mode ?? 'hybrid';
  const terms = queryTerms(query);
  const roots = new Map(terms.map((t) => [t, rootOf(t)]));
  /** How often each of the question's words is in a passage, worked out once per passage. */
  const counted = new Map<string, Map<string, number>>();
  const countsIn = (c: Chunk, piece: Piece) => {
    let counts = counted.get(c.id);
    if (!counts) {
      counts = new Map();
      for (const t of terms) {
        const n = countOf(piece.tf, t, roots.get(t));
        if (n > 0) counts.set(t, n);
      }
      counted.set(c.id, counts);
    }
    return counts;
  };
  if (chunks.length === 0 || (terms.length === 0 && !queryVector)) return [];

  const titleTokens = new Map<string, string[]>();
  const titleOf = (c: Chunk) => {
    let t = titleTokens.get(c.threadId);
    if (!t) titleTokens.set(c.threadId, (t = tokenize(c.title)));
    return t;
  };
  const df = new Map<string, number>();
  let totalLength = 0;
  for (const c of chunks) {
    const piece = pieceOf.get(c) ?? fallbackPiece(c);
    const title = titleOf(c);
    totalLength += piece.tokens.length + title.length * TITLE_TF;
    const counts = countsIn(c, piece);
    for (const t of terms) if (counts.has(t) || title.includes(t)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const avgLength = totalLength / chunks.length || 1;
  const idf = (t: string) => idfOf(df.get(t) ?? 0, chunks.length);

  const byWords: Hit[] = [];
  if (mode !== 'vector') {
    for (const c of chunks) {
      const piece = pieceOf.get(c) ?? fallbackPiece(c);
      const title = titleOf(c);
      const length = piece.tokens.length + title.length * TITLE_TF;
      const counts = countsIn(c, piece);
      let score = 0;
      for (const t of terms) {
        const tf = (counts.get(t) ?? 0) + (title.includes(t) ? TITLE_TF : 0);
        if (tf > 0) score += (idf(t) * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * length) / avgLength));
      }
      if (score > 0) byWords.push({ chunk: c, score });
    }
    byWords.sort((a, b) => b.score - a.score || b.chunk.createdAt - a.chunk.createdAt);
    byWords.length = Math.min(byWords.length, KEYWORD_TOP);
  }

  const similarity = new Map<string, number>();
  const byMeaning: Hit[] = [];
  if (mode !== 'keyword' && queryVector && chunkVectors) {
    for (const c of chunks) {
      const v = chunkVectors.get(c.hash);
      if (!v || v.length !== queryVector.length) continue;
      const s = dot(queryVector, v);
      similarity.set(c.id, s);
      if (s >= minSimilarity) byMeaning.push({ chunk: c, score: s });
    }
    byMeaning.sort((a, b) => b.score - a.score);
    byMeaning.length = Math.min(byMeaning.length, VECTOR_TOP);
  }

  const fused = new Map<string, Hit>();
  const add = (ranking: Hit[]) =>
    ranking.forEach(({ chunk }, rank) => {
      const hit = fused.get(chunk.id) ?? { chunk, score: 0 };
      hit.score += rrfScore(rank);
      fused.set(chunk.id, hit);
    });
  add(byWords);
  add(byMeaning);
  let ranked = [...fused.values()].sort((a, b) => b.score - a.score || b.chunk.createdAt - a.chunk.createdAt);

  if (options.rerank !== false && ranked.length > 1) {
    const termSet = new Set(terms);
    const totalIdf = terms.reduce((sum, t) => sum + idf(t), 0) || 1;
    const top = ranked.slice(0, RERANK_TOP).map((hit, rank) => {
      const piece = pieceOf.get(hit.chunk) ?? fallbackPiece(hit.chunk);
      const title = titleOf(hit.chunk);
      const counts = countsIn(hit.chunk, piece);
      const coverage = terms.reduce((sum, t) => sum + (counts.has(t) ? idf(t) : 0), 0) / totalIdf;
      const inTitle = terms.reduce((sum, t) => sum + (title.includes(t) ? idf(t) : 0), 0) / totalIdf;
      let pairs = 0;
      for (let i = 0; i + 1 < terms.length; i++) {
        for (let j = 0; j + 1 < piece.tokens.length; j++) {
          if (piece.tokens[j] === terms[i] && piece.tokens[j + 1] === terms[i + 1]) {
            pairs += 1;
            break;
          }
        }
      }
      const s = similarity.get(hit.chunk.id);
      const threadVector = queryVector && threadVectors?.get(hit.chunk.threadId);
      const score =
        RERANK.coverage * coverage +
        RERANK.title * inTitle +
        RERANK.near * nearness(piece.tokens, termSet) +
        RERANK.phrase * (terms.length > 1 ? pairs / (terms.length - 1) : 0) +
        RERANK.meaning * (s === undefined ? 0 : unit(s)) +
        RERANK.thread * (threadVector && threadVector.length === queryVector!.length ? unit(dot(queryVector!, threadVector)) : 0) +
        RERANK.prior * (1 - rank / RERANK_TOP);
      return { chunk: hit.chunk, score };
    });
    top.sort((a, b) => b.score - a.score);
    ranked = [...top, ...ranked.slice(RERANK_TOP)];
  }

  const kept: Hit[] = [];
  const perThread = new Map<string, number>();
  const threadShare = Math.max(3, Math.ceil(limit / 2));
  for (const hit of ranked) {
    if (kept.length >= limit) break;
    if ((perThread.get(hit.chunk.threadId) ?? 0) >= threadShare) continue;
    if (kept.some((k) => sameThing(k.chunk, hit.chunk, chunkVectors))) continue;
    kept.push(hit);
    perThread.set(hit.chunk.threadId, (perThread.get(hit.chunk.threadId) ?? 0) + 1);
  }
  return kept;
}

/** A passage not made by `chunkEntries` (a test's, the evaluation's). */
function fallbackPiece(chunk: Chunk): Piece {
  const tokens = tokenize(chunk.text);
  const piece = { text: chunk.text, hash: chunk.hash, tokens, tf: termCounts(tokens) };
  pieceOf.set(chunk, piece);
  return piece;
}

export function sameThing(a: Chunk, b: Chunk, vectors?: Map<string, Float32Array>): boolean {
  if (a.hash === b.hash) return true;
  const va = vectors?.get(a.hash);
  const vb = vectors?.get(b.hash);
  if (va && vb && va.length === vb.length && dot(va, vb) >= SAME_MEANING) return true;
  const wa = (pieceOf.get(a) ?? fallbackPiece(a)).tf;
  const wb = (pieceOf.get(b) ?? fallbackPiece(b)).tf;
  if (wa.size < 4 || wb.size < 4) return false;
  let shared = 0;
  for (const t of wa.keys()) if (wb.has(t)) shared += 1;
  return shared / (wa.size + wb.size - shared) >= SAME_WORDS;
}

export interface PackedNote {
  /** The thread's id: the link back to where it was said. */
  id: string;
  title: string;
  text: string;
}

/**
 * The passages found, gathered by thread (best thread first) and in the
 * order they were said, each with its date, within a budget of characters.
 */
export function packContext(hits: Hit[], options: { maxNotes?: number; perNoteChars?: number } = {}): PackedNote[] {
  const { maxNotes = 8, perNoteChars = 1500 } = options;
  const byThread = new Map<string, Chunk[]>();
  for (const { chunk } of hits) {
    const list = byThread.get(chunk.threadId);
    if (list) list.push(chunk);
    else if (byThread.size < maxNotes) byThread.set(chunk.threadId, [chunk]);
  }
  return [...byThread.entries()].map(([id, chunks]) => {
    let text = '';
    // Room goes to the best passages first; they're then read in the order they were said.
    const fits: Chunk[] = [];
    for (const c of chunks) {
      const line = `[${new Date(c.createdAt).toDateString()}] ${c.text}`;
      if (text.length + line.length > perNoteChars && fits.length > 0) continue;
      text += line;
      fits.push(c);
    }
    fits.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    return {
      id,
      title: chunks[0].title,
      text: fits
        .map((c) => `[${new Date(c.createdAt).toDateString()}] ${c.text}`)
        .join('\n')
        .slice(0, perNoteChars),
    };
  });
}
