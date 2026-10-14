import { numberTokens, scanNumbers, metricKey, type NumberSpan } from '@/lib/measures';
import type { Category, ChecklistItem, Measure, Rollup } from '@/types/mnemo';
import { capitalize, hostOf, nfc } from '@/utils/text';

// Reading a note on the phone, with no AI: a title, lists, links, the
// numbers worth adding up, the next step and when it's due, a category
// and #tags. Works on English, Bangla and Banglish (Bangla typed in Latin
// letters), and on spoken text as well as typed. When Gemini is on it does
// this better; this is what offline gets, and it's what every note shows
// the instant it's saved.

export interface Reading {
  /** The note's text, minus any list lines lifted into `checklist`. */
  text: string;
  title: string;
  checklist: ChecklistItem[];
  links: string[];
  measures: Measure[];
  nextStep?: string;
  leftOff?: string;
  /** When the next step is due, if a day was named ("tomorrow", "শুক্রবার"). */
  due?: number;
  category?: Category;
  tags: string[];
}

/** What a thread already tracks, so "spent" stays "spent". */
export interface KnownMetric {
  metric: string;
  unit?: string;
}

const TITLE_MAX = 48;
const STEP_MAX = 120;

let idCounter = 0;
const itemId = () => `ck_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,;:–—-]+$/, '')}…`;
}

const trimEnd = (s: string) => s.replace(/[\s.,;:!?।]+$/, '').trim();

/** Sentences, split on . ! ? । and new lines (not inside 1.5 or a URL). */
export function sentences(text: string): string[] {
  return text
    .replace(/([!?।])\s*/g, '$1\n')
    .replace(/([.])\s+/g, '$1\n')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ─── Lists ──────────────────────────────────────────────────────

const LIST_LINE = /^\s*(?:[-*•▪◦–]|\[\s?[xX✓ ]?\s?\]|\d{1,2}[.)]|[০-৯]{1,2}[.)])\s+(.+)$/;
const DONE_LINE = /^\s*(?:[-*•▪◦–]\s+)?\[\s?[xX✓]\s?\]/;

// "buy milk, eggs and bread" / "কিনতে হবে: চাল, ডাল, তেল"
const LIST_VERBS =
  /^(?:(?:i\s+)?(?:need\s+to\s+|have\s+to\s+|should\s+|must\s+)?(?:buy|get|pick\s+up|bring|pack|order)|groceries|shopping(?:\s+list)?|to\s*do|todo|packing(?:\s+list)?|kinte\s+hobe|kinbo|anbo|ante\s+hobe|কিনতে\s+হবে|কিনবো|কিনব|আনতে\s+হবে|আনবো|বাজার)(?=[\s:]|$)\s*:?\s*/i;

function splitItems(list: string): string[] {
  return list
    .split(/\s*[,،]\s*|\s+(?:and|ebong|ar|aar|আর|এবং|ও)\s+/i)
    .map((s) => trimEnd(s))
    .filter(Boolean);
}

