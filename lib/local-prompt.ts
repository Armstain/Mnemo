import { CATEGORIES, KINDS, type Category, type ThreadKind } from '@/types/mnemo';

// What the on-device model (lib/local-ai.ts) is asked, and how its answer is checked. Pure, so it's
// tested (tests/local-prompt.test.ts) and the same prompt can be tried on a computer.
//
// The model is small (Qwen3.5-0.8B): it is asked only for what it does reliably, and the phone's
// own reader (lib/understand.ts) keeps everything that must be exact: times, reminders, amounts,
// checklists and links. It never rewrites the person's words, because a model this size misspells
// words it copies; it names and sorts the note instead.

export const LOCAL_SYSTEM =
  'You read one short personal note and describe it as JSON. ' +
  'Use only what the note says: never invent names, places, times, numbers or steps. ' +
  'Write in the same language and script as the note: Bangla stays in Bangla script, Banglish stays in Latin letters.';

export const LOCAL_KINDS = [...KINDS, 'note'] as const;
const LOCAL_CATEGORIES = CATEGORIES;

/** Held to by the engine's grammar, so the answer is always this shape; [readLocalAnswer] checks the content. */
export const LOCAL_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', maxLength: 60 },
    kind: { type: 'string', enum: [...LOCAL_KINDS] },
    category: { type: 'string', enum: [...LOCAL_CATEGORIES] },
    tags: { type: 'array', items: { type: 'string', maxLength: 24 }, minItems: 0, maxItems: 4 },
  },
  required: ['title', 'kind', 'category', 'tags'],
  additionalProperties: false,
} as const;

/** A note longer than this is cut: the model reads slowly, and the start says what it's about. */
export const LOCAL_MAX_NOTE_CHARS = 2400;

export function localPrompt(note: string): string {
  return `Note:
"""
${note.trim().slice(0, LOCAL_MAX_NOTE_CHARS)}
"""

Describe it:
- title: what it is about, 2 to 5 words, in the note's own language and script, no quotes, no full stop.
- kind: "task" (one thing to get done, or a list to do), "project" (something ongoing with several steps), "idea" (a thought to keep, not yet a plan), or "note" (information to keep: a number, an address, a fact). When unsure, "note".
- category: work (job, office, clients), personal (home, family, friends, money, travel), study, shopping (things to buy), health, ideas, errands (repairs, bills, appointments to book, calls to make), or general.
- tags: 1 to 3 short lowercase topic words from the note.`;
}

export interface LocalReading {
  title?: string;
  kind?: ThreadKind;
  category?: Category;
  tags: string[];
}

/** Longer than this, the model copied the note instead of naming it. */
const MAX_TITLE_WORDS = 6;

const clean = (s: unknown, max: number): string =>
  typeof s === 'string' ? s.replace(/\s+/g, ' ').replace(/^["'“”‘’\s]+|["'“”‘’\s.]+$/g, '').trim().slice(0, max) : '';

/** Letters and digits of any script, lowercased: what "the same word" means here. */
function words(s: string): string[] {
  return s.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
}

/**
 * True when most of [said]'s words are in the note, allowing simple endings ("buy" / "buying").
 * A small model sometimes answers about something else entirely; this keeps it to the note.
 */
function grounded(said: string, noteWords: Set<string>, share: number): boolean {
  const ws = words(said).filter((w) => w.length > 2);
  if (ws.length === 0) return true;
  const stems = [...noteWords].map((w) => w.slice(0, 4));
  const hit = ws.filter((w) => noteWords.has(w) || (w.length >= 4 && stems.includes(w.slice(0, 4)))).length;
  return hit / ws.length >= share;
}

/**
 * The model's answer, checked against the note. Anything malformed or not grounded in the note is
 * dropped field by field, so the phone's own reading stands for it. Null when nothing is usable.
 */
export function readLocalAnswer(raw: string, note: string): LocalReading | null {
  let o: Record<string, unknown>;
  try {
    const text = raw.trim().startsWith('"') ? `{${raw}` : raw;
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    o = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object') return null;
  const noteWords = new Set(words(note));

  const title = clean(o.title, 60);
  const kind = typeof o.kind === 'string' && (KINDS as readonly string[]).includes(o.kind) ? (o.kind as ThreadKind) : undefined;
  const category =
    typeof o.category === 'string' && (CATEGORIES as readonly string[]).includes(o.category) ? (o.category as Category) : undefined;
  const tags = [
    ...new Set(
      (Array.isArray(o.tags) ? o.tags : [])
        .map((t) => clean(t, 24).toLowerCase().replace(/^#/, ''))
        .filter((t) => t.length > 1 && words(t).length <= 2 && !/^\d+$/.test(t) && !(CATEGORIES as readonly string[]).includes(t)),
    ),
  ].slice(0, 3);
  const reading: LocalReading = {
    title: title && words(title).length <= MAX_TITLE_WORDS && grounded(title, noteWords, 0.34) ? title : undefined,
    kind,
    category,
    tags,
  };
  const empty = !reading.title && !reading.kind && !reading.category && !tags.length;
  return empty ? null : reading;
}

/** What the phone's own reader (lib/understand.ts) made of the note. */
export interface RuleReading {
  title: string;
  kind?: ThreadKind;
  category?: Category;
}

/** Titles the app gives a note it couldn't name. */
const PLACEHOLDER_TITLES = new Set(['idea', 'quick note', 'voice note', 'checklist', 'photo', 'note']);

/**
 * What the model adds on top of the phone's reading. Measured on real notes (English, Bangla,
 * Banglish): the reader picks category and kind better than a 0.8B model does, and the model
 * names a note better than the reader's first-sentence title and finds tags the reader never
 * does. So the model fills gaps and never overrides what the reader was sure of.
 */
export function mergeLocal(rule: RuleReading, local: LocalReading): Partial<RuleReading> & { tags: string[] } {
  const ruleTitle = rule.title.trim();
  const ruleTitleWeak =
    !ruleTitle || ruleTitle.endsWith('…') || PLACEHOLDER_TITLES.has(ruleTitle.toLowerCase()) || words(ruleTitle).length > MAX_TITLE_WORDS;
  const out: Partial<RuleReading> & { tags: string[] } = { tags: local.tags };
  if (local.title && ruleTitleWeak) out.title = local.title.charAt(0).toUpperCase() + local.title.slice(1);
  if (!rule.kind && local.kind) out.kind = local.kind;
  if ((!rule.category || rule.category === 'general') && local.category && local.category !== 'general') out.category = local.category;
  return out;
}
