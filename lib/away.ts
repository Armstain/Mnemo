import { kindOf } from '@/lib/kind';
import { lastActivity, quietDays } from '@/lib/review';
import { nextOccurrence } from '@/lib/when';
import type { Entry, MnemoItem, ThreadKind } from '@/types/mnemo';
import { DAY_MS } from '@/utils/time';

// Coming back after a while. The Resume card answers "what was I doing?"
// for one thread; after days away that's not enough. This is the rest:
// how long it's been, what came and went, and what's still to do across
// everything, said in one line and a few rows. Worked out on the phone, so
// it's there the instant the app opens, offline too.

/** Away this long and Home says "welcome back" with what's waiting. */
export const AWAY_DAYS = 3;
/** Once back, the card stays (unless dismissed) for this long, across reopens. */
export const KEEP_SHOWING_MS = 12 * 60 * 60 * 1000;
/** Rows the card lists before handing over to "Your week". */
export const AWAY_ROWS = 4;
/** A missed reminder older than this is old news, not something waiting. */
const MISSED_DAYS = 30;
/** "Coming up" on the card: the next few days. */
const SOON_DAYS = 3;

// ─── When it shows ──────────────────────────────────────────────

export interface AwayState {
  /** When the app was last open (in front of the person). */
  lastSeenAt?: number;
  /** Set while the card shows: when they left, before this return. */
  since?: number;
  /** When they came back: the card keeps showing for a while after. */
  returnedAt?: number;
  /** The `since` the full welcome page was already opened for, so it opens once per return. */
  presentedFor?: number;
}

/**
 * The app came to the front at `now`. Returns the new state; `since` is set
 * when the card should show. The first ever open shows nothing: there's
 * nothing to come back to.
 */
export function onAppActive(prev: AwayState, now: number): AwayState {
  if (prev.since !== undefined && prev.returnedAt !== undefined && now - prev.returnedAt < KEEP_SHOWING_MS) {
    return { ...prev, lastSeenAt: now };
  }
  if (prev.lastSeenAt !== undefined && now - prev.lastSeenAt >= AWAY_DAYS * DAY_MS) {
    return { lastSeenAt: now, since: prev.lastSeenAt, returnedAt: now };
  }
  return { lastSeenAt: now };
}

/** The app went to the background: time away counts from now, not from when it opened. */
export function onAppBackground(prev: AwayState, now: number): AwayState {
  return { ...prev, lastSeenAt: now };
}

// ─── What it says ───────────────────────────────────────────────

export type AwayRowReason =
  | { kind: 'missed'; at: number }
  | { kind: 'due'; at: number }
  | { kind: 'step' }
  | { kind: 'leftOff' };

export interface AwayRow {
  item: MnemoItem;
  /** What to do, or where it was left. */
  text: string;
  reason: AwayRowReason;
  kind?: ThreadKind;
}

export interface AwayDigest {
  since: number;
  /** Whole days away. */
  days: number;
  /** Reminders that came and went (not repeating), most recent first. */
  missed: number;
  /** Open tasks and projects with something to do. */
  toDo: number;
  /** Projects that have gone quiet (a week or more untouched). */
  quietProjects: number;
  /** Ideas kept, so they aren't forgotten either. */
  ideas: number;
  /** Notes that arrived while away (share, widget). */
  added: number;
  /** Home's few rows: everything below in order, minus the Resume card's thread. */
  rows: AwayRow[];
  /** How many rows there are in all (minus the Resume card's), for "See all". */
  total: number;
  /** The welcome page's sections, each minus the Resume card's thread. */
  groups: {
    missed: AwayRow[];
    due: AwayRow[];
    steps: AwayRow[];
    leftOff: AwayRow[];
    ideas: MnemoItem[];
  };
  /** "2 reminders passed, 3 things to do, and a project has gone quiet." */
  line: string;
}

const isOpen = (t: MnemoItem) => t.status === 'active' && !t.pending;

function count(n: number, one: string, many: string): string {
  const words = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  return `${words[n] ?? n} ${n === 1 ? one : many}`;
}

/** "a week", "8 days", "3 weeks", "2 months". */
export function awayFor(days: number): string {
  if (days >= 60) return `${Math.round(days / 30)} months`;
  if (days >= 14) return `${Math.round(days / 7)} weeks`;
  if (days === 7) return 'a week';
  return `${days} days`;
}

/**
 * What's waiting after time away. `exclude` is the thread the Resume card
 * already shows, so the card doesn't say it twice (it still counts).
 */