function readList(text: string): { text: string; items: ChecklistItem[] } {
  const lines = text.split('\n');
  const listLines = lines.filter((l) => LIST_LINE.test(l));
  if (listLines.length >= 2 || listLines.some((l) => /^\s*\[/.test(l))) {
    const items = listLines.map((l) => ({
      id: itemId(),
      text: trimEnd(l.match(LIST_LINE)![1].replace(/^\[\s?[xX✓ ]?\s?\]\s*/, '')),
      checked: DONE_LINE.test(l),
    }));
    const rest = lines.filter((l) => !LIST_LINE.test(l)).join('\n').trim();
    return { text: rest, items: items.filter((i) => i.text) };
  }

  // A spoken or one-line list: a verb like "buy", then three or more short things.
  for (const sentence of sentences(text)) {
    const lead = sentence.match(LIST_VERBS);
    const afterColon = sentence.includes(':') ? sentence.slice(sentence.indexOf(':') + 1) : '';
    const body = lead ? sentence.slice(lead[0].length) : afterColon;
    if (!body) continue;
    const parts = splitItems(body);
    if (parts.length >= 3 && parts.every((p) => p.split(/\s+/).length <= 4)) {
      return { text, items: parts.map((p) => ({ id: itemId(), text: capitalize(p), checked: false })) };
    }
  }
  return { text, items: [] };
}

// ─── Links ──────────────────────────────────────────────────────

function readLinks(text: string): string[] {
  const found = text.match(/\b(?:https?:\/\/|www\.)[^\s<>()\[\]"']+/gi) ?? [];
  return [
    ...new Set(
      found.map((u) => u.replace(/[.,;:!?)\]]+$/, '')).map((u) => (/^www\./i.test(u) ? `https://${u}` : u)),
    ),
  ];
}

// ─── Numbers worth tracking ─────────────────────────────────────

type UnitKind = 'money' | 'distance' | 'weight' | 'time' | 'pages' | 'steps' | 'energy' | 'reps' | 'sets' | 'volume' | 'glasses';

const UNITS = new Map<string, { unit: string; kind: UnitKind }>();
const addUnit = (unit: string, kind: UnitKind, ...words: string[]) =>
  words.forEach((w) => UNITS.set(nfc(w), { unit, kind }));

addUnit('BDT', 'money', '৳', 'tk', 'taka', 'takar', 'bdt', 'টাকা', 'টাকার', 'টাকায়', 'টাকা।');
addUnit('USD', 'money', '$', 'usd', 'dollar', 'dollars', 'ডলার');
addUnit('EUR', 'money', '€', 'eur', 'euro', 'euros', 'ইউরো');
addUnit('GBP', 'money', '£', 'gbp', 'quid');
addUnit('INR', 'money', '₹', 'inr', 'rs', 'rupee', 'rupees', 'রুপি');
addUnit('km', 'distance', 'km', 'kms', 'kilometer', 'kilometers', 'kilometre', 'kilometres', 'কিমি', 'কিলোমিটার');
addUnit('mi', 'distance', 'mi', 'mile', 'miles', 'মাইল');
addUnit('kg', 'weight', 'kg', 'kgs', 'kilo', 'kilos', 'কেজি');
addUnit('lb', 'weight', 'lb', 'lbs');
addUnit('h', 'time', 'h', 'hr', 'hrs', 'hour', 'hours', 'ghonta', 'ghunta', 'ঘণ্টা', 'ঘন্টা');
addUnit('min', 'time', 'min', 'mins', 'minute', 'minutes', 'minit', 'মিনিট');
addUnit('pages', 'pages', 'page', 'pages', 'pg', 'পৃষ্ঠা', 'পাতা', 'pata');
addUnit('steps', 'steps', 'steps', 'স্টেপ');
addUnit('kcal', 'energy', 'kcal', 'cal', 'calories', 'calorie', 'ক্যালরি');
addUnit('reps', 'reps', 'rep', 'reps');
addUnit('sets', 'sets', 'set', 'sets');
addUnit('L', 'volume', 'l', 'litre', 'litres', 'liter', 'liters', 'লিটার');
addUnit('ml', 'volume', 'ml');
addUnit('glasses', 'glasses', 'glass', 'glasses', 'গ্লাস');

function unitAt(tokens: string[], i: number) {
  const t = tokens[i];
  if (!t) return undefined;
  return UNITS.get(t.replace(/^\.+|\.+$/g, '')) ?? UNITS.get(t);
}

const has = (words: string[], re: RegExp) => words.some((w) => re.test(w));

// Clause words → what the number is.
const INCOME = /^(got|received|earned|income|salary|pelam|পেলাম|পেয়েছি|আয়|ay|beton|বেতন|sold|bechlam|বেচলাম)$/;
const PRICE = /^(price|prices|dam|দাম|rate|costs?)$/;
const TRAVEL = /^(travelled|traveled|travel|went|gelam|গেলাম|journey)$/;
const RUN = /^(ran|run|running|jog|jogged|jogging|দৌড়|দৌড়ালাম|dourano|douralam)$/;
const WALK = /^(walk|walked|walking|hata|hatlam|হাঁটা|হাঁটলাম|হাটলাম)$/;
const RIDE = /^(cycled|cycling|cycle|rode|ride|bike|biked|সাইকেল)$/;
const DRIVE = /^(drove|drive|driving)$/;
const WEIGHT = /^(weight|weigh|weighed|weighs|ojon|wajan|ওজন)$/;
const LIFT = /^(lifted|bench|squat|squats|deadlift|press|curl|curls)$/;
const SLEEP = /^(slept|sleep|ghum|ghumalam|ঘুম|ঘুমালাম|ঘুমিয়েছি)$/;
const STUDY = /^(studied|study|studying|read|reading|pora|porlam|পড়লাম|পড়া|পড়েছি|revision)$/;
const WORK = /^(worked|work|working|office|kaj|কাজ|অফিস)$/;
const EXERCISE = /^(workout|gym|exercise|exercised|yoga|ব্যায়াম|byam)$/;
const WATER = /^(water|pani|পানি|jol|জল)$/;
// The verb already names the metric ("ran 5 km" is "ran"), so it's no label.
const ACTIVITY = [RUN, WALK, RIDE, DRIVE, TRAVEL, SLEEP, STUDY, WEIGHT, /^(spend|spent|paid|khoroch|খরচ|pages?)$/];

const GROUPS: [string, RegExp][] = [
  ['transport', /^(cng|rickshaw|riksha|রিকশা|সিএনজি|bus|বাস|uber|pathao|taxi|cab|train|ট্রেন|launch|লঞ্চ|fuel|petrol|octane|diesel|তেল|fare|bhara|ভাড়া|flight|ticket|টিকিট|metro|parking)$/],
  ['food', /^(lunch|dinner|breakfast|food|khabar|খাবার|nasta|নাস্তা|tea|cha|চা|coffee|snacks?|restaurant|biryani|বিরিয়ানি|meal|groceries|grocery|bazar|বাজার|fuchka|ফুচকা)$/],
  ['stay', /^(hotel|হোটেল|room|resort|stay|airbnb|motel)$/],
  ['shopping', /^(shopping|clothes|shirt|shoes|jama|জামা|gift|উপহার)$/],
  ['bills', /^(bill|বিল|rent|electricity|internet|wifi|gas|phone|recharge|রিচার্জ|subscription)$/],
  ['health', /^(medicine|ঔষধ|ওষুধ|oshud|doctor|ডাক্তার|daktar|pharmacy|hospital|test)$/],
];

// Words that never make a label.
const FILLER = new Set(
  (
    'a an the for on of in at to from by with and or but i my me we our it its is was were be been am are this that ' +
    'spent spend paid pay cost costs gave give got get bought buy total today yesterday tonight just only about around ' +
    'went go took take used per each so then also about almost nearly um uh okay ok this that' +
    ' khoroch khorch khoros gese geche gelo hoise hoyeche hoilo holo dilam disi diyechi diye er jonno te ta ti ar aar aj ' +
    'ajke kal kalke ami amar amra korlam korsi lagse laglo lagche porse porlo'
  ).split(' '),
);
const BANGLA_FILLER = new Set(
  'খরচ গেছে গেল হলো হল হয়েছে হইছে দিলাম দিয়েছি দিয়ে এর জন্য তে টা টি আর আজ আজকে কাল আমি আমার আমরা করলাম লাগল লাগলো লেগেছে পড়ল পড়েছে মোট'
    .split(' ')
    .map(nfc),
);

function isFiller(word: string): boolean {
  return FILLER.has(word) || BANGLA_FILLER.has(word) || /^\d/.test(word) || word.length < 2 || !!UNITS.get(word);
}

/** "for the cng" → "cng"; up to three words, as the person wrote them. */
function labelFrom(lower: string[], original: string[]): string | undefined {
  const picked: string[] = [];
  lower.forEach((w, i) => {
    if (!isFiller(w) && !ACTIVITY.some((re) => re.test(w)) && picked.length < 3) picked.push(original[i] ?? w);
  });
  const label = picked.join(' ').trim();
  return label || undefined;
}

function isTimeOrYear(tokens: string[], span: NumberSpan): boolean {
  const next = tokens[span.last + 1] ?? '';
  if (/^(am|pm|a\.m\.|p\.m\.|baje|বাজে|টায়|টার|tay|o'clock|th|st|nd|rd)$/.test(next)) return true;
  if (/^টা(য়|র)?$/.test(nfc(next))) return true;
  return Number.isInteger(span.value) && span.value >= 1900 && span.value <= 2100 && !unitAt(tokens, span.last + 1);
}

function metricFor(kind: UnitKind, clause: string[]): { metric: string; rollup: Rollup } | null {
  switch (kind) {
    case 'money':
      if (has(clause, INCOME)) return { metric: 'received', rollup: 'sum' };
      if (has(clause, PRICE) && !has(clause, /^(spent|paid|dilam|দিলাম|khoroch|খরচ)$/)) return { metric: 'price', rollup: 'compare' };
      return { metric: 'spent', rollup: 'sum' };
    case 'distance':
      if (has(clause, RUN)) return { metric: 'ran', rollup: 'sum' };
      if (has(clause, WALK)) return { metric: 'walked', rollup: 'sum' };
      if (has(clause, RIDE)) return { metric: 'cycled', rollup: 'sum' };
      if (has(clause, DRIVE)) return { metric: 'drove', rollup: 'sum' };
      if (has(clause, TRAVEL)) return { metric: 'travelled', rollup: 'sum' };
      return null; // "the shop is 2 km away" isn't a reading.
    case 'weight':
      if (has(clause, WEIGHT)) return { metric: 'weight', rollup: 'latest' };
      if (has(clause, LIFT)) return { metric: 'lifted', rollup: 'latest' };
      return null; // "2 kg rice" is a quantity, not something to track.
    case 'time':
      if (has(clause, SLEEP)) return { metric: 'sleep', rollup: 'average' };
      if (has(clause, STUDY)) return { metric: 'studied', rollup: 'sum' };
      if (has(clause, EXERCISE) || has(clause, RUN) || has(clause, WALK)) return { metric: 'exercise', rollup: 'sum' };
      if (has(clause, WORK)) return { metric: 'worked', rollup: 'sum' };
      return null; // "in 5 minutes" isn't a reading.
    case 'pages':
      return { metric: 'read', rollup: 'sum' };
    case 'steps':
      return { metric: 'steps', rollup: 'sum' };
    case 'energy':
      return { metric: 'calories', rollup: 'sum' };
    case 'reps':
      return { metric: 'reps', rollup: 'sum' };
    case 'sets':
      return { metric: 'sets', rollup: 'sum' };
    case 'volume':
    case 'glasses':
      return has(clause, WATER) ? { metric: 'water', rollup: 'sum' } : null;
  }
}

function groupFor(words: string[]): string | undefined {
  for (const [group, re] of GROUPS) if (has(words, re)) return group;
  return undefined;
}

/** Clauses: sentences, then commas that aren't inside a number. */
function clauses(text: string): string[] {
  return sentences(text)
    .flatMap((s) => s.split(/,(?!\d)|;|:(?!\d)|\s+then\s+|\s+tarpor\s+|\s+তারপর\s+/i))
    .map((s) => s.trim())
    .filter(Boolean);
}

export function readMeasures(text: string, known: KnownMetric[] = []): Measure[] {
  const all = clauses(text).map((c) => {
    const lower = numberTokens(c);
    const original = numberTokens(c, true);
    return { lower, original, spans: scanNumbers(lower).filter((s) => !isTimeOrYear(lower, s)) };
  });

  // The note's currency, for bare amounts in the same note: "rickshaw 50, lunch 120 taka".
  const currencies = all.flatMap(({ lower }) =>
    lower.map((_, i) => unitAt(lower, i)).filter((u) => u?.kind === 'money').map((u) => u!.unit),
  );
  const noteCurrency = currencies[0];

  const out: Measure[] = [];
  for (const { lower, original, spans } of all) {
    // "lunch 120, cab 80" names things before the amount; "$20 on lunch and
    // $15 on a cab" after. The first amount tells which.
    const namesFirst = spans.length > 0 && !!labelFrom(lower.slice(0, spans[0].first), original.slice(0, spans[0].first));
    spans.forEach((span, n) => {
      const before = unitAt(lower, span.first - 1);
      const after = unitAt(lower, span.last + 1);
      // "৳500", "$20": the symbol leads; words follow ("500 taka").
      let unit = after ?? (before && /^[৳$€£₹]$/.test(lower[span.first - 1]) ? before : undefined);
      const figure = original[span.first] ?? '';
      const looksLikeAnId = /^0\d{3,}/.test(figure) || /^\d{7,}$/.test(figure);
      if (!unit && noteCurrency && spans.length === 1 && span.value > 0 && !looksLikeAnId) {
        // A lone bare number beside a thing, in a note about money.
        const others = lower.filter((w, i) => (i < span.first || i > span.last) && !isFiller(w));
        if (others.length > 0) unit = { unit: noteCurrency, kind: 'money' };
      }
      if (!unit || span.value <= 0) return;

      const what = metricFor(unit.kind, lower);
      if (!what) return;
      // The label: the words since the previous number, or after this one.
      const from = n > 0 ? spans[n - 1].last + 1 : 0;
      const nextStart = spans[n + 1]?.first ?? lower.length;
      const [start, end] = namesFirst ? [from, span.first] : [span.last + 1, nextStart];
      const label =
        labelFrom(lower.slice(start, end), original.slice(start, end)) ??
        labelFrom(lower.slice(from, nextStart), original.slice(from, nextStart));
      const near = lower.slice(start, end);

      // Reuse what the thread already calls this: "expense" stays "expense".
      let metric = what.metric;
      const rollup = what.rollup;
      const same = known.filter((k) => (k.unit ?? '') === unit!.unit);
      const generic = metric === 'spent' || metric === 'travelled';
      if (same.length === 1 && (generic || metricKey(same[0].metric) === metricKey(metric))) metric = same[0].metric;

      out.push({
        metric,
        value: Math.round(span.value * 100) / 100,
        unit: unit.unit,
        label,
        group: unit.kind === 'money' ? groupFor(near) ?? groupFor(lower) : undefined,
        rollup,
      });
    });
  }
  return out.slice(0, 30);
}

// ─── Next step, where it stopped ────────────────────────────────

const INTENT_EN =
  /\b(need(?:s)? to|have to|has to|got to|gotta|must|should|remember to|remind(?: me)? to|don'?t forget(?: to)?|do not forget(?: to)?|todo|to-do|next step|next:|i'?ll|i will|we'?ll|we will|going to|plan to|planning to|let'?s|tomorrow|by (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i;
const INTENT_BN = /(তে হবে|লাগবে|মনে করে|ভুল(?:বো|ব|ো|ে যেও|ে যাবো) না|করবো|করব|যাবো|যাব|কিনবো|কিনব|দেবো|দিব|আগামীকাল)/;
const INTENT_LATIN_BN =
  /\b(\w+te hobe|lagbe|mone kore|bhulbo na|vulbo na|korbo|jabo|kinbo|dibo|debo|nibo|agamikal)\b/i;

const LEAD_INS =
  /^(?:(?:so|ok(?:ay)?|and|also|um+|uh+|then)\s+)*(?:i\s+|we\s+)?(?:really\s+)?(?:need(?:s)? to|have to|has to|got to|gotta|must|should|remember to|remind(?: me)? to|don'?t forget to|do not forget to|todo:?|to-do:?|next step:?|next:|i'?ll|will|am going to|are going to|going to|plan to|planning to|let'?s)\s+/i;

function cleanStep(sentence: string): string {
  const stripped = trimEnd(sentence.replace(LEAD_INS, ''));
  return clip(capitalize(stripped), STEP_MAX);
}

const isIntent = (s: string) => INTENT_EN.test(s) || INTENT_BN.test(nfc(s)) || INTENT_LATIN_BN.test(s);

function readNextStep(text: string): { step?: string; sentence?: string } {
  for (const sentence of sentences(text)) {
    if (!isIntent(sentence)) continue;
    // "Met them today, need to send the quote": just the part that's a step.
    // A step that introduces a list ("buy for home: rice, lentils") ends at the colon.
    const colon = sentence.split(/:\s/)[0];
    const head = isIntent(colon) ? colon : sentence;
    const part = head.split(/,\s*|;\s*/).find((p) => isIntent(p) && p.trim().split(/\s+/).length >= 2);
    const step = cleanStep(part ?? head);
    if (step.length >= 3) return { step, sentence: part ?? sentence };
  }
  return {};
}

const LEFT_OFF =
  /\b(stopped at|left off|got (?:up )?to|finished|done with|completed|reached|halfway|up to (?:page|chapter|step))\b|(পর্যন্ত|শেষ করলাম|শেষ হয়েছে|শেষ হলো|থামলাম)|\b(porjonto|shesh korlam|sesh korlam|shesh holo)\b/i;

function readLeftOff(text: string, nextSentence?: string): string | undefined {
  const hit = sentences(text).find((s) => s !== nextSentence && LEFT_OFF.test(nfc(s)));
  return hit ? clip(capitalize(trimEnd(hit)), STEP_MAX) : undefined;
}

// ─── When ───────────────────────────────────────────────────────

const WEEKDAYS: string[][] = [
  ['sunday', 'রবিবার', 'রোববার', 'robibar', 'robbar', 'rabibar'],
  ['monday', 'সোমবার', 'shombar', 'sombar', 'somobar'],
  ['tuesday', 'মঙ্গলবার', 'mongolbar', 'mangalbar'],
  ['wednesday', 'বুধবার', 'budhbar', 'budbar', 'budhobar'],
  ['thursday', 'বৃহস্পতিবার', 'brihospotibar', 'brihaspatibar', 'bishudbar', 'bishyudbar'],
  ['friday', 'শুক্রবার', 'shukrobar', 'sukrobar', 'jummabar'],
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

const DAY_MS = 24 * 60 * 60 * 1000;

function atTime(day: Date, hour: number, minute: number): number {
  const d = new Date(day);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

function readTime(words: string[], joined: string): { hour: number; minute: number } | undefined {
  const ampm = joined.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/i);
  if (ampm) {
    let hour = Number(ampm[1]) % 12;
    if (/^p/i.test(ampm[3])) hour += 12;
    return { hour, minute: Number(ampm[2] ?? 0) };
  }
  const clock = joined.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (clock) return { hour: Number(clock[1]), minute: Number(clock[2]) };
  // "বিকাল ৫টায়", "sokal 10 tay", "rat 9 ta"
  const bn = joined.match(
    /(সকাল|সকালে|দুপুর|দুপুরে|বিকাল|বিকেল|বিকালে|বিকেলে|সন্ধ্যা|সন্ধ্যায়|রাত|রাতে|sokal|sokale|dupur|dupure|bikal|bikel|bikale|bikele|sondha|sondhay|rat|rate|raat|raate)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(?:টা|টায়|টার|ta|tay|tar|baje|বাজে)?/i,
  );
  if (bn) {
    let hour = Number(bn[2]) % 12;
    const part = bn[1].toLowerCase();
    if (/^(দুপুর|dupur)/.test(part) && hour < 6) hour += 12;
    if (/^(বিকাল|বিকেল|সন্ধ্যা|রাত|bikal|bikel|sondha|rat|raat)/.test(part)) hour += 12;
    return { hour, minute: Number(bn[3] ?? 0) };
  }
  const bare = joined.match(/\b(\d{1,2})\s*(?:টায়|টা|tay|baje|বাজে|o'clock)/i);
  if (bare) {
    const h = Number(bare[1]);
    // Said without morning/evening: business hours are the safer guess.
    return { hour: h >= 1 && h <= 7 ? h + 12 : h % 24, minute: 0 };
  }
  void words;
  return undefined;
}

/** A day (and time) named in a sentence, as a timestamp in the future. */
export function readWhen(sentence: string, now = Date.now(), monthFirst = false): number | undefined {
  const text = nfc(sentence.toLowerCase());
  const words = numberTokens(text);
  const joined = words.join(' ');
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  let day: Date | undefined;

  const hasWord = (...options: string[]) => options.some((o) => words.includes(nfc(o)));
  if (/day after tomorrow/.test(text) || hasWord('পরশু', 'porshu', 'poroshu', 'porsu')) {
    day = new Date(today.getTime() + 2 * DAY_MS);
  } else if (hasWord('tomorrow', 'tmrw', 'tmr', 'আগামীকাল', 'কাল', 'কালকে', 'kal', 'kalke', 'agamikal')) {
    day = new Date(today.getTime() + DAY_MS);
  } else if (hasWord('today', 'tonight', 'আজ', 'আজকে', 'আজই', 'aj', 'ajke', 'aaj', 'ajkei')) {
    day = today;
  } else if (/\bnext week\b|আগামী সপ্তাহ|agami (?:shoptah|saptah|soptah)/.test(text)) {
    day = new Date(today.getTime() + 7 * DAY_MS);
  }

  if (!day) {
    const inDays = text.match(/\bin (\d+|a|one|two|three) (day|days|week|weeks)\b/) ?? null;
    const bnDays = joined.match(/(\d+) (?:দিন|din) (?:পর|por|pore|পরে)/);
    if (inDays) {
      const n = { a: 1, one: 1, two: 2, three: 3 }[inDays[1] as 'a'] ?? Number(inDays[1]);
      day = new Date(today.getTime() + n * (inDays[2].startsWith('week') ? 7 : 1) * DAY_MS);
    } else if (bnDays) {
      day = new Date(today.getTime() + Number(bnDays[1]) * DAY_MS);
    }
  }

  if (!day) {
    const weekday = WEEKDAYS.findIndex((names) => names.some((n) => words.includes(n) || words.includes(`${n}e`)));
    if (weekday >= 0) {
      const ahead = (weekday - today.getDay() + 7) % 7 || 7;
      day = new Date(today.getTime() + ahead * DAY_MS);
    }
  }

  if (!day) {
    // "15 Oct", "Oct 15th", "১৫ অক্টোবর", "15/10"
    for (let i = 0; i < words.length && !day; i++) {
      const month = MONTHS.findIndex((names) => names.includes(words[i]));
      if (month < 0) continue;
      const near = [words[i - 1], words[i + 1]].map((w) => Number(w)).find((n) => n >= 1 && n <= 31);
      if (near) day = new Date(today.getFullYear(), month, near);
    }
    const slash = !day && text.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/);
    if (slash && !day) {
      let [a, b] = [Number(slash[1]), Number(slash[2])];
      if (monthFirst && a <= 12) [a, b] = [b, a];
      if (a > 12 && b <= 12) {
        // Only one reading makes sense.
      } else if (b > 12 && a <= 12) [a, b] = [b, a];
      if (b >= 1 && b <= 12 && a >= 1 && a <= 31) {
        const year = slash[3] ? Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]) : today.getFullYear();
        day = new Date(year, b - 1, a);
      }
    }
    if (day && day.getTime() < today.getTime() && !/\b\d{4}\b/.test(text)) {
      day = new Date(day.getFullYear() + 1, day.getMonth(), day.getDate());
    }
  }

  const time = readTime(words, joined);
  if (!day && time) {
    // "at 6 pm" with no day: the next 6 pm, today if it's still ahead.
    const at = atTime(today, time.hour, time.minute);
    return at > now ? at : atTime(new Date(today.getTime() + DAY_MS), time.hour, time.minute);
  }
  if (!day) return undefined;
  const at = time ? atTime(day, time.hour, time.minute) : atTime(day, 9, 0);
  if (at > now) return at;
  // Today with no time named, and the morning's gone: the evening.
  if (!time && day.getTime() === today.getTime()) {
    const evening = atTime(day, 18, 0);
    return evening > now ? evening : undefined;
  }
  return undefined;
}

// ─── Category, tags, title ──────────────────────────────────────

const CATEGORY_WORDS: [Category, RegExp][] = [
  ['work', /^(meeting|meetings|office|client|clients|boss|deadline|email|report|presentation|standup|invoice|মিটিং|অফিস|ক্লায়েন্ট|বস|প্রেজেন্টেশন)$/],
  ['study', /^(exam|exams|class|classes|assignment|lecture|homework|course|chapter|syllabus|quiz|পরীক্ষা|ক্লাস|অ্যাসাইনমেন্ট|porikkha|assignment|tuition|টিউশন)$/],
  ['shopping', /^(buy|groceries|grocery|bazar|বাজার|কিনতে|কিনবো|kinte|kinbo|order|shopping|cart|daraz)$/],
  ['health', /^(doctor|medicine|gym|workout|weight|sleep|pill|pills|hospital|dentist|ডাক্তার|ওষুধ|ঔষধ|ব্যায়াম|ঘুম|ওজন|oshud|daktar|ran|run|steps|diet)$/],
  ['errands', /^(bill|bills|bank|repair|plumber|electrician|courier|pickup|renew|passport|বিল|ব্যাংক|মিস্ত্রি|কুরিয়ার|mistri)$/],
  ['ideas', /^(idea|ideas|আইডিয়া|আইডিয়া|brainstorm|concept)$/],
  ['personal', /^(trip|tour|family|friend|friends|birthday|wedding|vacation|holiday|ট্যুর|ভ্রমণ|পরিবার|জন্মদিন|বিয়ে|ghurte|biye)$/],
];

function readCategory(words: string[]): Category | undefined {
  let best: Category | undefined;
  let bestCount = 0;
  for (const [category, re] of CATEGORY_WORDS) {
    const count = words.filter((w) => re.test(w)).length;
    if (count > bestCount) {
      best = category;
      bestCount = count;
    }
  }
  return best;
}

function readTags(text: string): string[] {
  const tags = (text.match(/(?:^|\s)#([^\s#.,;:!?()[\]{}"']{2,30})/g) ?? []).map((t) => t.trim().slice(1).toLowerCase());
  return [...new Set(tags)].slice(0, 8);
}

const TITLE_LEAD =
  /^(?:(?:so|ok(?:ay)?|um+|uh+|hmm+|well|basically|alright|note|আচ্ছা|তো|শোনো|accha|acha|to)[,:]?\s+)+/i;

// "tomorrow at 5pm" belongs in the reminder, not the name of the thread.
const WHEN_PHRASES = [
  /\b(?:on|by|this|next)?\s*(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
  /\b(?:the\s+)?day after tomorrow\b|\b(?:today|tonight|tomorrow|tmrw)\b|\bnext week\b|\bthis (?:morning|afternoon|evening)\b/gi,
  /\b(?:at|by|around)?\s*\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)/gi,
  /\b(?:at|by)\s+\d{1,2}:\d{2}\b/gi,
  /(?:^|\s)(?:আগামীকাল|আজকে|আজ|কালকে|কাল|পরশু)(?=\s|$)/g,
  /(?:^|\s)(?:সকাল|সকালে|দুপুর|দুপুরে|বিকাল|বিকেল|বিকালে|বিকেলে|সন্ধ্যা|সন্ধ্যায়|রাত|রাতে)?\s*[০-৯\d]{1,2}\s*(?:টায়|টা|টার)(?=\s|$)/g,
  /\b(?:sokal|bikal|bikel|rat|raat|dupur|sondhay?)?\s*\d{1,2}\s*(?:tay|ta|baje)\b/gi,
  /\b(?:agamikal|kalke|kal|ajke|aj|porshu)\b/gi,
];

function withoutWhen(text: string): string {
  const stripped = WHEN_PHRASES.reduce((t, re) => t.replace(re, ' '), text)
    .replace(/\s+([,;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Never strip a title down to nothing.
  return stripped.split(/\s+/).length >= 2 ? stripped : text;
}

function readTitle(text: string, items: ChecklistItem[]): string {
  const firstLine = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const multiLine = text.trim().includes('\n');
  let title = multiLine && firstLine.length <= 60 ? firstLine : sentences(text)[0] ?? '';
  // "Lisbon trip: dinner €40, …" is about the Lisbon trip.
  const head = title.match(/^([^:]{2,40}):\s+\S/);
  if (head && head[1].trim().split(/\s+/).length <= 6) title = head[1];
  title = trimEnd(title.replace(/^#+\s*/, '').replace(TITLE_LEAD, '').replace(LEAD_INS, ''));
  // A title is no place for a link or a hashtag.
  title = title.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '').replace(/(?:^|\s)#\S+/g, '').trim();
  title = trimEnd(withoutWhen(title).replace(/\s+(?:and|or|at|on|by)$/i, ''));
  const link = readLinks(text)[0];
  if (link && title.split(/\s+/).length < 2) return hostOf(link);
  if (!title) return items[0] ? clip(items[0].text, TITLE_MAX) : '';
  return clip(capitalize(title), TITLE_MAX);
}

// ─── All of it ──────────────────────────────────────────────────

/**
 * Reads a note on the device. `known` is what the destination thread
 * already tracks; `now` is for "tomorrow"; `monthFirst` reads 3/4 as
 * March 4 (otherwise 3 April).
 */
export function understand(
  input: string,
  options: { known?: KnownMetric[]; now?: number; monthFirst?: boolean } = {},
): Reading {
  const raw = input.trim();
  const list = readList(raw);
  const text = list.text;
  const { step, sentence } = readNextStep(text || raw);
  const words = numberTokens(raw);
  const due = sentence ? readWhen(sentence, options.now, options.monthFirst) : undefined;
  return {
    text,
    title: readTitle(text || raw, list.items),
    checklist: list.items,
    links: readLinks(raw),
    measures: readMeasures(text || raw, options.known),
    // The time lives in the reminder; the step says what to do.
    nextStep: step && due ? trimEnd(withoutWhen(step).replace(/\s+(?:at|on|by)$/i, '')) : step,
    leftOff: readLeftOff(text, sentence),
    due,
    category: readCategory(words),
    tags: readTags(raw),
  };
}
