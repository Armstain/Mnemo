import { nfc } from '@/utils/text';

// When a note means: "at 7", "tomorrow evening", "in 20 mins", "every
// Friday", "কাল সকাল ৮টায়", "porshu bikel 4 tay", "সাড়ে ৭টায়". Resolved
// against now into a time that's still ahead, plus a repeat. Also: whether
// a sentence is a plan at all ("met Rumi at 3pm" isn't), and the time words
// to take out of a title. Pure, no device APIs: tests/when-read.test.ts.
// Hermes has no lookbehind and no \p{…}, so Bangla word edges are spelled out.

export type Repeat = 'daily' | 'weekly' | 'monthly';

export interface When {
  at: number;
  repeat?: Repeat;
}

const MINUTE = 60_000;

// A word edge that works for Bangla too: start, space or punctuation.
const S = String.raw`(?:^|[\s,.;:!?()'"])`;
const E = String.raw`(?=[\s,.;:!?()'"]|$)`;
const words = (...w: string[]) => `(?:${w.join('|')})`;

const EN_HOURS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const EN_MINUTES: Record<string, string> = { fifteen: '15', thirty: '30', 'forty five': '45', 'forty-five': '45', 'o five': '05', 'oh five': '05' };
const EN_HOUR_ALT = Object.keys(EN_HOURS).join('|');
const BN_HOURS: [string, number][] = [
  ['এক', 1], ['দুই', 2], ['দু', 2], ['তিন', 3], ['চার', 4], ['পাঁচ', 5], ['ছয়', 6], ['ছ', 6], ['সাত', 7], ['আট', 8], ['নয়', 9], ['ন', 9], ['দশ', 10], ['এগারো', 11], ['বারো', 12],
];
const BL_HOURS: [string, number][] = [
  ['ek', 1], ['dui', 2], ['du', 2], ['tin', 3], ['char', 4], ['pach', 5], ['panch', 5], ['choy', 6], ['soy', 6], ['sat', 7], ['saat', 7], ['at', 8], ['aat', 8], ['noy', 9], ['dosh', 10], ['egaro', 11], ['baro', 12],
];

