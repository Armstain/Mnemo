import { KINDS, type Category, type MnemoItem, type ThreadKind } from '@/types/mnemo';

// Project, task or idea: what a thread *is*, next to what it's about (its
// category). Kept deliberately light:
//
// - When a thread begins, Gemini says which it is in the same call that
//   writes the note up (no extra request), or the phone guesses from the
//   words when AI is off. Either may say "none of these" (a phone number,
//   a receipt), and then the thread has no kind.
// - After that, nothing calls the AI about it. The thread's own shape moves
//   it on: an untyped note or an idea that keeps getting notes and a next
//   step has become a project.
// - It isn't shown or picked any more: an idea is filed under the Ideas
//   category (lib/capture.ts), and Home uses kind only to sort what's next.
//   A kind set by hand before that (`pinned.kind`) is still kept.

/** A kind as stored or as Gemini said it; anything else (including "note") is no kind. */
export function asKind(raw: unknown): ThreadKind | undefined {
  return typeof raw === 'string' && (KINDS as readonly string[]).includes(raw) ? (raw as ThreadKind) : undefined;
}

/** An idea is filed under Ideas: one place for them, not a kind and a category that disagree. */
export function ideaCategory(category: Category | undefined, kind: ThreadKind | undefined): Category | undefined {
  return kind === 'idea' && (!category || category === 'general') ? 'ideas' : category;
}

/** Notes it takes for an untyped thread, or an idea being acted on, to count as a project. */
const PROJECT_NOTES = 3;
/** A task takes more: a to-do that keeps getting notes is usually still one to-do. */
const TASK_TO_PROJECT_NOTES = 5;
/** Lists that grow (shopping, errands) stay tasks however many notes they get. */
const LIST_LIKE: Category[] = ['shopping', 'errands'];

/**
 * The thread's kind now: the person's choice if they made one, otherwise
 * the first guess, moved on by how the thread has grown.
 */
export function kindOf(
  thread: Pick<MnemoItem, 'kind' | 'pinned' | 'category' | 'nextStep' | 'dueDate'>,
  notes: number,
): ThreadKind | undefined {
  // The Ideas category is the one place for ideas, so a thread filed there is one.
  const guess = thread.kind ?? (thread.category === 'ideas' ? 'idea' : undefined);
  if (thread.pinned?.kind) return guess;
  if (guess === 'idea') return notes >= PROJECT_NOTES && (thread.nextStep || thread.dueDate) ? 'project' : 'idea';
  if (guess === 'task') {
    return notes >= TASK_TO_PROJECT_NOTES && !LIST_LIKE.includes(thread.category) ? 'project' : 'task';
  }
  if (!guess && notes >= PROJECT_NOTES) return 'project';
  return guess;
}

// English, Bangla and Banglish, like the rest of lib/understand.ts.

const IDEA =
  /\b(idea|ideas|what if|imagine|concept|brainstorm|would be (?:cool|nice|fun)|could (?:build|make|start|try)|someday|one day i|maybe (?:i|we) (?:could|should))\b|আইডিয়া|আইডিয়া|ধারণা/i;
const PROJECT =
  /\b(project|projects|roadmap|milestones?|launch|redesign|portfolio|thesis|renovation|startup|side project|sprint|phase \d|plan for|planning)\b|প্রজেক্ট|প্রকল্প|পরিকল্পনা/i;
const TASK =
  /^(?:please |pls |plz )?(?:buy|call|email|text|send|pay|book|pick up|get|fix|submit|renew|finish|bring|return|cancel|schedule|remind me|reminder|don'?t forget|need to|have to|must|go to)\b|\b(?:korte hobe|dite hobe|kinte hobe|nite hobe|jete hobe|lagbe|bhulo na)\b|করতে হবে|দিতে হবে|কিনতে হবে|নিতে হবে|যেতে হবে|লাগবে|ভুলো না|মনে করিয়ে/i;

/**
 * The phone's guess from a note's words and what it already read in them.
 * Undefined when nothing says which: better no label than a wrong one.
 */
export function readKind(
  text: string,
  read: { due?: number; nextStep?: string; checklist: number },
): ThreadKind | undefined {
  const t = text.trim().normalize('NFC');
  if (!t && read.checklist === 0) return undefined;
  // "An idea for Friday's talk" with a time is still something to do then.
  if (IDEA.test(t) && read.due === undefined) return 'idea';
  if (read.due !== undefined || read.checklist > 0) return 'task';
  if (PROJECT.test(t)) return 'project';
  if (TASK.test(t) || read.nextStep) return 'task';
  return undefined;
}
