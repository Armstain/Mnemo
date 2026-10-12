import type { Entry, Measure, Rollup } from '@/types/mnemo';

// Measures: any number someone reports about their life (money spent, km
// run, their weight, a price they're comparing). The AI only pulls numbers
// out of what was said. Everything here runs on the device: checking each
// value was really said, and every total, average and trend, so the maths
// is arithmetic rather than a guess.

export const ROLLUPS: Rollup[] = ['sum', 'latest', 'average', 'compare'];

const MAX_ITEMS = 30;
const MAX_VALUE = 1e12;

// ─── Reading numbers out of text ────────────────────────────────

// First code point of each script's 0–9 run (Latin, Arabic-Indic, Persian,
// Devanagari, Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada,
// Malayalam, Thai, Lao, full-width), so "৪০" reads as 40.
const DIGIT_ZEROS = [
  0x30, 0x660, 0x6f0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66, 0xe50, 0xed0,
  0xff10,
];
const NON_ASCII_DIGIT = new RegExp(
  `[${DIGIT_ZEROS.slice(1)
    .map((z) => `\\u${z.toString(16).padStart(4, '0')}-\\u${(z + 9).toString(16).padStart(4, '0')}`)
    .join('')}]`,
  'g',
);

function toAsciiDigits(text: string): string {
  return text.replace(NON_ASCII_DIGIT, (ch) => {
    const code = ch.charCodeAt(0);
    const zero = DIGIT_ZEROS.find((z) => code >= z && code <= z + 9);
    return zero === undefined ? ch : String(code - zero);
  });
}

// ─── Number words: English, Bangla and Banglish ────────────────

type Word =
  | { kind: 'unit'; value: number }
  | { kind: 'hundred' }
  | { kind: 'scale'; value: number }
  /** Adjusts the next unit: সাড়ে তিন = 3.5, পৌনে দুই = 1.75. */
  | { kind: 'offset'; value: number }
  | { kind: 'and' };

const WORDS = new Map<string, Word>();
const unit = (value: number, ...words: string[]) => words.forEach((w) => WORDS.set(w, { kind: 'unit', value }));
const scale = (value: number, ...words: string[]) => words.forEach((w) => WORDS.set(w, { kind: 'scale', value }));
const offset = (value: number, ...words: string[]) => words.forEach((w) => WORDS.set(w, { kind: 'offset', value }));

// English
'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'
  .split(' ')
  .forEach((w, i) => unit(i, w));
'twenty thirty forty fifty sixty seventy eighty ninety'.split(' ').forEach((w, i) => unit((i + 2) * 10, w));
unit(0.5, 'half');
unit(12, 'dozen');
WORDS.set('hundred', { kind: 'hundred' });
WORDS.set('and', { kind: 'and' });
scale(1000, 'thousand');
scale(1_000_000, 'million');