/** Lower case, NFC, straight quotes, ASCII digits, single spaces; slang and spoken numbers as figures. */
export function normalizeWhen(text: string): string {
  let t = nfc(text)
    .toLowerCase()
    .replace(/[’‘ʼ`]/g, "'")
    .replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)))
    .replace(/\s+/g, ' ')
    .trim();
  t = t
    .replace(/\b(2moro|2morrow|2mrw|2mro|tomoro|tomorow|tmrw|tmrrw)\b/g, 'tomorrow')
    .replace(/\b(tonite|2nite|tonyt)\b/g, 'tonight')
    .replace(/\bthis eve\b/g, 'this evening');
  // "at seven thirty pm", "seven pm", "at eleven" → figures
  t = t.replace(
    new RegExp(`\\b(at|by|around|before)\\s+(${EN_HOUR_ALT})(?:\\s+(fifteen|thirty|forty[ -]five|o five|oh five))?\\b`, 'g'),
    (_m, pre: string, h: string, mins?: string) => `${pre} ${EN_HOURS[h]}${mins ? ':' + EN_MINUTES[mins.replace('-', ' ')] : ''}`,
  );
  t = t.replace(
    new RegExp(`\\b(${EN_HOUR_ALT})(?:\\s+(fifteen|thirty|forty[ -]five))?\\s*(am|pm|a\\.m\\.?|p\\.m\\.?|o'clock)`, 'g'),
    (_m, h: string, mins: string | undefined, suffix: string) => `${EN_HOURS[h]}${mins ? ':' + EN_MINUTES[mins.replace('-', ' ')] : ''} ${suffix}`,
  );
  // "সাতটায়", "দুটোয়", "আটটা" → "7টায়"; "sat tay", "dui ta" → "7 tay"
  for (const [w, n] of BN_HOURS) t = t.replace(new RegExp(`(^|[\\s,.;:!?()'"])(সাড়ে|পৌনে|সোয়া)?\\s*${w}\\s*(টায়|টার|টা|টোয়|টো|টে)(?=[\\s,.;:!?()'"]|$)`, 'g'), (_m, pre: string, frac = '') => `${pre}${frac ? frac + ' ' : ''}${n}টায়`);
  for (const [w, n] of BL_HOURS) t = t.replace(new RegExp(`(^|\\s)(sare|poune|shoa)?\\s*${w}\\s*(tay|tar|ta|baje)(?=\\s|$|[,.;:!?])`, 'g'), (_m, pre: string, frac = '') => `${pre}${frac ? frac + ' ' : ''}${n} tay`);
  return t;
}

// ─── Vocabulary ─────────────────────────────────────────────────

type Part = 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';

const PART_WORDS: Record<Part, string[]> = {
  morning: ['morning', 'সকাল', 'সকালে', 'ভোর', 'ভোরে', 'sokal', 'sokale', 'shokal', 'shokale', 'bhor', 'bhore', 'vor', 'vore'],
  noon: ['noon', 'midday', 'দুপুর', 'দুপুরে', 'dupur', 'dupure', 'dupore'],
  afternoon: ['afternoon', 'বিকাল', 'বিকেল', 'বিকালে', 'বিকেলে', 'bikal', 'bikel', 'bikale', 'bikele'],
  evening: ['evening', 'সন্ধ্যা', 'সন্ধ্যায়', 'সন্ধ্যাবেলা', 'sondha', 'sondhay', 'shondha', 'shondhay', 'sondhya', 'sondhyay'],
  night: ['night', 'tonight', 'রাত', 'রাতে', 'rat', 'raat', 'raate'],
};
/** Default time for a part of the day, and when it's over. */
const PART_HOURS: Record<Part, [number, number]> = {
  morning: [9, 12],
  noon: [13, 15],
  afternoon: [15, 17],
  evening: [18, 21],
  night: [21, 24],
};

const WEEKDAYS: string[][] = [
  ['sunday', 'রবিবার', 'রোববার', 'robibar', 'robbar', 'rabibar'],
  ['monday', 'mon', 'সোমবার', 'shombar', 'sombar', 'somobar'],
  ['tuesday', 'tue', 'tues', 'মঙ্গলবার', 'mongolbar', 'mangalbar'],
  ['wednesday', 'wed', 'বুধবার', 'budhbar', 'budbar', 'budhobar'],
  ['thursday', 'thu', 'thur', 'thurs', 'বৃহস্পতিবার', 'brihospotibar', 'brihaspatibar', 'bishudbar', 'bishyudbar'],
  ['friday', 'fri', 'শুক্রবার', 'shukrobar', 'sukrobar', 'jummabar'],
  ['saturday', 'শনিবার', 'shonibar', 'sonibar', 'shanibar'],
].map((names) => names.map(nfc));

const MONTHS: string[][] = [
  ['jan', 'january', 'জানুয়ারি', 'জানুয়ারী'],
  ['feb', 'february', 'ফেব্রুয়ারি', 'ফেব্রুয়ারী'],
  ['mar', 'march', 'মার্চ'],
  ['apr', 'april', 'এপ্রিল'],
  ['may', 'মে'],
  ['jun', 'june', 'জুন'],
  ['jul', 'july', 'জুলাই'],
  ['aug', 'august', 'আগস্ট', 'আগষ্ট'],
  ['sep', 'sept', 'september', 'সেপ্টেম্বর'],
  ['oct', 'october', 'অক্টোবর'],
  ['nov', 'november', 'নভেম্বর'],
  ['dec', 'december', 'ডিসেম্বর'],
].map((names) => names.map(nfc));

const WEEKDAY_ALT = words(...WEEKDAYS.flat().sort((a, b) => b.length - a.length));
/** A weekday with the Bangla "-e" ending ("shukrobare"); never "mon"+"e", which is "mone". */
const WEEKDAY_E = `(?:${words(...WEEKDAYS.flat().filter((w) => w.length > 4).sort((a, b) => b.length - a.length))}e?|${words(...WEEKDAYS.flat().filter((w) => w.length <= 4))})`;
export const MONTH_WORDS = new Set(MONTHS.flat());
const MONTH_ALT = words(...MONTHS.flat().sort((a, b) => b.length - a.length));
const PART_ALT = words(...Object.values(PART_WORDS).flat().sort((a, b) => b.length - a.length));

const TODAY = words('today', 'tonight', 'আজ', 'আজকে', 'আজই', 'aj', 'ajke', 'aaj', 'ajkei', 'ajk');
const TOMORROW = words('tomorrow', 'tmrw', 'tmr', 'tomorow', 'tommorow', 'tommorrow', 'আগামীকাল', 'কাল', 'কালকে', 'kal', 'kalke', 'kaal', 'agamikal', 'agamikaal');
const DAY_AFTER = words('day after tomorrow', 'পরশু', 'porshu', 'poroshu', 'porsu', 'porshudin');
const HOUR_WORD = words('টায়', 'টার', 'টা', 'tay', 'tar', 'ta', 'baje', 'বাজে', "o'clock", 'oclock');
/** After a bare number, these mean it isn't a time ("at 7 km", "by 5 people"). */
const NOT_TIME_AFTER = /^(km|kms|kg|kgs|mi|miles?|min|mins|minutes?|h|hrs?|hours?|days?|weeks?|months?|years?|tk|taka|৳|\$|%|percent|people|persons?|pages?|pcs|pieces?|items?|times?|x|th|st|nd|rd|ghonta|minit|din)$/;

const pad = (s: string) => ` ${s} `;

// ─── Relative: "in 20 mins" ─────────────────────────────────────

const COUNT: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty five': 45, 'half an': 0.5, half: 0.5,
};
const AMOUNT = String.raw`(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|ten|fifteen|twenty|thirty|forty five|forty|half an|half)`;
const MIN_UNIT = words('min', 'mins', 'minute', 'minutes', 'মিনিট', 'minit', 'm');
const HOUR_UNIT = words('h', 'hr', 'hrs', 'hour', 'hours', 'ঘণ্টা', 'ঘন্টা', 'ghonta', 'ghunta');
const DAY_UNIT = words('day', 'days', 'দিন', 'din', 'week', 'weeks', 'সপ্তাহ', 'shoptah', 'saptah');

function unitMinutes(unit: string): number {
  if (new RegExp(`^${HOUR_UNIT}$`).test(unit)) return 60;
  if (/^(week|weeks|সপ্তাহ|shoptah|saptah)$/.test(unit)) return 7 * 24 * 60;
  if (new RegExp(`^${DAY_UNIT}$`).test(unit)) return 24 * 60;
  return 1;
}

/** Minutes from now: "in 20 mins", "in an hour and a half", "1 ghonta pore", "in 2 days". */
function fromNow(t: string): { minutes: number; days: boolean } | undefined {
  const count = (n: string) => COUNT[n] ?? Number(n);
  const en = t.match(
    new RegExp(String.raw`${S}(?:in|after|within)\s+${AMOUNT}\s*(${MIN_UNIT}|${HOUR_UNIT}|${DAY_UNIT})(?:\s+and\s+(a half|\d+\s*${MIN_UNIT}))?${E}`),
  );
  const bn = t.match(
    new RegExp(String.raw`${S}${AMOUNT}\s*(${MIN_UNIT}|${HOUR_UNIT}|${DAY_UNIT})\s*(?:পর|পরে|বাদে|por|pore|bade|baad|later|from now)${E}`),
  );
  const m = en ?? bn;
  if (!m) return undefined;
  const n = count(m[1]);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const per = unitMinutes(m[2]);
  let minutes = n * per;
  const extra = en?.[3];
  if (extra === 'a half') minutes += per / 2;
  else if (extra) minutes += Number(extra.match(/\d+/)![0]);
  if (minutes > 366 * 24 * 60) return undefined;
  return { minutes, days: per >= 24 * 60 };
}

// ─── Repeats ────────────────────────────────────────────────────

function readRepeat(t: string): Repeat | undefined {
  const p = pad(t);
  if (/ (every ?day|everyday|daily|each day|every (morning|evening|night)|প্রতিদিন|রোজ|protidin|prottek din|roj) /.test(p)) return 'daily';
  if (new RegExp(`(every|each|প্রতি|proti) ${WEEKDAY_ALT}${E}`).test(t) || / (every week|weekly|each week|প্রতি সপ্তাহে?|proti shoptahe?) /.test(p)) return 'weekly';
  if (/ (every month|monthly|each month|প্রতি মাসে?|proti mashe?) /.test(p)) return 'monthly';
  return undefined;
}

// ─── Clock time ─────────────────────────────────────────────────

interface Clock {
  hour: number;
  minute: number;
  /** am/pm said, or a 24-hour time: no guessing needed. */
  exact: boolean;
}

function readPart(t: string): Part | undefined {
  const m = t.match(new RegExp(`${S}${PART_ALT}${E}`));
  if (!m) return undefined;
  const w = m[0].replace(/^[\s,.;:!?()'"]+/, '');
  return (Object.keys(PART_WORDS) as Part[]).find((p) => PART_WORDS[p].includes(w));
}

function readClock(t: string): Clock | undefined {
  // "half past 7", "quarter past 7", "quarter to 8"
  const past = t.match(/\b(half|quarter) past (\d{1,2})\b/);
  if (past) return { hour: Number(past[2]), minute: past[1] === 'half' ? 30 : 15, exact: false };
  const to = t.match(/\bquarter to (\d{1,2})\b/);
  if (to) return { hour: (Number(to[1]) + 11) % 12 || 12, minute: 45, exact: false };
  // "সাড়ে ৭টায়", "poune 8 ta", "সোয়া ৯টা"; "দেড়টা" (1:30), "আড়াইটা" (2:30)
  const frac = t.match(new RegExp(String.raw`${S}(সাড়ে|sare|share|sarhe|পৌনে|poune|pone|সোয়া|soa|shoa|sowa)\s*(\d{1,2})\s*${HOUR_WORD}?`));
  if (frac) {
    const h = Number(frac[2]);
    if (/^(সাড়ে|sare|share|sarhe)$/.test(frac[1])) return { hour: h, minute: 30, exact: false };
    if (/^(পৌনে|poune|pone)$/.test(frac[1])) return { hour: (h + 11) % 12 || 12, minute: 45, exact: false };
    return { hour: h, minute: 15, exact: false };
  }
  const half = t.match(new RegExp(String.raw`${S}(দেড়|der|derh|আড়াই|arai|adai)\s*${HOUR_WORD}${E}`));
  if (half) return /^(দেড়|der|derh)$/.test(half[1]) ? { hour: 1, minute: 30, exact: false } : { hour: 2, minute: 30, exact: false };
  // "3-5pm", "between 3 and 5 pm", "10 to 11am": the start, with the end's am/pm
  const range = t.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(?:-|–|to|and)\s*(\d{1,2})(?:[:.]\d{2})?\s*(am|pm|a\.m\.?|p\.m\.?)(?![a-z])/);
  if (range) {
    const start = Number(range[1]) % 12;
    const end = Number(range[3]) % 12;
    const pm = /^p/.test(range[4]) && !(start > end && end < 12 && Number(range[1]) !== 12);
    return { hour: pm ? start + 12 : start, minute: Number(range[2] ?? 0), exact: true };
  }
  // "7:30 pm", "7.30pm", "7 pm", "7 a.m."
  const ampm = t.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.?|p\.m\.?)(?![a-z])/);
  if (ampm) {
    const h = Number(ampm[1]) % 12;
    if (h > 12 || Number(ampm[2] ?? 0) > 59) return undefined;
    return { hour: /^p/.test(ampm[3]) ? h + 12 : h, minute: Number(ampm[2] ?? 0), exact: true };
  }
  // "৯টা ৩০", "9 ta 30", "৯টা ৩০ মিনিটে"
  const bnMin = t.match(new RegExp(String.raw`${S}(\d{1,2})\s*${HOUR_WORD}\s+(\d{1,2})(?:\s*(?:মিনিটে|মিনিট|minite|minit|min|e|এ))?${E}`));
  if (bnMin && Number(bnMin[2]) < 60) return { hour: Number(bnMin[1]), minute: Number(bnMin[2]), exact: false };
  // "19:30", "7:30"
  const colon = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (colon) return { hour: Number(colon[1]), minute: Number(colon[2]), exact: Number(colon[1]) > 12 || colon[1].startsWith('0') };
  // "৮টায়", "8 tay", "5 baje", "7 o'clock"
  const word = t.match(new RegExp(String.raw`${S}(\d{1,2})\s*${HOUR_WORD}${E}`));
  if (word) return { hour: Number(word[1]), minute: 0, exact: false };
  // "at 7", "at 7.30", "by 5", "@ 6"
  const bare = t.match(/(?:^|\s)(?:at|by|around|@|before)\s*(\d{1,2})(?:[.:](\d{2}))?(?=\s|$|[,.;!?])(\s+\S+)?/);
  if (bare && !NOT_TIME_AFTER.test((bare[3] ?? '').trim())) {
    const h = Number(bare[1]);
    if (h <= 23 && Number(bare[2] ?? 0) < 60) return { hour: h, minute: Number(bare[2] ?? 0), exact: h > 12 || h === 0 };
  }
  if (/\bnoon\b|\bmidday\b/.test(t)) return { hour: 12, minute: 0, exact: true };
  if (/\bmidnight\b|মধ্যরাত|majhrat|majh rat/.test(t)) return { hour: 0, minute: 0, exact: true };
  return undefined;
}

