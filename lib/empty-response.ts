// What to make of a Gemini answer that came back with no text. The HTTP
// call succeeded, so nothing in the error path said why: a safety block, a
// reply cut off at the token limit, and a note with nothing in it all
// looked like "Failed to process voice dump". Pure, so it's tested
// (tests/empty-response.test.ts).

/** The parts of a generateContent response that say why there's no text. */
export interface ResponseFacts {
  candidates?: { finishReason?: unknown }[];
  promptFeedback?: { blockReason?: unknown };
}

export type EmptyKind = 'blocked' | 'truncated' | 'empty-input' | 'unreadable' | 'empty';

export interface EmptyAttempt {
  model: string;
  finishReason?: string;
  blockReason?: string;
  candidates: number;
  /** There was text, but not the JSON that was asked for. */
  unreadable?: boolean;
}

/** What went in: shown in the error, and tells "nothing to process" from "wouldn't process it". */
export interface InputInfo {
  /** e.g. "transcript 123 chars" */
  label: string;
  /** True when there was nothing to process. */
  none: boolean;
}

/** Finish reasons that mean Google's filters declined to answer. */
const BLOCKED_FINISH = /^(SAFETY|PROHIBITED_CONTENT|BLOCKLIST|SPII|RECITATION|IMAGE_SAFETY|IMAGE_PROHIBITED_CONTENT|IMAGE_RECITATION)$/;

export function describeEmpty(response: ResponseFacts, model: string, unreadable = false): EmptyAttempt {
  const finish = response.candidates?.[0]?.finishReason;
  const block = response.promptFeedback?.blockReason;
  return {
    model,
    finishReason: finish ? String(finish) : undefined,
    blockReason: block ? String(block) : undefined,
    candidates: response.candidates?.length ?? 0,
    ...(unreadable ? { unreadable } : {}),
  };
}

export const isBlocked = (a: EmptyAttempt): boolean => !!a.blockReason || BLOCKED_FINISH.test(a.finishReason ?? '');

export function emptyKind(attempts: EmptyAttempt[], input?: InputInfo): EmptyKind {
  if (input?.none) return 'empty-input';
  if (attempts.some(isBlocked)) return 'blocked';
  if (attempts.some((a) => a.finishReason === 'MAX_TOKENS')) return 'truncated';
  if (attempts.some((a) => a.unreadable)) return 'unreadable';
  return 'empty';
}

/** Thrown when every model answered without text. The message carries the cause, for the problem report. */
export class EmptyResponseError extends Error {
  readonly kind: EmptyKind;
  constructor(readonly attempts: EmptyAttempt[], input?: InputInfo) {
    const kind = emptyKind(attempts, input);
    const tried = attempts
      .map((a) => `${a.model} finish=${a.finishReason ?? '-'}${a.blockReason ? ` block=${a.blockReason}` : ''} candidates=${a.candidates}${a.unreadable ? ' unreadable' : ''}`)
      .join('; ');
    // The cause and the input first: the log cuts long messages short.
    super(`Gemini returned ${kind === 'unreadable' ? 'unreadable text' : 'no text'} (${kind}) · input: ${input?.label ?? 'unknown'} · ${tried}`);
    this.name = 'EmptyResponseError';
    this.kind = kind;
  }
}

/** The kind named in an error's text (it survives being logged and re-thrown), or null. */
export function emptyKindOf(err: unknown): EmptyKind | null {
  const msg = String((err as { message?: string })?.message ?? err);
  const m = msg.match(/Gemini returned (?:no|unreadable) (?:text) \((blocked|truncated|empty-input|unreadable|empty)\)/);
  return (m?.[1] as EmptyKind | undefined) ?? null;
}