// Bangla: every number from 1 to 99 is its own word. Spelling variants
// separated by "|".
const BANGLA_1_TO_99 = [
  'এক', 'দুই|দুই|দু', 'তিন', 'চার', 'পাঁচ|পাচ', 'ছয়|ছয়|ছয়|ছ', 'সাত', 'আট', 'নয়|নয়|নয়', 'দশ',
  'এগারো|এগার', 'বারো|বার', 'তেরো|তের', 'চৌদ্দ|চোদ্দ', 'পনেরো|পনের', 'ষোলো|ষোল', 'সতেরো|সতের', 'আঠারো|আঠার', 'উনিশ|ঊনিশ', 'বিশ|কুড়ি',
  'একুশ', 'বাইশ', 'তেইশ', 'চব্বিশ', 'পঁচিশ|পচিশ', 'ছাব্বিশ', 'সাতাশ', 'আটাশ', 'ঊনত্রিশ|উনত্রিশ', 'ত্রিশ|তিরিশ',
  'একত্রিশ', 'বত্রিশ', 'তেত্রিশ', 'চৌত্রিশ', 'পঁয়ত্রিশ', 'ছত্রিশ', 'সাঁইত্রিশ', 'আটত্রিশ', 'ঊনচল্লিশ|উনচল্লিশ', 'চল্লিশ',
  'একচল্লিশ', 'বিয়াল্লিশ', 'তেতাল্লিশ', 'চুয়াল্লিশ', 'পঁয়তাল্লিশ', 'ছেচল্লিশ', 'সাতচল্লিশ', 'আটচল্লিশ', 'ঊনপঞ্চাশ|উনপঞ্চাশ', 'পঞ্চাশ',
  'একান্ন', 'বাহান্ন|বায়ান্ন', 'তিপ্পান্ন', 'চুয়ান্ন', 'পঞ্চান্ন', 'ছাপ্পান্ন', 'সাতান্ন', 'আটান্ন', 'ঊনষাট|উনষাট', 'ষাট',
  'একষট্টি', 'বাষট্টি', 'তেষট্টি', 'চৌষট্টি', 'পঁয়ষট্টি', 'ছেষট্টি', 'সাতষট্টি', 'আটষট্টি', 'ঊনসত্তর|উনসত্তর', 'সত্তর',
  'একাত্তর', 'বাহাত্তর', 'তিয়াত্তর', 'চুয়াত্তর', 'পঁচাত্তর', 'ছিয়াত্তর', 'সাতাত্তর', 'আটাত্তর', 'ঊনআশি|উনআশি', 'আশি',
  'একাশি', 'বিরাশি', 'তিরাশি', 'চুরাশি', 'পঁচাশি', 'ছিয়াশি', 'সাতাশি', 'অষ্টাশি', 'ঊননব্বই|উননব্বই', 'নব্বই',
  'একানব্বই', 'বিরানব্বই', 'তিরানব্বই', 'চুরানব্বই', 'পঁচানব্বই', 'ছিয়ানব্বই', 'সাতানব্বই', 'আটানব্বই', 'নিরানব্বই',
];
BANGLA_1_TO_99.forEach((variants, i) => unit(i + 1, ...variants.split('|').map(nfc)));
unit(1.5, nfc('দেড়'));
unit(2.5, nfc('আড়াই'));
offset(0.5, nfc('সাড়ে'));
offset(-0.25, nfc('পৌনে'));
offset(0.25, nfc('সোয়া'));
['শো', 'শ', 'শত'].forEach((w) => WORDS.set(nfc(w), { kind: 'hundred' }));
scale(1000, nfc('হাজার'));
scale(100_000, nfc('লাখ'), nfc('লক্ষ'));
scale(10_000_000, nfc('কোটি'));

// Banglish (Bangla typed in Latin letters). Only spellings that don't
// collide with common English words ("at", "so", "share" are left out).
unit(1, 'ek');
unit(2, 'dui', 'du');
unit(3, 'tin', 'teen');
unit(4, 'char', 'chaar');
unit(5, 'pach', 'panch', 'paach', 'paanch');
unit(6, 'choy', 'chhoy');
unit(7, 'sat', 'saat');
unit(8, 'aat');
unit(9, 'noy', 'nou');
unit(10, 'dosh', 'dos');
unit(11, 'egaro');
unit(12, 'baro');
unit(13, 'tero');
unit(14, 'choddo', 'chouddo');
unit(15, 'ponero', 'pnero', 'ponro');
unit(16, 'sholo', 'solo');
unit(17, 'shotero', 'sotero');
unit(18, 'atharo', 'aatharo');
unit(19, 'unish');
unit(20, 'bish', 'kuri');
unit(25, 'pochish', 'ponchish');
unit(30, 'tirish', 'trish');
unit(40, 'chollish');
unit(50, 'ponchash', 'panchash');
unit(70, 'sottor', 'shottor');
unit(80, 'ashi');
unit(90, 'nobboi', 'nabboi');
unit(1.5, 'der', 'dedh', 'derh');
unit(2.5, 'arai', 'arhai', 'adai');
offset(0.5, 'sare', 'saare', 'shaare', 'sarhe');
offset(-0.25, 'poune', 'pone');
offset(0.25, 'shoa', 'sowa', 'soa');
['sho', 'shoo', 'shoto', 'hundred'].forEach((w) => WORDS.set(w, { kind: 'hundred' }));
scale(1000, 'hajar', 'hazar', 'hajaar', 'hazaar');
scale(100_000, 'lakh', 'lac', 'lak', 'lakhs');
scale(10_000_000, 'koti', 'crore', 'cr');

function nfc(text: string): string {
  try {
    return text.normalize('NFC');
  } catch {
    return text;
  }
}

// Endings a number word can carry in a sentence: "হাজারের", "hajarer".
const SUFFIXES = ['ের', 'এর', 'টা', 'টি', 'খানেক', 'র', 'ে', 'er', 'ta', 'r', 'e'].map(nfc);

