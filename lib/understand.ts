import { numberTokens, scanNumbers, metricKey, type NumberSpan } from '@/lib/measures';
import type { Category, ChecklistItem, LaterStep, Measure, Rollup } from '@/types/mnemo';
import { capitalize, hostOf, nfc } from '@/utils/text';
import { DAY_MS } from '@/utils/time';
import { queueSteps } from '@/lib/when';
import { isPlan, MONTH_WORDS, opensInPast, readWhenFull, withoutWhen, type Repeat } from '@/lib/when-read';

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
  /** When the next step is due, if a time or day was named ("tomorrow", "at 7", "শুক্রবার"). */
  due?: number;
  /** "every day at 8", "every Friday", "প্রতিদিন". */
  repeat?: Repeat;
  later: LaterStep[];
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
// A full stop after these isn't the end of a sentence ("Tk. 1,200", "Dr. Rahman").
const ABBREVIATIONS = /(?:^|\s)(?:tk|rs|dr|mr|mrs|ms|st|no|vs|approx|etc|e\.g|i\.e|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)$/i;

export function sentences(text: string): string[] {
  return text
    .replace(/([!?।])\s*/g, '$1\n')
    .replace(/([.])\s+/g, (m, dot, offset: number, all: string) => (ABBREVIATIONS.test(all.slice(Math.max(0, offset - 8), offset)) ? m : `${dot}\n`))
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ─── Speech with no punctuation ─────────────────────────────────
// The phone's speech service punctuates English only, and only on some
// phones; Bangla and Banglish arrive as one long run ("meeting with rahim
// went well he wants the budget by friday"). In a long note with no
// sentence ends, break where a spoken clause plainly starts or ends, so
// the title, next step and left-off each come from one thought.

const SPOKEN_MIN_WORDS = 10;
const CLAUSE_MIN_WORDS = 3;

// English: a clause starts at these ("…went well | he wants…").
const CLAUSE_START =
  /\s+(?=(?:and then|but|anyway|after that|next (?:is|up)|(?:he|she|they) (?:said|says|told)|karon|kintu|tarpor|tarpore|তারপর|কিন্তু|কারণ|(?:and |but |so )?(?:i|we|you|he|she|they)(?:'ll| will| need(?:s)? to| have to| has to| should| must| want(?:s)? to| wants| gotta| got to| am going to| are going to| is going to)|(?:and )?(?:remember to|don'?t forget|remind me))\b)/gi;

// Bangla and Banglish put the verb last: a clause ends after a finished
// verb ("গিয়েছিলাম", "chilo"), unless a particle still belongs to it ("না").
const BN_VERB_END = /(?:লাম|ছিল|ছিলো|ছি|ছে|ছেন|বে|বো|বেন|লো|তাম)$/;
const BN_NOT_VERBS = new Set(['কাছে', 'পাছে', 'মাঝে', 'নিচে', 'উপরে'].map(nfc));
const BANGLISH_VERBS = new Set(
  (
    'chilo chilam silo silam chhilo gelam gechi geche gesi gese korlam korsi korechi koreche korse korbo korbe ' +
    'dilam disi dibe dibo debe nibo nilam chaise chaiche chailo bollo bolse bolche bolechi hobe hoise hoyeche holo ' +
    'jabo jabe gelo pailam paisi pelam peyechi asbe ashbe ashlam aslam kinlam kinbo khelam ache ase'
  ).split(' '),
);
const PARTICLES = new Set(['না', 'নি', 'কি', 'তো', 'যে', 'বলে', 'na', 'ni', 'ki', 'to', 'je', 'bole'].map(nfc));

const LINK_WORD = /^(?:and|but|so|then|ar|aar|abar|ebong|আর|এবং)$/i;

function endsClause(word: string, next: string | undefined): boolean {
  if (!next || PARTICLES.has(nfc(next.toLowerCase()))) return false;
  const w = nfc(word);
  if (BANGLISH_VERBS.has(w.toLowerCase())) return true;
  return /[ঀ-৿]/.test(w) && [...w].length >= 3 && BN_VERB_END.test(w) && !BN_NOT_VERBS.has(w);
}

/**
 * Long unpunctuated text with a new line at each clause break; anything
 * else unchanged. Only for reading it: the note keeps the words as said.
 */
export function spokenClauses(text: string): string {
  const words = text.trim().split(/\s+/);
  if (words.length < SPOKEN_MIN_WORDS || /[.!?।\n]/.test(text)) return text;
  const pieces = text.trim().replace(CLAUSE_START, '\n').split('\n');
  const clauses: string[][] = [];
  for (const piece of pieces) {
    let current: string[] = [];
    const ws = piece.trim().split(/\s+/);
    ws.forEach((w, i) => {
      current.push(w);
      if (endsClause(w, ws[i + 1])) {
        clauses.push(current);
        current = [];
      }
    });
    if (current.length > 0) clauses.push(current);
  }
  // A lone "and" / "so" opens the clause after it.
  for (let i = clauses.length - 2; i >= 0; i--) {
    if (clauses[i].length === 1 && LINK_WORD.test(clauses[i][0])) clauses.splice(i, 2, [...clauses[i], ...clauses[i + 1]]);
  }
  // A two-word scrap is part of the clause before it, not a thought of its own.
  const merged: string[][] = [];
  for (const clause of clauses) {
    const last = merged[merged.length - 1];
    if (last && (clause.length < CLAUSE_MIN_WORDS || last.length < CLAUSE_MIN_WORDS)) last.push(...clause);
    else merged.push([...clause]);
  }
  return merged.map((c) => c.join(' ')).join('\n');
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

function isFiller(raw: string): boolean {
  const word = raw.replace(/^\.+|\.+$/g, '');
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
  const prev = tokens[span.first - 1] ?? '';
  // A date: "25 october", "oct 30", "20 tarikh"
  if (MONTH_WORDS.has(nfc(next)) || MONTH_WORDS.has(nfc(prev)) || /^(তারিখে|তারিখ|tarikh|tarikhe)$/.test(nfc(next))) return true;
  // "at 7", "by 5" with nothing after that makes it an amount
  if (/^(at|by|@|around|before)$/.test(prev) && span.value <= 24 && !unitAt(tokens, span.last + 1)) return true;
  if (/^(am|pm|a\.m\.|p\.m\.|baje|বাজে|টায়|টার|tay|o'clock|th|st|nd|rd)$/.test(next)) return true;
  if (/^টা(য়|র)?$/.test(nfc(next))) return true;
  return Number.isInteger(span.value) && span.value >= 1900 && span.value <= 2100 && !unitAt(tokens, span.last + 1);
}

/** A duration counted from now: "in 20 mins", "after an hour", "২০ মিনিট পর". */
function fromNow(tokens: string[], span: NumberSpan): boolean {
  if (/^(in|after|within)$/.test(tokens[span.first - 1] ?? '')) return true;
  return /^(later|por|pore|baad|bade|পর|পরে|বাদে)$/.test(nfc(tokens[span.last + 2] ?? ''));
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

/** Words that make a bare amount money: "spent 1500", "salary 45000", "rent dilam 8000". */
const MONEY_WORDS = /^(spent|spend|paid|cost|costs|price|salary|rent|bill|fare|fee|fees|earned|khoroch|khorch|beton|bhara|dam|খরচ|বেতন|ভাড়া|দাম|বিল)$/;

export function readMeasures(text: string, known: KnownMetric[] = [], currency?: string): Measure[] {
  const all = clauses(text).map((c) => {
    const lower = numberTokens(c);
    const original = numberTokens(c, true);
    return { lower, original, spans: scanNumbers(lower).filter((s) => !isTimeOrYear(lower, s)) };
  });

  // The note's currency, for bare amounts in the same note: "rickshaw 50, lunch 120 taka".
  const currencies = all.flatMap(({ lower }) =>
    lower.map((_, i) => unitAt(lower, i)).filter((u) => u?.kind === 'money').map((u) => u!.unit),
  );
  // No currency said: the phone's own, but only for amounts money words point at.
  const noteCurrency = currencies[0] ?? (currency && all.some(({ lower }) => has(lower, MONEY_WORDS)) ? currency : undefined);

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
      const guessed = !currencies[0];
      if (!unit && noteCurrency && spans.length === 1 && span.value > 0 && !looksLikeAnId && (!guessed || span.value >= 10)) {
        // A lone bare number beside a thing, in a note about money.
        const others = lower.filter((w, i) => (i < span.first || i > span.last) && !isFiller(w));
        if (others.length > 0) unit = { unit: noteCurrency, kind: 'money' };
      }
      if (!unit || span.value <= 0) return;
      // "in 20 mins", "20 min pore": when, not how long something took.
      if (unit.kind === 'time' && fromNow(lower, span)) return;

      const what = metricFor(unit.kind, lower);
      if (!what) return;
      // The label: the words since the previous number, or after this one.
      const from = n > 0 ? spans[n - 1].last + 1 : 0;
      const nextStart = spans[n + 1]?.first ?? lower.length;
      const [start, end] = namesFirst ? [from, span.first] : [span.last + 1, nextStart];
      const label =
        labelFrom(lower.slice(start, end), original.slice(start, end)) ??
        labelFrom(lower.slice(from, nextStart), original.slice(from, nextStart)) ??
        (spans.length === 1 || n === spans.length - 1 ? labelFrom(lower, original) : undefined);
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
  /\b(need(?:s)? to|have to|has to|got to|gotta|must|should|remember to|remind(?: me)?(?: to)?|don'?t forget(?: to)?|do not forget(?: to)?|todo|to-do|next step|next:|next (?:is|up)|i'll|i will|we'll|we will|going to|plan to|planning to|let'?s|tomorrow|by (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i;
const INTENT_BN = /(তে হবে|লাগবে|মনে করে|মনে করিয়ে|ভুল(?:বো|ব|ো|ে যেও|ে যাবো) না|করবো|করব|যাবো|যাব|কিনবো|কিনব|দেবো|দিব|আগামীকাল)/;
const INTENT_LATIN_BN =
  /\b(\w+te hobe|lagbe|mone kore|mone koriye|bhulbo na|vulbo na|korbo|jabo|kinbo|dibo|debo|nibo|agamikal)\b/i;

const LEAD_INS =
  /^(?:[-*•]\s+)?(?:(?:so|ok(?:ay)?|and|also|um+|uh+|then|please|pls|plz|kindly|(?:can|could|would|will) you)[,:]?\s+)*(?:remember:|reminder:|todo:|to-do:|note:|task:)?\s*(?:i\s+|we\s+)?(?:really\s+)?(?:need(?:s)? to|have to|has to|got to|gotta|must|should|remember to|remind(?: me)? to|don'?t forget to|do not forget to|todo:?|to-do:?|next step:?|next:|next (?:is|up)|i'?ll|will|am going to|are going to|going to|plan to|planning to|let'?s)\s+/i;

/** "…, remind me" / "remind me please" at the end: the request, not the step. */
const REMIND_TAIL = /[\s,;.-]*(?:(?:please|pls|plz)\s+)?remind me(?:\s+(?:please|pls|plz))?[.!]?\s*$/i;

/** Curly quotes from phone keyboards read like straight ones ("I’ll" is "I'll"). */
const straightQuotes = (s: string) => s.replace(/[’‘ʼ`]/g, "'");

/** "- ", "Remember: ", "I have a ": not part of what to do. */
const STEP_LEAD = /^(?:[-*•]\s+)?(?:(?:remember|reminder|todo|to-do|note|task)\s*:\s*)?(?:(?:i|we)\s+(?:have|'ve got|got)\s+(?:a|an|the|my|our)\s+)?/i;

function cleanStep(sentence: string): string {
  const stripped = trimEnd(sentence.replace(STEP_LEAD, '').replace(LEAD_INS, '').replace(REMIND_TAIL, ''));
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

const THEN = /\s*[,;]\s*(?:and then\s+|and\s+|then\s+)?|\s+(?:and then|and|then|after that|আর|তারপর|tarpor)\s+/i;

function splitTimed(text: string, now?: number, monthFirst?: boolean): string {
  let split = false;
  const out = sentences(text).map((s) => {
    const parts = s.split(THEN).filter(Boolean);
    // A log of what happened keeps its verb for every day it names:
    // "ran 3k monday, 5k wednesday" isn't a run planned for wednesday.
    if (opensInPast(parts[0] ?? '')) return s;
    const timed = parts.filter((p) => withoutWhen(p) !== p.trim() && readWhenFull(p, now, monthFirst));
    if (timed.length < 2) return s;
    split = true;
    return parts.join('\n');
  });
  return split ? out.join('\n') : text;
}

const LEFT_OFF =
  /\b(stopped at|left off|got (?:up )?to|finished|done with|completed|reached|halfway|up to (?:page|chapter|step))\b|(পর্যন্ত|শেষ করলাম|শেষ হয়েছে|শেষ হলো|থামলাম)|\b(porjonto|shesh korlam|sesh korlam|shesh holo)\b/i;

function readLeftOff(text: string, nextSentence?: string): string | undefined {
  const hit = sentences(text).find((s) => s !== nextSentence && LEFT_OFF.test(nfc(s)));
  return hit ? clip(capitalize(trimEnd(hit)), STEP_MAX) : undefined;
}

// ─── When ───────────────────────────────────────────────────────
// lib/when-read.ts reads times, days, repeats and whether it's a plan.

/** A day (and time) named in a sentence, as a timestamp in the future. */
export function readWhen(sentence: string, now = Date.now(), monthFirst = false): number | undefined {
  return readWhenFull(sentence, now, monthFirst)?.at;
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
  /^(?:[-*•]\s+)?(?:(?:so|ok(?:ay)?|um+|uh+|hmm+|well|basically|alright|note|remember|reminder|todo|to-do|task|please|pls|plz|(?:can|could|would|will) you|আচ্ছা|তো|শোনো|accha|acha|to)[,:]?\s+)+/i;

/** "so I was thinking about the passport renewal": the passport renewal. */
const SPOKEN_TITLE_LEAD = /^(?:i\s+(?:was|am|'m)\s+)?(?:just\s+)?(?:thinking|talking)\s+(?:about|of)\s+(?:the\s+|my\s+|our\s+)?/i;

function readTitle(text: string, items: ChecklistItem[], hasWhen: boolean): string {
  const firstLine = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const multiLine = text.trim().includes('\n');
  let title = multiLine && firstLine.length <= 60 ? firstLine : sentences(text)[0] ?? '';
  // "Lisbon trip: dinner €40, …" is about the Lisbon trip.
  const head = title.match(/^([^:]{2,40}):\s+\S/);
  // "Lisbon trip: …" names the thread; "Remember: …" / "Todo: …" don't.
  if (head && head[1].trim().split(/\s+/).length <= 6 && !/^(?:[-*•]\s+)?(?:remember|reminder|todo|to-do|note|task|nb|ps)$/i.test(head[1].trim())) title = head[1];
  // "tomorrow at 5pm" belongs in the reminder, not the name of the thread;
  // with no reminder read, the words stay ("met Rumi at 3pm").
  if (hasWhen) title = withoutWhen(title);
  title = trimEnd(title.replace(/^#+\s*/, '').replace(STEP_LEAD, '').replace(TITLE_LEAD, '').replace(SPOKEN_TITLE_LEAD, '').replace(LEAD_INS, '').replace(REMIND_TAIL, ''));
  // A title is no place for a link or a hashtag.
  title = title.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '').replace(/(?:^|\s)#\S+/g, '').trim();
  title = trimEnd(title.replace(/\s+(?:and|or|at|on|by)$/i, ''));
  // "Remind me tomorrow": nothing left to name it by.
  if (/^(?:remind me|reminder|মনে করিয়ে দিও|mone koriye dio|(?:can|could|would|will) you|please|pls|plz)$/i.test(title)) title = '';
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
/** Speech services write "i" for "I"; a title or step shouldn't. */
function upperI<T extends string | undefined>(s: T): T {
  return (s?.replace(/(^|\s)i(?=$|\s|')/g, '$1I') ?? s) as T;
}

export function understand(
  input: string,
  options: { known?: KnownMetric[]; now?: number; monthFirst?: boolean; currency?: string } = {},
): Reading {
  const raw = straightQuotes(input.trim());
  const list = readList(raw);
  const text = list.text;
  // What the title, step, time and left-off are read from: the text, in
  // clauses when it was said without punctuation.
  const said = spokenClauses(text || raw);
  const steps = splitTimed(said, options.now, options.monthFirst);
  const { step, sentence } = readNextStep(steps);
  const words = numberTokens(raw);
  // The step's sentence first; otherwise any sentence that's a plan with a
  // time ("call amma at 7:30pm", "gym at 6am"), never a past one ("met Rumi at 3pm").
  let when = sentence && isPlan(sentence, true) ? readWhenFull(sentence, options.now, options.monthFirst) : undefined;
  let whenSentence = when ? sentence : undefined;
  let planStep: string | undefined;
  if (!when) {
    for (const s of sentences(steps)) {
      if (!isPlan(s, false)) continue;
      when = readWhenFull(s, options.now, options.monthFirst);
      if (when) {
        planStep = cleanStep(s);
        whenSentence = s;
        break;
      }
    }
  }
  const due = when?.at;
  // The time lives in the reminder; the step says what to do.
  const bare = (t?: string) => {
    if (!t) return undefined;
    const out = trimEnd(withoutWhen(t).replace(STEP_LEAD, '').replace(LEAD_INS, '').replace(REMIND_TAIL, '').replace(/\s+(?:at|on|by)$/i, ''));
    return /^(?:remind me|reminder|মনে করিয়ে দিও|mone koriye dio|(?:can|could|would|will) you|please|pls|plz|kindly)?$/i.test(out) ? undefined : capitalize(out);
  };
  let nextStep = due ? bare(step ?? planStep) : step;
  // Said in clauses, a step can lose what it's about: "rahim bhai budget
  // chaise | shukrobar er moddhe dite hobe" leaves "dite hobe". The clause
  // before says what.
  const clauses = said === (text || raw) ? [] : sentences(said);
  const at = clauses.indexOf(sentence ?? '');
  if (nextStep && at > 0 && nextStep.split(/\s+/).length < 3) {
    nextStep = clip(`${cleanStep(clauses[at - 1])}, ${nextStep.charAt(0).toLowerCase()}${nextStep.slice(1)}`, STEP_MAX);
  }
  let timed: LaterStep[] = [];
  if (due !== undefined && when?.repeat) timed.push({ at: due, step: upperI(nextStep) });
  else if (due !== undefined) {
    for (const s of sentences(steps)) {
      const primary = !!whenSentence && s.includes(whenSentence);
      const w = primary ? when : isPlan(s, isIntent(s)) ? readWhenFull(s, options.now, options.monthFirst) : undefined;
      if (!w || (!primary && w.repeat)) continue;
      let at = w.at;
      const before = timed[timed.length - 1]?.at;
      if (before !== undefined && at < before && before - at < DAY_MS) {
        const again = readWhenFull(primary ? whenSentence! : s, before, options.monthFirst)?.at;
        if (again !== undefined && Math.abs(again - at - DAY_MS) <= DAY_MS / 24) at = again;
      }
      timed.push({ at, step: primary ? upperI(nextStep) : upperI(bare(cleanStep(s))) });
    }
    timed = queueSteps(timed);
  }
  const later = timed.slice(1);
  return {
    text,
    title: upperI(readTitle(said, list.items, due !== undefined)) || (due ? 'Reminder' : ''),
    checklist: list.items,
    links: readLinks(raw),
    measures: readMeasures(text || raw, options.known, options.currency),
    // The time lives in the reminder; the step says what to do.
    nextStep: timed.length > 0 ? timed[0].step : upperI(nextStep),
    leftOff: upperI(readLeftOff(text ? said : '', sentence)),
    due: timed[0]?.at,
    repeat: due ? when?.repeat : undefined,
    later,
    category: readCategory(words),
    tags: readTags(raw),
  };
}