/** The 24-hour hour for a clock reading, given the part of day said. */
function hourWithPart(c: Clock, part: Part | undefined): { hour: number; nextDay: boolean } | undefined {
  let h = c.hour;
  if (c.exact) return { hour: h % 24, nextDay: false };
  if (h > 23) return undefined;
  if (h > 12) return { hour: h, nextDay: false };
  switch (part) {
    case 'morning':
      return { hour: h % 12, nextDay: false };
    case 'noon':
      return { hour: h === 12 ? 12 : h < 6 ? h + 12 : h, nextDay: false };
    case 'afternoon':
    case 'evening':
      return { hour: h === 12 ? 12 : h + 12, nextDay: false };
    case 'night':
      if (h === 12) return { hour: 0, nextDay: true };
      if (h < 5) return { hour: h, nextDay: true }; // "রাত ২টায়": after midnight
      return { hour: h + 12, nextDay: false };
    default:
      h = h === 12 ? 12 : h;
      return { hour: h, nextDay: false };
  }
}

// ─── Day ────────────────────────────────────────────────────────

function startOfDay(ts: number): Date {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d;
}
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const at = (d: Date, hour: number, minute: number) => {
  const x = new Date(d);
  x.setHours(hour, minute, 0, 0);
  return x.getTime();
};

