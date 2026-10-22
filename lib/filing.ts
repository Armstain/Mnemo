import { bm25Scored, tokenize } from '@/lib/bm25';
import { dot } from '@/lib/vector-math';
import { entryText, newestFirst } from '@/lib/threads';
import { trackedMetrics } from '@/lib/measures';
import type { ThreadCandidate, ThreadMatch } from '@/lib/gemini';
import type { Entry, MnemoItem } from '@/types/mnemo';
import { DAY_MS } from '@/utils/time';

// Auto-filing: which thread a quick capture belongs to. See
// docs/specs/threads.md §3. The model proposes, the device checks.

/** At or above: file it automatically (with Undo). */
export const ATTACH_CONFIDENCE = 0.8;
/** At or above (and below ATTACH): suggest the thread instead. */
export const SUGGEST_CONFIDENCE = 0.5;
/** A focused thread only lets go of a capture the model is this sure about. */
const FOCUS_RELEASE_CONFIDENCE = 0.8;

const MAX_CANDIDATES = 12;
const RECENT_MS = 14 * DAY_MS;
const SNIPPET_CHARS = 140;
/** A thread quiet this long is never filed into automatically, only suggested. */
export const STALE_DAYS = 14;
/** Focus lapses after this long with nothing new in the thread. */
export const FOCUS_IDLE_MS = 3 * DAY_MS;

/** When a thread last got an entry (or was otherwise updated). */
function lastActivity(thread: MnemoItem, entries: Entry[]): number {
  let latest = thread.updatedAt;
  for (const e of entries) if (e.threadId === thread.id && e.createdAt > latest) latest = e.createdAt;
  return latest;
}

/**
 * True once a focus thread has gone `FOCUS_IDLE_MS` with nothing new since
 * focus was turned on (or since its last entry, whichever is later).
 */
export function focusIsIdle(input: {
  threadId: string;
  since: number;
  entries: Entry[];
  now?: number;
}): boolean {
  const now = input.now ?? Date.now();
  let last = input.since;
  for (const e of input.entries) if (e.threadId === input.threadId && e.createdAt > last) last = e.createdAt;
  return now - last > FOCUS_IDLE_MS;
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > SNIPPET_CHARS ? `${flat.slice(0, SNIPPET_CHARS)}…` : flat;
}

/**
 * The open threads worth showing the model: the focused one, anything
 * touched in the last two weeks, and the best keyword matches for what was
 * typed (voice has no words before the call). Small on purpose: about a
 * thousand tokens, and fewer choices means fewer wrong ones.
 */
export function gatherCandidates(input: {
  threads: MnemoItem[];
  entries: Entry[];
  excludeId?: string;
  focusId?: string | null;
  text?: string;
  now?: number;
}): ThreadCandidate[] {
  const now = input.now ?? Date.now();
  const open = input.threads.filter(
    (t) =>
      t.id !== input.excludeId &&
      !t.pending &&
      (t.status === 'active' || t.status === 'paused'),
  );
  const picked = new Map<string, MnemoItem>();
  // Each thread's entries, gathered once (not once per thread).
  const byThread = new Map<string, Entry[]>();
  for (const e of input.entries) {
    const list = byThread.get(e.threadId);
    if (list) list.push(e);
    else byThread.set(e.threadId, [e]);
  }

  const focus = open.find((t) => t.id === input.focusId);
  if (focus) picked.set(focus.id, focus);
  if (input.text?.trim()) {
    for (const { doc } of bm25Scored(input.text, open).slice(0, 3)) picked.set(doc.id, doc);
  }
  for (const t of [...open].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (picked.size >= MAX_CANDIDATES) break;
    if (now - lastActivity(t, byThread.get(t.id) ?? []) <= RECENT_MS) picked.set(t.id, t);
  }

  return [...picked.values()].map((t) => {
    const threadEntries = byThread.get(t.id) ?? [];
    const latest = newestFirst(threadEntries)[0];
    const tracks = trackedMetrics(threadEntries, 3);
    return {
      idleDays: Math.max(0, Math.floor((now - lastActivity(t, threadEntries)) / DAY_MS)),
      id: t.id,
      title: t.title,
      category: t.category,
      nextStep: t.nextStep || undefined,
      latest: latest ? snippet(entryText(latest)) || undefined : undefined,
      focused: t.id === input.focusId || undefined,
      tracks: tracks.length > 0 ? tracks : undefined,
    };
  });
}

// Words too common to say two notes are about the same thing.
const COMMON = new Set(
  (
    'the and for with this that from have has had was were are will would should could about into over just ' +
    'need today tomorrow yesterday then also some more very really what when where which who why how note ' +
    'taka spent paid got went did done make made take took call called get buy' +
    ' ami amar tumi ache ase gese hobe korte korbo kore kal aj ajke'
  ).split(' '),
);
const COMMON_BN = new Set('আমি আমার আজ কাল আজকে হবে করতে করবো করে আছে গেছে টাকা এবং আর'.split(' ').map((w) => w.normalize('NFC')));

/** The words in a text that could say what it's about. */
export function telling(words: string[]): Set<string> {
  return new Set(
    words.filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !COMMON.has(w) && !COMMON_BN.has(w)),
  );
}

/**
 * Offline filing: the open thread a note shares telling words with, if one
 * clearly stands out. Only ever a suggestion (the person taps to move it);
 * without AI there's no understanding behind it, just matching words.
 */