export function awayDigest(
  items: MnemoItem[],
  entries: Entry[],
  since: number,
  now = Date.now(),
  exclude?: string,
): AwayDigest {
  const byThread = new Map<string, Entry[]>();
  for (const e of entries) {
    const list = byThread.get(e.threadId);
    if (list) list.push(e);
    else byThread.set(e.threadId, [e]);
  }
  const of = (t: MnemoItem) => byThread.get(t.id) ?? [];
  const open = items.filter(isOpen);
  const kinds = new Map(open.map((t) => [t.id, kindOf(t, of(t).length)]));

  const missed: AwayRow[] = [];
  const due: AwayRow[] = [];
  const steps: AwayRow[] = [];
  const leftOff: AwayRow[] = [];
  for (const item of open) {
    const kind = kinds.get(item.id);
    if (kind === 'idea') continue;
    const step = item.nextStep?.trim();
    if (item.dueDate) {
      const at = nextOccurrence(item.dueDate, item.repeat, now);
      if (!item.repeat && at < now && at >= now - MISSED_DAYS * DAY_MS) {
        missed.push({ item, kind, text: step || item.title, reason: { kind: 'missed', at } });
        continue;
      }
      if (at >= now && at < now + SOON_DAYS * DAY_MS) {
        due.push({ item, kind, text: step || item.title, reason: { kind: 'due', at } });
        continue;
      }
    }
    if (step) steps.push({ item, kind, text: step, reason: { kind: 'step' } });
    else if (kind === 'project' && item.whereLeftOff?.trim()) {
      leftOff.push({ item, kind, text: item.whereLeftOff.trim(), reason: { kind: 'leftOff' } });
    }
  }
  const recent = (a: AwayRow, b: AwayRow) => lastActivity(b.item, of(b.item)) - lastActivity(a.item, of(a.item));
  missed.sort((a, b) => (b.reason as { at: number }).at - (a.reason as { at: number }).at);
  due.sort((a, b) => (a.reason as { at: number }).at - (b.reason as { at: number }).at);
  // Starred first: they said it matters. Then the most recently moving.
  const byStarThenRecent = (a: AwayRow, b: AwayRow) =>
    Number(!!b.item.starred) - Number(!!a.item.starred) || recent(a, b);
  steps.sort(byStarThenRecent);
  leftOff.sort(byStarThenRecent);

  const shown = (r: AwayRow) => r.item.id !== exclude;
  const all = [...missed, ...due, ...steps, ...leftOff].filter(shown);
  const ideaItems = open
    .filter((t) => kinds.get(t.id) === 'idea' && t.id !== exclude)
    .sort((a, b) => lastActivity(b, of(b)) - lastActivity(a, of(a)));
  const quietProjects = open.filter((t) => kinds.get(t.id) === 'project' && quietDays(t, of(t), now) !== null).length;
  const ideas = open.filter((t) => kinds.get(t.id) === 'idea').length;
  const added = entries.filter((e) => e.createdAt > since && e.createdAt <= now).length;
  const toDo = steps.length + due.length;

  const parts = [
    missed.length > 0 ? `${count(missed.length, 'reminder', 'reminders')} passed` : '',
    toDo > 0 ? `${count(toDo, 'thing', 'things')} to do` : '',
    quietProjects === 1 ? 'a project has gone quiet' : quietProjects > 1 ? `${count(quietProjects, '', 'projects')} have gone quiet` : '',
  ].filter(Boolean);
  const joined =
    parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : (parts[0] ?? '');
  const line = joined
    ? `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`
    : ideas > 0
      ? `Nothing overdue. ${count(ideas, 'idea is', 'ideas are').replace(/^./, (c) => c.toUpperCase())} waiting when you have a moment.`
      : 'Nothing slipped while you were gone.';

  return {
    since,
    days: Math.max(1, Math.floor((now - since) / DAY_MS)),
    missed: missed.length,
    toDo,
    quietProjects,
    ideas,
    added,
    rows: all.slice(0, AWAY_ROWS),
    total: all.length,
    groups: {
      missed: missed.filter(shown),
      due: due.filter(shown),
      steps: steps.filter(shown),
      leftOff: leftOff.filter(shown),
      ideas: ideaItems,
    },
    line,
  };
}

/**
 * A reminder's time, short enough to sit beside a title on one row:
 * "4:26 PM" today, "Tmrw" / "Yesterday", a weekday within the week, else a date.
 */
export function shortWhen(at: number, now = Date.now()): string {
  const day = (ts: number) => {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const days = Math.round((day(at) - day(now)) / DAY_MS);
  const date = new Date(at);
  if (days === 0) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'Tmrw';
  if (days === -1) return 'Yesterday';
  if (Math.abs(days) < 7) return date.toLocaleDateString('en-US', { weekday: 'short' });
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "Saturday, Oct 24": when they left. */
export function leftOn(since: number): string {
  return new Date(since).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}
