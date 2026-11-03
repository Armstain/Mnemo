// Why a Gemini answer had no text: the HTTP call succeeds, so safety blocks, token-limit cuts and empty input otherwise look alike.

interface RatingFacts {
  category?: unknown;
  probability?: unknown;
  blocked?: unknown;
}

export interface ResponseFacts {
  candidates?: { finishReason?: unknown; safetyRatings?: RatingFacts[] }[];
  promptFeedback?: { blockReason?: unknown; safetyRatings?: RatingFacts[] };
}

export interface SafetyRating {
  category: string;
  probability: string;
  blocked?: boolean;
}

export type EmptyKind = 'blocked' | 'truncated' | 'empty-input' | 'unreadable' | 'empty';

export interface EmptyAttempt {
  model: string;
  finishReason?: string;
  blockReason?: string;
  candidates: number;
  unreadable?: boolean;
  safety?: SafetyRating[];
}

export interface InputInfo {
  label: string;
  none: boolean;
}

const BLOCKED_FINISH = /^(SAFETY|PROHIBITED_CONTENT|BLOCKLIST|SPII|RECITATION|IMAGE_SAFETY|IMAGE_PROHIBITED_CONTENT|IMAGE_RECITATION)$/;

function readRatings(list: RatingFacts[] | undefined): SafetyRating[] {
  return (Array.isArray(list) ? list : []).flatMap((r) =>
    r?.category ? [{ category: String(r.category), probability: String(r.probability ?? 'UNKNOWN'), ...(r.blocked === true ? { blocked: true } : {}) }] : [],
  );
}

export function describeEmpty(response: ResponseFacts, model: string, unreadable = false): EmptyAttempt {
  const finish = response.candidates?.[0]?.finishReason;
  const block = response.promptFeedback?.blockReason;
  const safety = [
    ...readRatings(response.promptFeedback?.safetyRatings),
    ...(response.candidates ?? []).flatMap((c) => readRatings(c?.safetyRatings)),
  ];
  return {
    model,
    finishReason: finish ? String(finish) : undefined,
    blockReason: block ? String(block) : undefined,
    candidates: response.candidates?.length ?? 0,
    ...(unreadable ? { unreadable } : {}),
    ...(safety.length ? { safety } : {}),
  };
}

const PROBABILITY = ['NEGLIGIBLE', 'LOW', 'MEDIUM', 'HIGH'];

/** Rating Google marks as the blocker, else the highest probability. */
export function topSafety(attempts: EmptyAttempt[]): SafetyRating | null {
  let best: SafetyRating | null = null;
  const rank = (r: SafetyRating) => (r.blocked ? 10 : 0) + PROBABILITY.indexOf(r.probability);
  for (const r of attempts.flatMap((a) => a.safety ?? [])) if (!best || rank(r) > rank(best)) best = r;
  return best;
}

export const isBlocked = (a: EmptyAttempt): boolean => !!a.blockReason || BLOCKED_FINISH.test(a.finishReason ?? '');

export function emptyKind(attempts: EmptyAttempt[], input?: InputInfo): EmptyKind {
  if (input?.none) return 'empty-input';
  if (attempts.some(isBlocked)) return 'blocked';
  if (attempts.some((a) => a.finishReason === 'MAX_TOKENS')) return 'truncated';
  if (attempts.some((a) => a.unreadable)) return 'unreadable';
  return 'empty';
}

export class EmptyResponseError extends Error {
  readonly kind: EmptyKind;
  constructor(readonly attempts: EmptyAttempt[], input?: InputInfo) {
    const kind = emptyKind(attempts, input);
    const tried = attempts
      .map((a) => `${a.model} finish=${a.finishReason ?? '-'}${a.blockReason ? ` block=${a.blockReason}` : ''} candidates=${a.candidates}${a.unreadable ? ' unreadable' : ''}`)
      .join('; ');
    // Cause, input and safety category come first: the log truncates long messages.
    const top = kind === 'blocked' ? topSafety(attempts) : null;
    const safety = top ? ` · safety=${top.category}:${top.probability}` : '';
    super(`Gemini returned ${kind === 'unreadable' ? 'unreadable text' : 'no text'} (${kind})${safety} · input: ${input?.label ?? 'unknown'} · ${tried}`);
    this.name = 'EmptyResponseError';
    this.kind = kind;
  }
}

/** Parses the kind from error text, which survives logging and re-throwing. */
export function emptyKindOf(err: unknown): EmptyKind | null {
  const msg = String((err as { message?: string })?.message ?? err);
  const m = msg.match(/Gemini returned (?:no|unreadable) (?:text) \((blocked|truncated|empty-input|unreadable|empty)\)/);
  return (m?.[1] as EmptyKind | undefined) ?? null;
}