const weekdayIndex = (w: string) => WEEKDAYS.findIndex((names) => names.includes(w));
const monthIndex = (w: string) => MONTHS.findIndex((names) => names.includes(w));
const ordinal = String.raw`(\d{1,2})(?:st|nd|rd|th|তারিখে|তারিখ|tarikh|tarikhe)?`;

interface Day {
  date: Date;
  /** Named exactly ("tomorrow", "Oct 20"), so a passed time doesn't roll over. */
  fixed: boolean;
  today?: boolean;
}

function readDay(t: string, now: number, monthFirst: boolean): Day | undefined {
  const today = startOfDay(now);
  const p = pad(t);
  if (new RegExp(`${S}${DAY_AFTER}${E}`).test(t)) return { date: addDays(today, 2), fixed: true };
  if (new RegExp(`${S}${TOMORROW}${E}`).test(t)) return { date: addDays(today, 1), fixed: true };
  if (new RegExp(`${S}${TODAY}${E}`).test(t) || / this (morning|afternoon|evening) /.test(p)) return { date: today, fixed: true, today: true };

  const inDays = fromNow(t);
  if (inDays?.days) return { date: addDays(today, Math.round(inDays.minutes / (24 * 60))), fixed: true };
  if (/ (next week|আগামী সপ্তাহে?|agami shoptahe?|porer shoptahe?) /.test(p)) return { date: addDays(today, 7), fixed: true };
  if (/ (next month|আগামী মাসে?|agami mashe?|porer mashe?) /.test(p)) {
    const d = new Date(today);
    d.setMonth(d.getMonth() + 1);
    return { date: d, fixed: true };
  }
  if (/ (end of (the )?month|month end|মাসের শেষে?|masher sheshe?|mash sheshe) /.test(p)) {
    const d = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { date: d, fixed: true };
  }
  if (/ (this weekend|weekend|on the weekend|সপ্তাহান্তে) /.test(p)) {
    const ahead = (6 - today.getDay() + 7) % 7;
    return { date: addDays(today, ahead), fixed: true };
  }

  // A date: "25 october", "oct 30", "1st of november", "৫ নভেম্বর"
  const dm = t.match(new RegExp(`${S}${ordinal}(?: of)?\\s*${MONTH_ALT}${E}`));
  const md = t.match(new RegExp(`${S}${MONTH_ALT}\\s*${ordinal}${E}`));
  const named = dm ? { d: Number(dm[1]), m: monthIndex(dm[0].trim().split(/\s+/).at(-1)!.replace(/[,.;:!?()'"]/g, '')) } : md ? { d: Number(md[1]), m: monthIndex(md[0].replace(/^[\s,.;:!?()'"]+/, '').split(/\s+/)[0]) } : undefined;
  if (named && named.m >= 0 && named.d >= 1 && named.d <= 31) {
    let d = new Date(today.getFullYear(), named.m, named.d);
    if (d < today) d = new Date(today.getFullYear() + 1, named.m, named.d);
    return { date: d, fixed: true };
  }
  // "2026-10-20"
  const iso = t.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (!Number.isNaN(d.getTime()) && d >= today) return { date: d, fixed: true };
  }
  // "5/11", "5/11/2026", "15.10.2026" (dots only with a year: "7.30" is a time)
  const slash = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/) ?? t.match(/\b(\d{1,2})[.-](\d{1,2})[.-](\d{2,4})\b/);
  if (slash) {
    let [a, b] = [Number(slash[1]), Number(slash[2])];
    if (monthFirst && a <= 12) [a, b] = [b, a];
    else if (b > 12 && a <= 12) [a, b] = [b, a];
    if (b >= 1 && b <= 12 && a >= 1 && a <= 31) {
      const year = slash[3] ? Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]) : today.getFullYear();
      let d = new Date(year, b - 1, a);
      if (!slash[3] && d < today) d = new Date(year + 1, b - 1, a);
      return { date: d, fixed: true };
    }
  }
  // "on the 20th", "20 tarikh": this month if still ahead, else next
  const dom = t.match(/\bon the (\d{1,2})(?:st|nd|rd|th)\b/) ?? t.match(new RegExp(`${S}(\\d{1,2})\\s*(?:তারিখে|তারিখ|tarikhe|tarikh)${E}`)) ?? t.match(/\bon the (\d{1,2})(?:st|nd|rd|th)?\b/);
  if (dom) {
    const n = Number(dom[1]);
    if (n >= 1 && n <= 31) {
      let d = new Date(today.getFullYear(), today.getMonth(), n);
      if (d < today) d = new Date(today.getFullYear(), today.getMonth() + 1, n);
      return { date: d, fixed: true };
    }
  }
  // A weekday: the next one ("friday" on a Friday is next week's, unless "today")
  const wd = t.match(new RegExp(`${S}${WEEKDAY_E}${E}`));
  if (wd) {
    const w = wd[0].replace(/^[\s,.;:!?()'"]+/, '');
    const idx = weekdayIndex(w) >= 0 ? weekdayIndex(w) : weekdayIndex(w.replace(/e$/, ''));
    if (idx >= 0) {
      // Said on that very day ("on wed", on a Wednesday): next week's.
      const ahead = (idx - today.getDay() + 7) % 7 || 7;
      return { date: addDays(today, ahead), fixed: true };
    }
  }
  return undefined;
}

// ─── Putting it together ────────────────────────────────────────

/**
 * When a sentence means, as a time still ahead of `now`, or nothing. A time
 * with no day is the next one ("at 7" at 7:30 pm is 7 tomorrow morning); a
 * day with no time is 9:00, or that part of the day ("tomorrow evening").
 */
export function readWhenFull(sentence: string, now = Date.now(), monthFirst = false): When | undefined {
  const t = normalizeWhen(sentence);
  const repeat = readRepeat(t);

  const later = fromNow(t);
  if (later && !later.days) return { at: Math.round((now + later.minutes * MINUTE) / MINUTE) * MINUTE, repeat };

  const day = readDay(t, now, monthFirst);
  const clock = readClock(t);
  const part = readPart(t);
  const today = startOfDay(now);

  if (!day && !clock && !part && !repeat) return undefined;
  // A part of the day alone ("morning walk") isn't a when; with "tonight" it is.
  if (!day && !clock && !repeat && !/(^|\s)(tonight|this (morning|afternoon|evening))(\s|$)/.test(t)) return undefined;

  const base = day?.date ?? today;
  if (clock) {
    const h = hourWithPart(clock, part);
    if (!h) return undefined;
    const ambiguous = !clock.exact && !part && clock.hour >= 1 && clock.hour <= 11;
    const options = ambiguous
      ? clock.hour <= 6
        ? [clock.hour + 12] // "at 5": business hours, so 5 pm
        : (day && !day.today) || repeat
          ? [clock.hour] // "tomorrow at 8", "every day at 8": the morning
          : [clock.hour, clock.hour + 12] // "at 8": whichever comes next
      : [h.hour];
    const dayFor = h.nextDay ? addDays(base, 1) : base;
    for (const hour of options) {
      const ts = at(dayFor, hour, clock.minute);
      if (ts > now) return { at: ts, repeat };
    }
    // Passed today. A named day stays put (and is gone); otherwise the next one.
    if (day?.fixed && !day.today) return undefined;
    if (day?.today && !repeat) return undefined;
    const step = repeat === 'weekly' ? 7 : 1;
    return { at: at(addDays(dayFor, step), options[0], clock.minute), repeat };
  }

  // No clock: the part of the day, or 9:00.
  const [start, end] = part ? PART_HOURS[part] : [9, 12];
  const ts = at(base, start, 0);
  if (ts > now) return { at: ts, repeat };
  if (base.getTime() === today.getTime()) {
    // Today, and that part has started: soon, while it lasts.
    if (part && now < at(base, end, 0) - 30 * MINUTE) {
      return { at: Math.ceil((now + MINUTE) / (30 * MINUTE)) * 30 * MINUTE, repeat };
    }
    if (!day?.fixed || repeat) {
      return { at: at(addDays(base, repeat === 'weekly' ? 7 : 1), start, 0), repeat };
    }
    // "today" with no time: the evening, or late on, the next hour
    if (!part) {
      const evening = at(base, 18, 0);
      if (evening > now) return { at: evening, repeat };
      const nextHour = Math.ceil((now + MINUTE) / (60 * MINUTE)) * 60 * MINUTE;
      return nextHour < at(base, 23, 0) ? { at: nextHour, repeat } : undefined;
    }
  }
  return undefined;
}

// ─── Is it a plan? ──────────────────────────────────────────────

const PAST =
  /\b(was|were|did|had|yesterday|ago|last (night|week|month|year|time)|earlier today|already|used to)\b|(^|\s)(গতকাল|গত|ছিল|ছিলো|করেছি|করলাম|গিয়েছিলাম|গেলাম|এসেছিল|gotokal|goto|chilo|chhilo|korechi|korlam|gechilam|gelam|esechilo)(\s|$)/;
const PAST_VERBS = new Set(
  'done met woke landed came went called watched ate drank bought paid got reached arrived finished left saw talked spoke slept took gave sent made told heard found lost won ran walked drove flew started ended visited cooked cleaned fixed played read wrote said felt thought tried spent sold opened closed booked'.split(' '),
);
const IMPERATIVE = new Set(
  'call ring text email mail message whatsapp pick pay send buy get take meet go visit submit book finish bring collect check clean wake cook fix renew return drop leave start join attend charge water feed print sign order cancel reply apply prepare study wash iron pack catch board drink eat sleep ask tell remind remember review practice practise post upload download install update backup back'.split(' '),
);
/** Facts, not plans: "the shop opens at 10". */
const FACT_VERBS = /\b(opens|closes|starts|ends|is|are|runs|leaves|arrives|departs)\b/;

/**
 * Whether a sentence is something to do or attend, rather than something
 * that happened or a fact. "met Rumi at 3pm" isn't; "call Rumi at 3pm",
 * "gym at 6am" and "dentist on friday at 4pm" are.
 */
export function isPlan(sentence: string, intent: boolean): boolean {
  const t = normalizeWhen(sentence).replace(/^[-*•]\s+/, '');
  if (PAST.test(t) || /(^|\s)\S+(লাম|েছি|েছিলাম)(\s|$)|(^|\s)[a-z]+(lam|echi|echilam)(\s|$)/.test(t)) return false;
  if (intent) return true;
  const ws = t.split(/[\s,.;:!?()'"]+/).filter(Boolean);
  // A day that can only be ahead makes it a plan whatever the verb ("booked a table for tomorrow 8pm").
  const aheadDay = new RegExp(`${S}(?:${TOMORROW}|${DAY_AFTER}|tonight|next (week|month|${WEEKDAY_ALT}))${E}`).test(t) || /\b(every|daily|weekly|monthly)\b|প্রতিদিন|রোজ|protidin/.test(t);
  if (aheadDay) return true;
  // Moved to a new time: still ahead ("meeting rescheduled to 3pm friday").
  if (/\b(rescheduled|moved|postponed|shifted|pushed|changed)\s+to\b/.test(t)) return true;
  if (IMPERATIVE.has(ws[0] ?? '') || (/^(please|pls|plz|kindly)$/.test(ws[0] ?? '') && IMPERATIVE.has(ws[1] ?? ''))) return true;
  const pastVerb = ws.some((w) => PAST_VERBS.has(w) || (/^[a-z]{3,}ed$/.test(w) && !/^(need|bed|red|feed|speed|seed|shed|wed)$/.test(w)));
  if (pastVerb) return false;
  // "in 20 mins", "2 din pore": ahead, unless it was how long something took ("he came in 20 minutes").
  if (fromNow(t) !== undefined) return true;
  // The when up front: "on wed submit report", "dec 25 visit nani", "fri 5pm meeting", "কাল সকাল ৮টায় মিটিং"
  if (new RegExp(`^(?:on |by |next |this |before |between |from |সাড়ে |পৌনে |সোয়া |sare |poune |shoa )?(?:\\d|(?:${TOMORROW}|${DAY_AFTER}|${TODAY}|${WEEKDAY_E}|${MONTH_ALT}|${PART_ALT})(?:[\\s,.:]|$))`).test(t) && !FACT_VERBS.test(t)) return true;
  // "gym at 6am", "dentist on friday at 4pm", "I have a meeting at 4pm": a short name, then the when.
  const named = t.replace(/^(?:i|we|you)\s+(?:have|got|'ve got)\s+(?:a |an |the |my |our )?|^(?:there's|there is)\s+(?:a |an )?/, '');
  const lead = named.split(/\s(?:at|on|by|@|around|this|next|tomorrow|today)\s/)[0];
  return lead !== named && lead.split(' ').length <= 3 && !FACT_VERBS.test(lead);
}

// ─── Taking the when out of a title ─────────────────────────────

const D = '[0-9০-৯]';
const UNIT_AFTER = String.raw`(?!\s*(?:km|kms|kg|kgs|mi|miles?|min|mins|minutes?|hrs?|hours?|days?|weeks?|tk|taka|৳|%|people|persons?|pages?|pcs|pieces?|items?|times?|steps?)\b)`;

const SLANG_DAY = String.raw`(?:2moro|2morrow|2mrw|2mro|tomoro|tomorow|tmrrw|tonite|2nite|tonyt|this eve)`;
const BN_HOUR_WORDS = '(?:এক|দুই|দু|তিন|চার|পাঁচ|ছয়|ছ|সাত|আট|নয়|ন|দশ|এগারো|বারো)';
const BL_HOUR_WORDS = '(?:ek|dui|du|tin|char|pach|panch|choy|soy|sat|saat|at|aat|noy|dosh|egaro|baro)';

export const STRIP: RegExp[] = [
  new RegExp(String.raw`${S}${SLANG_DAY}${E}`, 'gi'),
  new RegExp(String.raw`${S}(?:at|by|around|before)\s+(?:${EN_HOUR_ALT})(?:\s+(?:fifteen|thirty|forty[ -]five|o five|oh five))?(?:\s*(?:am|pm|a\.m\.?|p\.m\.?|o'clock))?${E}`, 'gi'),
  new RegExp(String.raw`${S}(?:${EN_HOUR_ALT})(?:\s+(?:fifteen|thirty|forty[ -]five))?\s*(?:am|pm|a\.m\.?|p\.m\.?|o'clock)${E}`, 'gi'),
  new RegExp(String.raw`${S}(?:${PART_ALT}\s*)?(?:সাড়ে|পৌনে|সোয়া)?\s*${BN_HOUR_WORDS}\s*(?:টায়|টার|টা|টোয়|টো|টে)${E}`, 'gi'),
  new RegExp(String.raw`${S}(?:${PART_ALT}\s*)?(?:sare|poune|shoa)?\s*${BL_HOUR_WORDS}\s*(?:tay|tar|ta|baje)${E}`, 'gi'),
  new RegExp(String.raw`${S}(?:between\s+)?\d{1,2}(?:[:.]\d{2})?\s*(?:-|–|to|and)\s*\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm|a\.m\.?|p\.m\.?)${E}`, 'gi'),
  new RegExp(String.raw`${S}(?:on\s+|by\s+)?\d{4}-\d{1,2}-\d{1,2}${E}`, 'gi'),
  new RegExp(String.raw`${S}(?:a|an|one|two|three)\s+(?:${MIN_UNIT}|${HOUR_UNIT}|${DAY_UNIT})\s+later${E}`, 'gi'),
  // in 20 mins / 20 min pore / every day / daily
  new RegExp(String.raw`${S}(?:in|after|within)\s+(?:${D}+(?:\.${D}+)?|a|an|one|two|three|four|five|six|ten|fifteen|twenty|thirty|forty five|forty|half an|half)\s*(?:${MIN_UNIT}|${HOUR_UNIT}|${DAY_UNIT})(?:\s+and\s+(?:a half|${D}+\s*${MIN_UNIT}))?${E}`, 'gi'),
  new RegExp(String.raw`${S}${D}+(?:\.${D}+)?\s*(?:${MIN_UNIT}|${HOUR_UNIT}|${DAY_UNIT})\s*(?:পর|পরে|বাদে|por|pore|bade|baad|later|from now)${E}`, 'gi'),
  new RegExp(String.raw`${S}(?:every|each|প্রতি|proti)\s+(?:day|week|month|morning|evening|night|${WEEKDAY_ALT}|সপ্তাহে?|মাসে?|shoptahe?|mashe?)${E}`, 'gi'),
  new RegExp(String.raw`${S}(?:everyday|daily|weekly|monthly|প্রতিদিন|রোজ|protidin|roj)${E}`, 'gi'),
  // days and dates
  new RegExp(String.raw`${S}(?:on\s+|by\s+|this\s+|next\s+|আগামী\s+|agami\s+)?(?:the\s+)?(?:${DAY_AFTER}|${TOMORROW}|${TODAY}|${WEEKDAY_E}|next week|next month|this weekend|weekend|end of (?:the )?month)(?:\s+(?:morning|afternoon|evening|night))?${E}`, 'gi'),
  new RegExp(String.raw`${S}(?:on\s+|by\s+)?(?:the\s+)?${D}{1,2}(?:st|nd|rd|th)?(?:\s+of)?\s+${MONTH_ALT}${E}`, 'gi'),
  new RegExp(String.raw`${S}(?:on\s+|by\s+)?${MONTH_ALT}\s+${D}{1,2}(?:st|nd|rd|th)?${E}`, 'gi'),
  new RegExp(String.raw`${S}(?:on\s+|by\s+)?the\s+${D}{1,2}(?:st|nd|rd|th)${E}`, 'gi'),
  new RegExp(String.raw`${S}${D}{1,2}\s*(?:তারিখে|তারিখ|tarikhe|tarikh)${E}`, 'gi'),
  new RegExp(String.raw`${S}(?:on\s+|by\s+)?${D}{1,2}/${D}{1,2}(?:/${D}{2,4})?${E}`, 'gi'),
  // clock times
  new RegExp(String.raw`${S}(?:at\s+|by\s+|around\s+)?(?:half|quarter)\s+(?:past|to)\s+${D}{1,2}${E}`, 'gi'),
  new RegExp(String.raw`${S}(?:at\s+|by\s+|around\s+|before\s+|@\s*)?${D}{1,2}(?:[:.]${D}{2})?\s*(?:am|pm|a\.m\.?|p\.m\.?)(?:\s+sharp)?${E}`, 'gi'),
  new RegExp(String.raw`${S}(?:at|by|around|before|@)\s*${D}{1,2}(?:[:.]${D}{2})?(?:\s+sharp)?${UNIT_AFTER}(?=[\s,.;:!?)]|$)`, 'gi'),
  new RegExp(String.raw`${S}${D}{1,2}:${D}{2}${E}`, 'gi'),
  new RegExp(String.raw`${S}(?:${PART_ALT}\s*)?(?:সাড়ে|sare|share|sarhe|পৌনে|poune|pone|সোয়া|soa|shoa|sowa|দেড়|der|আড়াই|arai)?\s*${D}{0,2}\s*(?:টায়|টার|টা|tay|tar|baje|বাজে)(?:\s+${D}{1,2}(?:\s*(?:মিনিটে|মিনিট|minite|minit|min|e|এ))?)?${E}`, 'gi'),
  new RegExp(String.raw`${S}(?:${PART_ALT}\s+)?${D}{1,2}\s+ta${E}`, 'gi'),
  new RegExp(String.raw`${S}(?:at\s+)?(?:noon|midnight|midday|মধ্যরাতে?)${E}`, 'gi'),
  // parts of the day, when they go with a time
  new RegExp(String.raw`${S}(?:in the (?:morning|afternoon|evening)|at night|tonight|this (?:morning|afternoon|evening))${E}`, 'gi'),
  new RegExp(String.raw`${S}(?:morning|afternoon|evening|night)(?=\s+(?:at|by)\s|\s*[,.;!?]|\s*$)`, 'gi'),
  new RegExp(String.raw`${S}(?:সকালে?|দুপুরে?|বিকালে?|বিকেলে?|সন্ধ্যায়?|রাতে?|sokale?|dupure?|bikale?|bikele?|sondhay?)${E}`, 'gi'),
];

/** The text without its when ("Call amma at 7:30pm tomorrow" → "Call amma"). Never empty. */
export function withoutWhen(text: string): string {
  let out = ` ${text} `;
  // Twice: taking "tomorrow" out of "at 6 tomorrow morning" leaves "at 6 morning".
  for (let pass = 0; pass < 2; pass++) {
    for (const re of STRIP) out = out.replace(re, (m) => (/^[\s,.;:!?()'"]/.test(m) ? m[0] : ' '));
  }
  out = out
    .replace(/\s+([,;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/(?:\s+(?:at|on|by|in|for|around|before|sharp|to|from|is|are|এ|e))+\s*$/i, '')
    // …and what "aj ke", "shukrobar er moddhe" leave once the day is out.
    .replace(/^\s*(?:at|on|by|in|এ|e|ke|er(?:\s+moddhe)?|এর(?:\s+মধ্যে)?)\s+/i, '')
    .trim();
  return out.length > 0 && /[^\s,.;:!?()'"-]/.test(out) ? out : text.trim();
}