export function keywordMatch(input: {
  text: string;
  threads: MnemoItem[];
  excludeId?: string;
}): { threadId: string; title: string; reason: string; confidence: number } | null {
  const open = input.threads.filter(
    (t) => t.id !== input.excludeId && !t.pending && (t.status === 'active' || t.status === 'paused'),
  );
  const said = telling(tokenize(input.text));
  if (said.size === 0) return null;
  const docs = open.map((t) => ({
    thread: t,
    title: telling(tokenize(t.title)),
    body: telling(tokenize(`${t.title} ${t.content} ${t.tags.join(' ')}`)),
  }));
  // Rarer words say more: "sylhet" in one thread beats "hotel" in five.
  const weight = (w: string) => Math.log(1 + docs.length / (1 + docs.filter((d) => d.body.has(w)).length));
  const scored = docs
    .map((d) => {
      const shared = [...said].filter((w) => d.body.has(w));
      const inTitle = shared.filter((w) => d.title.has(w));
      const score = shared.reduce((sum, w) => sum + weight(w) * (d.title.has(w) ? 2 : 1), 0);
      return { ...d, shared, inTitle, score };
    })
    .filter((d) => d.shared.length >= 2 || d.inTitle.length > 0)
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) return null;
  // A close second means the words don't decide it: no suggestion beats a wrong one.
  if (scored[1] && best.score < scored[1].score * 1.5) return null;
  const top = { doc: best.thread };
  const { shared, inTitle } = best;

  const word = inTitle[0] ?? shared[0];
  return {
    threadId: top.doc.id,
    title: top.doc.title,
    reason: `Mentions “${word}”, like this thread`,
    confidence: SUGGEST_CONFIDENCE,
  };
}

export type FilingDecision =
  | { action: 'stay' }
  | { action: 'attach'; threadId: string; confidence: number; reason: string }
  | { action: 'suggest'; threadId: string; confidence: number; reason: string }
  /** Leave the focused thread for a thread of its own. */
  | { action: 'release'; reason: string };

/**
 * Turns the model's answer into what happens. `similarity` compares the new
 * entry with each candidate thread (missing when offline or not embedded
 * yet); an automatic attach also needs the chosen thread among the closest
 * three, so a confident but wrong answer is downgraded to a suggestion.
 */
export function decideFiling(input: {
  filedBy: Entry['filing']['by'];
  match?: ThreadMatch;
  candidates: ThreadCandidate[];
  similarity?: Map<string, number>;
}): FilingDecision {
  const { match, candidates, similarity } = input;
  if (!match) return { action: 'stay' };
  const confidence = Math.max(0, Math.min(1, Number(match.confidence) || 0));
  const reason = (match.reason || '').trim();
  const known = match.match === 'existing' && candidates.some((c) => c.id === match.threadId);

  if (input.filedBy === 'focus') {
    // Already in the focused thread. Only move out on a clear "this is
    // something else"; the person asked for captures to go there.
    const focused = candidates.find((c) => c.focused);
    const pointsElsewhere = !known || match.threadId !== focused?.id;
    if (match.match === 'new' && confidence >= FOCUS_RELEASE_CONFIDENCE) {
      return { action: 'release', reason };
    }
    if (known && pointsElsewhere && confidence >= ATTACH_CONFIDENCE) {
      return { action: 'suggest', threadId: match.threadId, confidence, reason };
    }
    return { action: 'stay' };
  }

  if (input.filedBy !== 'new' || !known) return { action: 'stay' };

  // A thread that's been quiet for weeks (last month's trip) can be
  // suggested, never filed into without asking.
  const chosen = candidates.find((c) => c.id === match.threadId);
  const stale = (chosen?.idleDays ?? 0) > STALE_DAYS;

  if (confidence >= ATTACH_CONFIDENCE && !stale) {
    if (!similarity || similarity.size === 0 || !similarity.has(match.threadId)) {
      return { action: 'attach', threadId: match.threadId, confidence, reason };
    }
    const top3 = [...similarity.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => id);
    return top3.includes(match.threadId)
      ? { action: 'attach', threadId: match.threadId, confidence, reason }
      : { action: 'suggest', threadId: match.threadId, confidence, reason };
  }
  if (confidence >= SUGGEST_CONFIDENCE) {
    return { action: 'suggest', threadId: match.threadId, confidence, reason };
  }
  return { action: 'stay' };
}

/** Cosine similarity of one vector against each candidate's stored vector. */
export function similarityTo(
  vector: Float32Array,
  threadVectors: Map<string, Float32Array>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, v] of threadVectors) out.set(id, dot(vector, v));
  return out;
}

// ─── Telling the UI ─────────────────────────────────────────────
// Filing happens in the background (lib/capture.ts), outside React; the
// FilingNotifier component listens here and shows the toast.

export type FilingEvent =
  | {
      type: 'attached';
      entryId: string;
      fromThreadId: string;
      toThreadId: string;
      toTitle: string;
      /** What the capture's own thread would have been called, for Undo. */
      ownTitle: string;
      ownCategory: MnemoItem['category'];
    }
  | { type: 'suggested'; entryId: string; threadId: string; toThreadId: string; toTitle: string; reason: string }
  | {
      type: 'released';
      entryId: string;
      fromThreadId: string;
      fromTitle: string;
      toThreadId: string;
    };

type Listener = (event: FilingEvent) => void;
const listeners = new Set<Listener>();

export function onFiling(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitFiling(event: FilingEvent): void {
  for (const listener of listeners) listener(event);
}