/** A token as number words: itself, minus an ending, or split ("পনেরোশো", "derhajar"). */
function lookup(token: string): Word[] | null {
  const direct = WORDS.get(token);
  if (direct) return [direct];
  for (const suffix of SUFFIXES) {
    if (token.length > suffix.length + 1 && token.endsWith(suffix)) {
      const found = WORDS.get(token.slice(0, -suffix.length));
      if (found) return [found];
    }
  }
  for (let i = 1; i < token.length; i++) {
    const left = WORDS.get(token.slice(0, i));
    if (!left || (left.kind !== 'unit' && left.kind !== 'offset')) continue;
    const rest = lookup(token.slice(i));
    if (rest && rest.every((w) => w.kind === 'hundred' || w.kind === 'scale')) return [left, ...rest];
  }
  return null;
}

/**
 * Numbers said in words, in any mix of English, Bangla and Banglish, and
 * digits followed by a scale word ("১৫ হাজার", "2 lakh", "der hajar").
 */
function wordNumbers(text: string): number[] {
  return scanNumbers(numberTokens(text)).map((n) => n.value);
}

/**
 * Text split the way numbers are read: lower case, digits in ASCII, figures
 * apart from letters ("1500tk" → "1500", "tk"; "৳৫০" → "৳", "50").
 */
export function numberTokens(text: string, keepCase = false): string[] {
  const ascii = toAsciiDigits(text);
  return nfc((keepCase ? ascii : ascii.toLowerCase()).replace(/(\d),(?=\d)/g, '$1'))
    .split(/[\s,;:!?()"'“”‘’।|/\\–—-]+/)
    .flatMap((t) => t.match(/\d+(?:\.\d+)?|[^\d]+/g) ?? []);
}

/** A number found in `numberTokens` output, with the tokens it spans. */
export interface NumberSpan {
  value: number;
  first: number;
  last: number;
}

/** Every number in a token list, in order, said in figures or words. */
export function scanNumbers(tokens: string[]): NumberSpan[] {
  const found: NumberSpan[] = [];
  let first = -1;
  let last = -1;
  let total = 0;
  let current = 0;
  let pending = 0;
  let inNumber = false;
  let lastUnit: number | null = null;
  let lastWasDigits = false;

  const flush = () => {
    if (inNumber) found.push({ value: total + current, first, last });
    total = 0;
    current = 0;
    pending = 0;
    inNumber = false;
    lastUnit = null;
    lastWasDigits = false;
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const begin = () => {
      if (!inNumber) first = i;
      last = i;
    };
    if (/^\d/.test(token)) {
      // A new figure always starts a new number ("1 200" isn't 201).
      if (inNumber && (lastUnit !== null || lastWasDigits)) flush();
      begin();
      current += parseFloat(token) + pending;
      pending = 0;
      inNumber = true;
      lastUnit = null;
      lastWasDigits = true;
      continue;
    }
    const words = lookup(token);
    if (!words) {
      flush();
      continue;
    }
    for (const word of words) {
      if (word.kind === 'unit') {
        // "twenty five" adds up; two units in any other order are two numbers.
        const joins = lastUnit !== null && lastUnit >= 20 && lastUnit % 10 === 0 && word.value < 10;
        if (inNumber && (lastWasDigits || (lastUnit !== null && !joins))) flush();
        if (!inNumber) first = pending ? Math.max(0, i - 1) : i;
        last = i;
        current += word.value + pending;
        pending = 0;
        inNumber = true;
        lastUnit = word.value;
        lastWasDigits = false;
      } else if (word.kind === 'hundred') {
        if (inNumber) {
          current = (current || 1) * 100;
          last = i;
        }
        lastUnit = null;
        lastWasDigits = false;
      } else if (word.kind === 'scale') {
        total += (inNumber ? current || 1 : 1) * word.value;
        begin();
        current = 0;
        inNumber = true;
        lastUnit = null;
        lastWasDigits = false;
      } else if (word.kind === 'offset') {
        if (inNumber) flush();
        pending = word.value;
      }
      // 'and' just continues the number: "one hundred and twenty".
    }
  }
  flush();
  return found;
}

/**
 * Every value a piece of text could be naming. Separators are ambiguous
 * ("1,200" vs "12,50"), so both readings are kept; "k" after a number
 * means thousands.
 */
export function numbersIn(text: string): number[] {
  const ascii = toAsciiDigits(text);
  const values = new Set<number>();
  const token = /(\d[\d.,]*)(\s*[kK]\b)?/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(ascii))) {
    const raw = match[1].replace(/[.,]+$/, '');
    const readings = [
      parseFloat(raw.replace(/,/g, '')), // 1,200.50
      parseFloat(raw.replace(/\./g, '').replace(',', '.')), // 1.200,50 / 12,50
      parseFloat(raw), // 12 from "12.5.3"
    ];
    for (const n of readings) {
      if (!Number.isFinite(n)) continue;
      values.add(n);
      if (match[2]) values.add(n * 1000);
    }
  }
  for (const n of wordNumbers(text)) values.add(n);
  return [...values];
}

