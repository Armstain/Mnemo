// Which Gemini models to use, chosen from the list the person's key can
// actually see (ai.models.list), not from names written into the app:
// Google renames and retires models, and a name that 404s left every note
// stuck on "Processing". Pure, so it's tested (tests/model-pick.test.ts).

export interface ModelInfo {
  /** Without the "models/" prefix. */
  name: string;
  /** e.g. generateContent, embedContent */
  actions: string[];
}

/** Version from the name: "gemini-2.5-flash" → 2.5; aliases rank highest. */
function version(name: string): number {
  if (/-latest$/.test(name)) return 1000;
  const m = name.match(/gemini-(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
}

/** Specialised variants that can't take a plain text prompt and a schema. */
const NOT_FOR_TEXT = /(tts|image|audio|live|embed|vision|robotics|computer|native|thinking|exp|aqa|learnlm|gemma)/;
const unstable = (n: string) => /(preview|exp)/.test(n);
const small = (n: string) => /(lite|8b)/.test(n);
/** Flash-Lite and other small models: the last rung, after every full Flash is resting. */
export const isLiteModel = small;

function byQuality(a: string, b: string): number {
  return (
    Number(small(a)) - Number(small(b)) ||
    version(b) - version(a) ||
    Number(unstable(a)) - Number(unstable(b)) ||
    b.localeCompare(a)
  );
}

/**
 * Text models, best first: a "flash" model (fast and cheap enough for one
 * call per note), newest first (a preview of a newer generation beats an
 * older stable one; at the same version stable goes first), "lite" last.
 * The older ones behind it are what a busy or retired newest falls back
 * to. The best "lite" model always gets the last place (it has its own
 * allowance, so it still answers when every Flash is out of quota).
 * Falls back to any general Gemini model when the key lists no flash.
 */
export function pickTextModels(models: ModelInfo[], limit = 3): string[] {
  const general = models
    .filter((m) => m.actions.includes('generateContent'))
    .map((m) => m.name.toLowerCase())
    .filter((n) => n.startsWith('gemini') && !NOT_FOR_TEXT.test(n));
  const flash = general.filter((n) => n.includes('flash'));
  const ranked = (flash.length > 0 ? flash : general).sort(byQuality);
  const full = ranked.filter((n) => !small(n)).slice(0, limit);
  return [...full, ...ranked.filter(small).slice(0, 1)];
}

/** A text-to-speech model, newest first, flash before pro. */
export function pickTtsModel(models: ModelInfo[]): string | undefined {
  return models
    .filter((m) => m.actions.includes('generateContent') && /tts/.test(m.name.toLowerCase()))
    .map((m) => m.name.toLowerCase())
    .sort((a, b) => Number(!a.includes('flash')) - Number(!b.includes('flash')) || version(b) - version(a))[0];
}

/**
 * The embedding model: the one the app was built against when the key has
 * it (vectors stay comparable), else the newest Gemini embedding model.
 */
export function pickEmbeddingModel(models: ModelInfo[], preferred: string): string | undefined {
  const names = models.filter((m) => m.actions.includes('embedContent')).map((m) => m.name.toLowerCase());
  if (names.includes(preferred)) return preferred;
  return names
    .filter((n) => n.includes('embedding'))
    .sort((a, b) => Number(!a.startsWith('gemini')) - Number(!b.startsWith('gemini')) || version(b) - version(a) || b.localeCompare(a))[0];
}

/** A model that isn't there (renamed, retired, not on this key): worth trying the next. */
export function isMissingModel(e: unknown): boolean {
  const text = e instanceof Error ? e.message : String(e);
  return /\b404\b|NOT_FOUND|is not found|not supported for (generateContent|embedContent)/i.test(text);
}

/** Google's "busy" answers: 503 high demand, and 504 when it ran out of time on its side. */
export const OVERLOADED_PATTERN = /\b50[34]\b|UNAVAILABLE|DEADLINE_EXCEEDED|high demand|overloaded/i;

/**
 * Google answering "high demand" (503) or "deadline exceeded" (504) for one
 * model: another model, or the same one a moment later, usually still works.
 */
export function isOverloaded(e: unknown): boolean {
  const text = e instanceof Error ? e.message : String(e);
  return OVERLOADED_PATTERN.test(text);
}

/** How long a model sits out after its day's allowance runs out, before it's tried again. */
export const DAILY_QUOTA_PAUSE_MS = 60 * 60_000;
/** When Google doesn't say how long to wait. */
const DEFAULT_QUOTA_PAUSE_MS = 60_000;

/**
 * What a 429 is about, or undefined for any other error: `daily` when the
 * day's allowance is spent (it resets at midnight Pacific), else a
 * per-minute limit with the wait Google names ("Please retry in 37.5s"),
 * if it names one.
 */
export function quotaInfo(e: unknown): { daily: boolean; retryMs?: number } | undefined {
  const text = e instanceof Error ? e.message : String(e);
  if (!/\b429\b|RESOURCE_EXHAUSTED|quota/i.test(text)) return undefined;
  if (/PerDay|per day|daily/i.test(text)) return { daily: true };
  const wait = text.match(/retry in (\d+(?:\.\d+)?)\s*s/i) ?? text.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  return { daily: false, retryMs: wait ? Math.ceil(Number(wait[1]) * 1000) : undefined };
}

/**
 * A model out of quota (429), and how long to leave it alone; undefined for
 * any other error. Google's free tier counts each model separately, so
 * another model usually still answers. A day's allowance gets an hour's
 * rest (it's checked again cheaply after); a per-minute one, the wait
 * Google names.
 */
export function quotaPause(e: unknown): number | undefined {
  const info = quotaInfo(e);
  if (!info) return undefined;
  return info.daily ? DAILY_QUOTA_PAUSE_MS : (info.retryMs ?? DEFAULT_QUOTA_PAUSE_MS);
}
