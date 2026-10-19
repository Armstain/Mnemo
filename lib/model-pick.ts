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
 * to. Falls back to any general Gemini model when the key lists no flash.
 */
export function pickTextModels(models: ModelInfo[], limit = 3): string[] {
  const general = models
    .filter((m) => m.actions.includes('generateContent'))
    .map((m) => m.name.toLowerCase())
    .filter((n) => n.startsWith('gemini') && !NOT_FOR_TEXT.test(n));
  const flash = general.filter((n) => n.includes('flash'));
  return (flash.length > 0 ? flash : general).sort(byQuality).slice(0, limit);
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

/**
 * Google answering "high demand" (503) for one model: another model, or the
 * same one a moment later, usually still works.
 */
export function isOverloaded(e: unknown): boolean {
  const text = e instanceof Error ? e.message : String(e);
  return /\b503\b|UNAVAILABLE|high demand|overloaded/i.test(text);
}