// ─── Units ──────────────────────────────────────────────────────

// Common ISO 4217 codes. A three-letter unit is only money if it's one of
// these, so "min" or "hrs" never get a currency symbol.
const CURRENCIES = new Set(
  (
    'USD EUR GBP BDT INR PKR LKR NPR JPY CNY KRW HKD TWD SGD MYR THB IDR PHP VND AUD NZD CAD ' +
    'CHF SEK NOK DKK PLN CZK HUF RON TRY AED SAR QAR KWD BHD OMR ILS EGP NGN KES ZAR BRL MXN ' +
    'ARS CLP COP PEN RUB UAH'
  ).split(' '),
);

export function isCurrency(unit?: string): boolean {
  return !!unit && CURRENCIES.has(unit);
}

function normalizeUnit(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const unit = raw.trim().slice(0, 12);
  if (!unit) return undefined;
  return CURRENCIES.has(unit.toUpperCase()) ? unit.toUpperCase() : unit;
}

/** The key two measures share when they track the same thing. */
export function metricKey(metric: string): string {
  return metric.trim().toLowerCase().replace(/\s+/g, ' ');
}

function cleanText(raw: unknown, max: number): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const text = raw.trim().slice(0, max);
  return text || undefined;
}

// ─── Checking what the AI returned ──────────────────────────────

/**
 * Keeps only well-formed measures whose value appears in `source` (what
 * the person actually said or typed). A number the model inferred,
 * converted or added up is dropped; the words stay in the entry's text.
 */
