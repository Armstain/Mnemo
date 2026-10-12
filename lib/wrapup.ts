import { formatValue, summarizeMeasures, type MetricSummary } from '@/lib/measures';
import type { Entry, MnemoItem } from '@/types/mnemo';

// Wrapping up a thread: when a trip, project or errand is over, one card
// says what it was. When it ran, how much went into it, what the numbers
// came to, and what's still open. Worked out on the phone.

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ThreadWrap {
  from: number;
  to: number;
  /** Calendar days from the first note to the last, counting both. */
  days: number;
  entries: number;
  voice: number;
  photos: number;
  links: number;
  stepsDone: number;
  /** Next steps never ticked off and unticked list items, newest first. */
  openSteps: string[];
  numbers: MetricSummary[];
}

function dayOf(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * What's still to do in a thread: its next step, steps notes gave that were
 * never ticked off, and unticked list items. Newest first, no repeats.
 */
export function openStepsOf(entries: Entry[], thread?: Pick<MnemoItem, 'nextStep'>): string[] {
  const steps: string[] = thread?.nextStep ? [thread.nextStep] : [];
  for (const e of [...entries].sort((a, b) => b.createdAt - a.createdAt)) {
    if (e.nextStep && !e.stepDone) steps.push(e.nextStep);
    for (const b of e.blocks) if (b.kind === 'checklist') steps.push(...b.items.filter((i) => !i.checked).map((i) => i.text));
  }
  const seen = new Set<string>();
  return steps
    .map((s) => s.trim())
    .filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
}

export function wrapThread(thread: MnemoItem, entries: Entry[]): ThreadWrap {
  const mine = entries.filter((e) => e.threadId === thread.id);
  const times = mine.map((e) => e.createdAt);
  const from = Math.min(thread.createdAt, ...times);
  const to = Math.max(thread.createdAt, ...times);
  const blocks = mine.flatMap((e) => e.blocks);
  return {
    from,
    to,
    days: Math.round((dayOf(to) - dayOf(from)) / DAY_MS) + 1,
    entries: mine.length,
    voice: mine.filter((e) => e.source === 'voice').length,
    photos: blocks.filter((b) => b.kind === 'image').length,
    links: blocks.filter((b) => b.kind === 'link').length,
    stepsDone: mine.filter((e) => e.nextStep && e.stepDone).length,
    openSteps: openStepsOf(mine, thread),
    numbers: summarizeMeasures(mine),
  };
}

/**
 * "Oct 9 – 12" / "Oct 30 – Nov 2" / "Oct 9", with the year when it isn't
 * this one: "Dec 28, 2025 – Jan 3, 2026", "Mar 3 – 9, 2025".
 */
export function spanLabel(from: number, to: number, now = Date.now()): string {
  const a = new Date(from), b = new Date(to);
  const month = (d: Date) => d.toLocaleDateString('en-US', { month: 'short' });
  const thisYear = new Date(now).getFullYear();
  const sameYear = a.getFullYear() === b.getFullYear();
  const year = (d: Date) => (sameYear && d.getFullYear() === thisYear ? '' : `, ${d.getFullYear()}`);
  if (dayOf(from) === dayOf(to)) return `${month(a)} ${a.getDate()}${year(a)}`;
  if (sameYear && a.getMonth() === b.getMonth()) return `${month(a)} ${a.getDate()} – ${b.getDate()}${year(b)}`;
  return `${month(a)} ${a.getDate()}${sameYear ? '' : year(a)} – ${month(b)} ${b.getDate()}${year(b)}`;
}

/** The headline figure of a tracked number, as its card shows it. */
export function headline(s: MetricSummary): string {
  const v = s.rollup === 'sum' ? s.total : s.rollup === 'latest' ? s.latest : s.rollup === 'average' ? s.average : s.options?.[0]?.value;
  return formatValue(v ?? 0, s.unit);
}

/** The wrap-up as plain text, for sharing where an image can't go. */
export function wrapText(thread: MnemoItem, w: ThreadWrap): string {
  const lines = [
    thread.title,
    `${spanLabel(w.from, w.to)} · ${w.days} ${w.days === 1 ? 'day' : 'days'} · ${w.entries} ${w.entries === 1 ? 'note' : 'notes'}`,
  ];
  for (const s of w.numbers.slice(0, 3)) {
    lines.push(`${s.metric.charAt(0).toUpperCase() + s.metric.slice(1)}: ${headline(s)}`);
    for (const g of s.byGroup?.slice(0, 4) ?? []) lines.push(`  ${g.group}: ${formatValue(g.total, s.unit)}`);
  }
  if (w.stepsDone > 0) lines.push(`${w.stepsDone} ${w.stepsDone === 1 ? 'step' : 'steps'} done`);
  if (w.openSteps.length > 0) lines.push(`Still open: ${w.openSteps.join('; ')}`);
  lines.push('', 'Kept with Mnemo');
  return lines.join('\n');
}
