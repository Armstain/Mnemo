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

const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, half: 0.5, dozen: 12,
};
const SCALE: Record<string, number> = { thousand: 1000, million: 1_000_000 };

/** English number words ("forty five", "two hundred") as values. */
function wordNumbers(text: string): number[] {
  const found: number[] = [];
  let current = 0;
  let total = 0;
  let inNumber = false;
  const flush = () => {
    if (inNumber) found.push(total + current);
    current = 0;
    total = 0;
    inNumber = false;
  };
  for (const word of text.toLowerCase().split(/[^a-z]+/)) {
    if (word in SMALL) {
      current += SMALL[word];
      inNumber = true;
    } else if (word === 'hundred' && inNumber) {
      current *= 100;
    } else if (word in SCALE && inNumber) {
      total += current * SCALE[word];
      current = 0;
    } else if (word === 'and' && inNumber) {
      // "one hundred and twenty"
    } else {
      flush();
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
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: unit,
        minimumFractionDigits: whole ? 0 : 2,
        maximumFractionDigits: whole ? 0 : 2,
      }).format(value);
    } catch {
      // No Intl support for this code: fall through to "40 EUR".
    }
  }
  const number = whole ? String(Math.round(value)) : String(round2(value));
  if (!unit) return number;
  return unit === '%' ? `${number}%` : `${number} ${unit}`;
}
