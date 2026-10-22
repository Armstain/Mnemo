import { tokenize } from '@/lib/bm25';
import { metricKey } from '@/lib/measures';
import type { Entry, MnemoItem } from '@/types/mnemo';
import { DAY_MS } from '@/utils/time';

// Finding things on the phone: a time span said in the search ("cng last
// week", "গত মাসে বাজার"), totals of the numbers that match across every
// thread, and matching inside one thread's timeline.

export interface Period {
  from: number;
  to: number;
  /** "Last week", for the chip under the search box. */
  label: string;
}


function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeek(ts: number): number {
  // Weeks start on Saturday in Bangladesh and Sunday or Monday elsewhere;
  // "this week" here is simply the last seven days including today.
  return startOfDay(ts) - 6 * DAY_MS;
}

const MONTHS = [
  ['january', 'jan', 'জানুয়ারি'],
  ['february', 'feb', 'ফেব্রুয়ারি'],
  ['march', 'mar', 'মার্চ'],
  ['april', 'apr', 'এপ্রিল'],
  ['may', 'মে'],
  ['june', 'jun', 'জুন'],
  ['july', 'jul', 'জুলাই'],
  ['august', 'aug', 'আগস্ট'],
  ['september', 'sep', 'sept', 'সেপ্টেম্বর'],
  ['october', 'oct', 'অক্টোবর'],
  ['november', 'nov', 'নভেম্বর'],
  ['december', 'dec', 'ডিসেম্বর'],
].map((names) => names.map((n) => n.normalize('NFC')));

interface PeriodRule {
  re: RegExp;
  make: (now: number, m: RegExpMatchArray) => Omit<Period, 'label'> & { label?: string };
  label: string;
}

const RULES: PeriodRule[] = [
  { re: /\b(today|ajke|aj)\b|আজকে|আজ/i, label: 'Today', make: (now) => ({ from: startOfDay(now), to: now + DAY_MS }) },
  {
    re: /\b(yesterday|gotokal)\b|গতকাল/i,
    label: 'Yesterday',
    make: (now) => ({ from: startOfDay(now) - DAY_MS, to: startOfDay(now) }),
  },
  {
    re: /\b(this week|past week)\b|এই সপ্তাহে?|\bei (shoptah|soptah)e?\b/i,
    label: 'This week',
    make: (now) => ({ from: startOfWeek(now), to: now + DAY_MS }),
  },
  {
    re: /\blast week\b|গত সপ্তাহে?|\bgoto (shoptah|soptah)e?\b/i,
    label: 'Last week',
    make: (now) => ({ from: startOfWeek(now) - 7 * DAY_MS, to: startOfWeek(now) }),
  },
  {
    re: /\bthis month\b|এই মাসে?|\bei mashe?\b/i,
    label: 'This month',
    make: (now) => {
      const d = new Date(now);
      return { from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: now + DAY_MS };
    },
  },
  {
    re: /\blast month\b|গত মাসে?|\bgoto mashe?\b/i,
    label: 'Last month',
    make: (now) => {
      const d = new Date(now);
      return {
        from: new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(),
        to: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
      };
    },
  },
  {
    re: /\bthis year\b|এই বছরে?/i,
    label: 'This year',
    make: (now) => ({ from: new Date(new Date(now).getFullYear(), 0, 1).getTime(), to: now + DAY_MS }),
  },
  {
    re: /\b(?:last|past) (\d{1,3}) days\b|(?:গত|শেষ) ([০-৯\d]{1,3}) দিনে?/i,
    label: '',
    make: (now, m) => {
      const n = Number((m[1] ?? m[2]).replace(/[০-৯]/g, (c) => String(c.charCodeAt(0) - 0x9e6)));
      return { from: startOfDay(now) - (n - 1) * DAY_MS, to: now + DAY_MS, label: `Last ${n} days` };
    },
  },
];

/**
 * A time span named in a search, and the search without it. "cng last
 * week" → last week, "cng". Month names mean that month, this year (or
 * last year's, if it hasn't come yet).
 */
