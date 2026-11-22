import { EmptyResponseError, emptyKindOf } from '@/lib/empty-response';

export type KeyProblem = 'invalid' | 'quota' | 'offline' | 'busy' | 'blocked' | 'truncated' | 'empty' | 'other';

const QUOTA = /\b429\b|RESOURCE_EXHAUSTED|quota/i;
const NO_CONNECTION = /Network request failed|Failed to fetch|NetworkError|ENOTFOUND/i;
const OVERLOADED = /\b50[34]\b|UNAVAILABLE|DEADLINE_EXCEEDED|high demand|overloaded/i;
const MISSING_MODEL = /\b404\b|NOT_FOUND|is not found|not supported for (generateContent|embedContent)/i;

export const errorText = (err: unknown): string => String((err as { message?: string })?.message ?? err);

export class QuotaRestingError extends Error {
  constructor(
    readonly daily: boolean,
    readonly retryMs?: number,
  ) {
    super(
      daily
        ? 'RESOURCE_EXHAUSTED: PerDay quota used up on every model'
        : `RESOURCE_EXHAUSTED: every model is out of quota. Please retry in ${Math.ceil((retryMs ?? 0) / 1000)}s.`,
    );
    this.name = 'QuotaRestingError';
  }
}

export function isMissingModel(e: unknown): boolean {
  return MISSING_MODEL.test(errorText(e));
}

/** Google's "busy" answers: 503 high demand, and 504 when it ran out of time on its side. */
export function isOverloaded(e: unknown): boolean {
  return OVERLOADED.test(errorText(e));
}

/** Request never left the phone. A timeout is not this: the call may have reached Gemini. */
export function isNoConnection(err: unknown): boolean {
  return NO_CONNECTION.test(errorText(err));
}

function nthSunday(year: number, month: number, n: number): number {
  const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((7 - firstDow) % 7) + (n - 1) * 7;
}

/** US Pacific offset from UTC in hours at `at`: -7 on daylight time (2nd Sunday of March to 1st Sunday of November), else -8. */
function pacificOffsetHours(at: number): number {
  const y = new Date(at).getUTCFullYear();
  const start = Date.UTC(y, 2, nthSunday(y, 2, 2), 10);
  const end = Date.UTC(y, 10, nthSunday(y, 10, 1), 9);
  return at >= start && at < end ? -7 : -8;
}

/** When Google's daily free quota next resets: midnight Pacific, as a timestamp. */
export function nextDailyReset(now = Date.now()): number {
  const offset = pacificOffsetHours(now) * 3_600_000;
  const pacificDay = Math.floor((now + offset) / 86_400_000);
  const reset = (pacificDay + 1) * 86_400_000 - offset;
  return (pacificDay + 1) * 86_400_000 - pacificOffsetHours(reset) * 3_600_000;
}

export const DAILY_QUOTA_PAUSE_MS = 60 * 60_000;
const DEFAULT_QUOTA_PAUSE_MS = 60_000;

/**
 * What a 429 is about, or undefined for any other error: `daily` when the
 * day's allowance is spent (it resets at midnight Pacific), else a
 * per-minute limit with the wait Google names ("Please retry in 37.5s").
 */
export function quotaInfo(e: unknown): { daily: boolean; retryMs?: number } | undefined {
  if (e instanceof QuotaRestingError) return e.daily ? { daily: true } : { daily: false, retryMs: e.retryMs };
  const text = errorText(e);
  if (!QUOTA.test(text)) return undefined;
  if (/PerDay|per day|daily/i.test(text)) return { daily: true };
  const wait = text.match(/retry in (\d+(?:\.\d+)?)\s*s/i) ?? text.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  return { daily: false, retryMs: wait ? Math.ceil(Number(wait[1]) * 1000) : undefined };
}

/**
 * A model out of quota (429), and how long to leave it alone; undefined for
 * any other error. Google's free tier counts each model separately, so
 * another model usually still answers.
 */
export function quotaPause(e: unknown): number | undefined {
  const info = quotaInfo(e);
  if (!info) return undefined;
  return info.daily ? DAILY_QUOTA_PAUSE_MS : (info.retryMs ?? DEFAULT_QUOTA_PAUSE_MS);
}

export function classifyAiError(err: unknown): KeyProblem {
  const msg = errorText(err);
  // Must run first: the text has counts ("transcript 401 chars") that look like status codes.
  const empty = err instanceof EmptyResponseError ? err.kind : emptyKindOf(msg);
  if (empty) return empty === 'blocked' ? 'blocked' : empty === 'truncated' ? 'truncated' : empty === 'unreadable' ? 'other' : 'empty';
  if (/API_KEY_INVALID|API key not valid|PERMISSION_DENIED|\b(401|403)\b/i.test(msg)) return 'invalid';
  if (QUOTA.test(msg) || /rate limit/i.test(msg)) return 'quota';
  if (OVERLOADED.test(msg)) return 'busy';
  if (NO_CONNECTION.test(msg) || /timed? ?out|offline/i.test(msg)) return 'offline';
  return 'other';
}

/** Google resets the daily quota at midnight Pacific; shown in local time. */
export function dailyResetText(now = Date.now()): string {
  const time = new Date(nextDailyReset(now)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `It resets at ${time} your time.`;
}

function waitText(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 90) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.ceil(s / 60);
  return `${m} minutes`;
}

const KEY_PROBLEM_TEXT: Record<KeyProblem, string> = {
  invalid: "This key wasn't accepted. Check you copied all of it.",
  quota: "This key's free limit is used up. Notes are saved and will be tidied up later.",
  offline: "Couldn't connect. Check your connection; notes are saved either way.",
  busy: 'Smart mode is busy right now. Notes are saved and will be tidied up later.',
  blocked: "The safety filter declined to process this note. It's saved as you wrote it.",
  truncated: "The answer for this note was cut off. It's saved as you wrote it.",
  empty: 'Nothing came back for this note (it may have had nothing to process). It\'s saved as you wrote it.',
  other: 'Smart mode returned an error. Notes are saved either way.',
};

export function aiErrorText(err: unknown): string {
  const problem = classifyAiError(err);
  if (problem !== 'quota') return KEY_PROBLEM_TEXT[problem];
  const info = quotaInfo(err);
  if (info?.daily) return `The free daily limit is used up. ${dailyResetText()} Notes are saved and will be tidied up later.`;
  const retry = info?.retryMs ? `Try again in ${waitText(info.retryMs)}.` : 'Try again in a minute.';
  return `Too many requests this minute. ${retry} Notes are saved and will be tidied up later.`;
}

const RETRIED_BY_ITSELF: KeyProblem[] = ['offline', 'quota', 'busy'];

export function retryProblemText(err: unknown): { title: string; message: string } {
  const problem = classifyAiError(err);
  const title = problem === 'offline' ? 'Still offline?' : 'Smart mode had a problem';
  if (problem === 'blocked') {
    return {
      title,
      message:
        "The safety filter declined to process this note. It's saved as you wrote it. It won't be tried again until you edit it or tap Retry.",
    };
  }
  const text = aiErrorText(err);
  return { title, message: RETRIED_BY_ITSELF.includes(problem) ? `${text} It's tried again by itself.` : text };
}