export function verifyMeasures(raw: unknown, source: string): Measure[] {
  if (!Array.isArray(raw)) return [];
  const said = numbersIn(source);
  const seen = new Set<string>();
  const out: Measure[] = [];

  for (const value of raw) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const metric = cleanText(v.metric, 30);
    const amount = typeof v.value === 'number' ? v.value : Number(v.value);
    if (!metric || !Number.isFinite(amount) || Math.abs(amount) >= MAX_VALUE) continue;
    if (!said.some((n) => Math.abs(n - Math.abs(amount)) < 0.005)) continue;

    const measure: Measure = {
      metric,
      value: amount,
      unit: normalizeUnit(v.unit),
      label: cleanText(v.label, 40),
      group: cleanText(v.group, 24)?.toLowerCase(),
      rollup: ROLLUPS.includes(v.rollup as Rollup) ? (v.rollup as Rollup) : 'sum',
    };
    const key = `${metricKey(metric)}|${amount}|${measure.unit ?? ''}|${measure.label ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(measure);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

// ─── Rolling up a thread ────────────────────────────────────────

export interface MeasurePoint {
  value: number;
  at: number;
  label?: string;
  group?: string;
}

export interface MetricSummary {
  key: string;
  /** Display name, as first said. */
  metric: string;
  unit?: string;
  rollup: Rollup;
  /** Readings in `unit`, oldest first. */
  points: MeasurePoint[];
  lastAt: number;
  /** sum */
  total?: number;
  days?: number;
  perDay?: number;
  byGroup?: { group: string; total: number }[];
  /** latest */
  latest?: number;
  first?: number;
  change?: number;
  /** average */
  average?: number;
  min?: number;
  max?: number;
  /** compare: the latest value for each option, lowest first. */
  options?: { label: string; value: number }[];
  /** Readings in any other unit, kept apart: nothing is converted. */
  others: { unit: string; count: number; total: number }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function mostCommon<T>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * One summary per thing a thread tracks, most recently updated first. A
 * reading with no unit counts in the metric's usual unit; a reading in a
 * different unit is listed separately rather than converted.
 */
export function summarizeMeasures(entries: Entry[]): MetricSummary[] {
  const byMetric = new Map<string, { measure: Measure; at: number }[]>();
  for (const entry of entries) {
    for (const block of entry.blocks) {
      if (block.kind !== 'measures') continue;
      for (const measure of block.items) {
        const key = metricKey(measure.metric);
        const list = byMetric.get(key) ?? [];
        list.push({ measure, at: entry.createdAt });
        byMetric.set(key, list);
      }
    }
  }

  const summaries: MetricSummary[] = [];
  for (const [key, readings] of byMetric) {
    readings.sort((a, b) => a.at - b.at);
    const unit = mostCommon(readings.flatMap((r) => (r.measure.unit ? [r.measure.unit] : [])));
    const rollup = mostCommon(readings.map((r) => r.measure.rollup)) ?? 'sum';

    const points: MeasurePoint[] = [];
    const others = new Map<string, { count: number; total: number }>();
    for (const { measure, at } of readings) {
      const u = measure.unit ?? unit;
      if (u && unit && u !== unit) {
        const o = others.get(u) ?? { count: 0, total: 0 };
        o.count += 1;
        o.total += measure.value;
        others.set(u, o);
        continue;
      }
      points.push({ value: measure.value, at, label: measure.label, group: measure.group });
    }
    if (points.length === 0) continue;

    const summary: MetricSummary = {
      key,
      metric: readings[0].measure.metric,
      unit,
      rollup,
      points,
      lastAt: readings[readings.length - 1].at,
      others: [...others.entries()].map(([u, o]) => ({ unit: u, count: o.count, total: round2(o.total) })),
    };
    const values = points.map((p) => p.value);

    if (rollup === 'sum') {
      const total = values.reduce((a, b) => a + b, 0);
      const days = new Set(points.map((p) => dayKey(p.at))).size;
      const groups = new Map<string, number>();
      for (const p of points) {
        if (p.group) groups.set(p.group, (groups.get(p.group) ?? 0) + p.value);
      }
      summary.total = round2(total);
      summary.days = days;
      summary.perDay = days > 1 ? round2(total / days) : undefined;
      summary.byGroup =
        groups.size > 0
          ? [...groups.entries()]
              .map(([group, t]) => ({ group, total: round2(t) }))
              .sort((a, b) => b.total - a.total)
          : undefined;
    } else if (rollup === 'latest') {
      summary.latest = values[values.length - 1];
      summary.first = values[0];
      summary.change = values.length > 1 ? round2(values[values.length - 1] - values[0]) : undefined;
    } else if (rollup === 'average') {
      summary.average = round2(values.reduce((a, b) => a + b, 0) / values.length);
      summary.min = Math.min(...values);
      summary.max = Math.max(...values);
    } else {
      const latestByOption = new Map<string, number>();
      for (const p of points) latestByOption.set(p.label ?? summary.metric, p.value);
      summary.options = [...latestByOption.entries()]
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => a.value - b.value);
    }
    summaries.push(summary);
  }
  return summaries.sort((a, b) => b.lastAt - a.lastAt);
}

/** "spent (EUR, sum)": what a thread already tracks, so new captures reuse the names. */
export function trackedMetrics(entries: Entry[], limit = 5): string[] {
  return summarizeMeasures(entries)
    .slice(0, limit)
    .map((s) => `${s.metric} (${[s.unit, s.rollup].filter(Boolean).join(', ')})`);
}

/** "€40", "5.2 km", "72.4 kg", or a bare number when there's no unit. */
export function formatValue(value: number, unit?: string): string {
  const whole = Math.abs(value % 1) < 0.005;
  if (isCurrency(unit)) {
    // "৳1,500" rather than "BDT 1,500"; older Intl builds lack narrowSymbol.
    for (const currencyDisplay of ['narrowSymbol', 'symbol'] as const) {
      try {
        return new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: unit,
          currencyDisplay,
          minimumFractionDigits: whole ? 0 : 2,
          maximumFractionDigits: whole ? 0 : 2,
        }).format(value);
      } catch {
        // Try the next display, then fall through to "40 EUR".
      }
    }
  }
  const number = whole ? String(Math.round(value)) : String(round2(value));
  if (!unit) return number;
  return unit === '%' ? `${number}%` : `${number} ${unit}`;
}