export function readPeriod(query: string, now = Date.now()): { period?: Period; rest: string } {
  const text = query.normalize('NFC');
  for (const rule of RULES) {
    const m = text.match(rule.re);
    if (!m) continue;
    const made = rule.make(now, m);
    return {
      period: { from: made.from, to: made.to, label: made.label ?? rule.label },
      rest: text.replace(m[0], ' ').replace(/\s+/g, ' ').trim(),
    };
  }
  const words = text.toLowerCase().split(/\s+/);
  for (const [i, word] of words.entries()) {
    const month = MONTHS.findIndex((names) => names.includes(word.replace(/[ে]$/, '')));
    // "may" is also a word; only as the whole query's month with "in".
    if (month < 0 || (word === 'may' && words[i - 1] !== 'in')) continue;
    const d = new Date(now);
    let year = d.getFullYear();
    if (month > d.getMonth()) year -= 1;
    const from = new Date(year, month, 1).getTime();
    const to = new Date(year, month + 1, 1).getTime();
    const rest = words.filter((_, j) => j !== i && !(j === i - 1 && /^(in|during)$/.test(words[j]))).join(' ');
    return { period: { from, to, label: new Date(from).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }, rest };
  }
  return { rest: query.trim() };
}

/** Threads with something added in the period (an entry, or the thread itself). */
export function threadsInPeriod(items: MnemoItem[], entries: Entry[], period: Period): Set<string> {
  const ids = new Set<string>();
  for (const e of entries) if (e.createdAt >= period.from && e.createdAt < period.to) ids.add(e.threadId);
  for (const t of items) if (t.createdAt >= period.from && t.createdAt < period.to) ids.add(t.id);
  return ids;
}

export interface Total {
  /** What was matched: "CNG", "spent". */
  label: string;
  unit?: string;
  total: number;
  count: number;
  threads: number;
  /** The threads these numbers came from. */
  threadIds: string[];
}

/**
 * Adds up the numbers whose label, metric or group matches the search,
 * across every thread ("cng" → all CNG fares; "spent last month" → all
 * spending last month). Only amounts that add up (rollup "sum") count, and
 * each unit is totalled apart: nothing is converted.
 */
export function totalsFor(query: string, entries: Entry[], period?: Period): Total[] {
  // Words that never name a number ("how much did I spend on cng?") drop out.
  const named = new Set<string>();
  for (const entry of entries)
    for (const block of entry.blocks)
      if (block.kind === 'measures')
        for (const m of block.items) for (const w of tokenize(`${m.label ?? ''} ${m.metric} ${m.group ?? ''}`)) named.add(w);
  const terms = tokenize(query).filter((t) => named.has(t));
  if (terms.length === 0) return [];
  const groups = new Map<string, Omit<Total, 'threadIds'> & { threadIds: Set<string> }>();
  for (const entry of entries) {
    if (period && (entry.createdAt < period.from || entry.createdAt >= period.to)) continue;
    for (const block of entry.blocks) {
      if (block.kind !== 'measures') continue;
      for (const m of block.items) {
        if (m.rollup !== 'sum') continue;
        const words = new Set(tokenize(`${m.label ?? ''} ${m.metric} ${m.group ?? ''}`));
        if (!terms.every((t) => words.has(t))) continue;
        // Named by the words searched for, as they appear in the reading.
        const key = `${terms.join(' ')}|${m.unit ?? ''}|${metricKey(m.metric)}`;
        const g = groups.get(key) ?? {
          label: terms.every((t) => tokenize(m.metric).includes(t)) ? m.metric : (m.label ?? m.metric),
          unit: m.unit,
          total: 0,
          count: 0,
          threads: 0,
          threadIds: new Set<string>(),
        };
        g.total += m.value;
        g.count += 1;
        g.threadIds.add(entry.threadId);
        g.threads = g.threadIds.size;
        groups.set(key, g);
      }
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((t) => ({ ...t, threadIds: [...t.threadIds], total: Math.round(t.total * 100) / 100 }));
}

/** Entries of one thread that contain every word searched for (any order, word starts count). */
export function matchEntries(entries: Entry[], query: string, textOf: (e: Entry) => string): Entry[] {
  const terms = tokenize(query);
  if (terms.length === 0) return entries;
  return entries.filter((e) => {
    const words = tokenize(textOf(e));
    return terms.every((t) => words.some((w) => w.startsWith(t)));
  });
}
