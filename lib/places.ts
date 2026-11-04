import type { MnemoItem, Place, PlaceReminder, PlaceRepeat } from '@/types/mnemo';

// A place is a circle, never narrower than MIN_RADIUS or the fix accuracy it was saved with.
// Set while inside: arriving counts only after leaving first, and vice versa. Pure logic; phone side is lib/geofence.ts.

/** Smaller than this, phones fire late, early, or not at all. */
export const MIN_RADIUS = 150;
export const RADIUS_CHOICES = [150, 300, 500];
export const POOR_FIX = 100;
/** iOS watches at most 20 places per app (Android 100); one limit for both. */
export const MAX_WATCHED = 20;

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

type Point = Pick<Place, 'latitude' | 'longitude'>;

export function distance(a: Point, b: Point): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function watchedRadius(place: Pick<Place, 'radius' | 'accuracy'>): number {
  return Math.round(Math.max(place.radius, MIN_RADIUS, place.accuracy));
}

export function formatMeters(m: number): string {
  if (m < 100) return `${Math.max(5, Math.round(m / 5) * 5)} m`;
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

export function overlaps(place: Place, places: Place[]): Place[] {
  return places
    .filter((p) => p.id !== place.id && distance(place, p) < watchedRadius(place) + watchedRadius(p))
    .sort((a, b) => distance(place, a) - distance(place, b));
}

export function overlapText(others: Pick<Place, 'name'>[]): string | null {
  if (others.length === 0) return null;
  const names = others.map((o) => o.name);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Its circle overlaps ${list}. Being at one can count as being at ${others.length === 1 ? 'the other' : 'another'}.`;
}

export function fixText(accuracy: number): string | null {
  return accuracy > POOR_FIX
    ? `Your phone could only tell where you are to within ${formatMeters(accuracy)}, so the circle is that wide. Try again outside or with Wi-Fi on, or drop the pin yourself.`
    : null;
}

export function nameProblem(name: string, places: Place[], id?: string): string | null {
  const n = name.trim().toLowerCase();
  if (!n) return 'Give it a name.';
  if (places.some((p) => p.id !== id && p.name.trim().toLowerCase() === n)) return 'You already have a place with that name.';
  return null;
}

export function circleChanged(a: Place, b: Place): boolean {
  return a.latitude !== b.latitude || a.longitude !== b.longitude || watchedRadius(a) !== watchedRadius(b);
}

export function isArmed(t: Pick<MnemoItem, 'place' | 'status'>): t is Pick<MnemoItem, 'status'> & { place: PlaceReminder } {
  return !!t.place && !t.place.firedAt && (t.status === 'active' || t.status === 'paused');
}

export function placeLabel(r: Pick<PlaceReminder, 'on' | 'repeat' | 'days'>, place?: Pick<Place, 'name'>): string {
  const name = place?.name ?? 'a place no longer saved';
  const when = r.on === 'arrive' ? `When you get to ${name}` : `When you leave ${name}`;
  if (!r.repeat) return when;
  if (r.repeat === 'days') return `${when}, on ${formatDays(ringDays(r))}`;
  return `${when}, ${REPEAT_WORDS[r.repeat]}`;
}

const REPEAT_WORDS: Record<Exclude<PlaceRepeat, 'days'>, string> = { always: 'every time', weekdays: 'on weekdays', weekends: 'at weekends' };

/** Most recently set reminders win the MAX_WATCHED slots; the rest are `overflow`. */
export function pickWatched(items: Pick<MnemoItem, 'place' | 'status'>[], places: Place[]): { watched: Place[]; overflow: Set<string> } {
  const lastSet = new Map<string, number>();
  for (const t of items) {
    if (!isArmed(t)) continue;
    // A repeating reminder set long ago but still ringing counts as recent: it keeps its slot.
    const used = Math.max(t.place.setAt, t.place.lastFiredAt ?? 0);
    lastSet.set(t.place.placeId, Math.max(lastSet.get(t.place.placeId) ?? 0, used));
  }
  const wanted = places.filter((p) => lastSet.has(p.id)).sort((a, b) => lastSet.get(b.id)! - lastSet.get(a.id)!);
  return { watched: wanted.slice(0, MAX_WATCHED), overflow: new Set(wanted.slice(MAX_WATCHED).map((p) => p.id)) };
}

/** Android reports "inside" whenever the watch list is set; events this soon after are not arrivals. */
export const SETTLE_MS = 2 * 60 * 1000;

export type PlaceEvent = 'enter' | 'exit';

/** 'inside'/'outside' record where the phone now is so the next crossing counts. */
export function onPlaceEvent(
  r: PlaceReminder,
  event: PlaceEvent,
  now: number,
  watchedSince: number,
): 'fire' | 'outside' | 'inside' | 'ignore' {
  if (r.firedAt) return 'ignore';
  // Only when where the phone was is unknown. Known outside and now inside is
  // an arrival, even just after the list was set (every launch, every change):
  // otherwise opening Mnemo on arriving swallowed the reminder until the next visit.
  const settling = r.insideAtSet === undefined && now - Math.max(watchedSince, r.setAt) < SETTLE_MS;
  if (event === 'enter') {
    if (r.on === 'leave') return r.insideAtSet ? 'ignore' : 'inside';
    if (settling || r.insideAtSet) return 'inside';
    return 'fire';
  }
  if (r.on === 'arrive') return 'outside';
  if (settling || r.insideAtSet === false) return 'outside';
  return 'fire';
}

/** Like a geofence event but from the app's own fix; null unless the circle plainly contains or excludes it. */
export function onFix(r: PlaceReminder, place: Place, here: Point & { accuracy: number }): 'fire' | 'inside' | 'outside' | null {
  if (r.firedAt) return null;
  const d = distance(place, here);
  const radius = watchedRadius(place);
  const inside = d + here.accuracy <= radius;
  const outside = d - here.accuracy > radius;
  if (!inside && !outside) return null;
  if (r.insideAtSet === undefined) return inside ? 'inside' : 'outside';
  if (r.on === 'arrive') return inside ? (r.insideAtSet ? null : 'fire') : r.insideAtSet ? 'outside' : null;
  return outside ? (r.insideAtSet ? 'fire' : null) : r.insideAtSet ? null : 'inside';
}

export function caughtLate(r: PlaceReminder, place: Place, here: Point & { accuracy: number }): boolean {
  return r.insideAtSet !== undefined && onFix(r, place, here) === 'fire';
}

// ─── Repeating ──────────────────────────────────────────────────
// A crossing that would ring (onPlaceEvent / onFix said 'fire') goes through `ringNow`: a one-shot
// always rings; a repeating one only on its days and once a day, so a phone bouncing at the edge
// of the circle, or two visits in a day, ring once. Either way `afterCrossing` notes which side the
// phone is now on, so the next real crossing counts. All of it in the phone's local time.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fri–Sat weekends, by time zone (the device region, where the language often says "en-US"). */
const FRI_SAT_ZONES = new Set([
  'Asia/Dhaka', 'Asia/Riyadh', 'Asia/Kuwait', 'Asia/Qatar', 'Asia/Bahrain', 'Asia/Muscat', 'Asia/Aden', 'Asia/Amman',
  'Asia/Baghdad', 'Asia/Damascus', 'Asia/Jerusalem', 'Asia/Tel_Aviv', 'Africa/Cairo', 'Africa/Tripoli', 'Africa/Algiers',
  'Africa/Khartoum', 'Indian/Maldives',
]);
const FRI_SAT_REGIONS = new Set(['BD', 'SA', 'KW', 'QA', 'BH', 'OM', 'YE', 'JO', 'IQ', 'SY', 'IL', 'EG', 'LY', 'DZ', 'SD', 'MV']);
const ONE_DAY_WEEKEND: Record<string, number[]> = { 'Asia/Tehran': [5], IR: [5], 'Asia/Kathmandu': [6], NP: [6] };

/** The weekend's days (0 = Sunday), from the time zone, else the locale's region, else Sat–Sun. */
export function weekendDays(timeZone?: string, locale?: string): number[] {
  const region = locale?.match(/[-_]([A-Z]{2})\b/)?.[1];
  if (timeZone && ONE_DAY_WEEKEND[timeZone]) return ONE_DAY_WEEKEND[timeZone];
  if (timeZone && FRI_SAT_ZONES.has(timeZone)) return [5, 6];
  if (region && ONE_DAY_WEEKEND[region]) return ONE_DAY_WEEKEND[region];
  if (region && FRI_SAT_REGIONS.has(region)) return [5, 6];
  return [6, 0];
}

/** This phone's weekend. */
export function phoneWeekend(): number[] {
  try {
    const o = Intl.DateTimeFormat().resolvedOptions();
    return weekendDays(o.timeZone, o.locale);
  } catch {
    return [6, 0];
  }
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The week as this phone counts it: from the day after the weekend (Sunday in Bangladesh, Monday in most places). */
export function weekOrder(weekend: number[] = phoneWeekend()): number[] {
  const last = weekend.find((d) => !weekend.includes((d + 1) % 7)) ?? 6;
  return Array.from({ length: 7 }, (_, i) => (last + 1 + i) % 7);
}

/** "Mon–Fri", "Fri", "Sun, Tue, Thu": a run of days as a range, otherwise listed in the phone's week order. */
export function formatDays(days: number[], weekend: number[] = phoneWeekend()): string {
  const set = new Set(days);
  if (set.size === 0) return '';
  if (set.size === 7) return 'every day';
  // A single run (wrapping past Saturday) reads as a range.
  const start = [...set].find((d) => !set.has((d + 6) % 7));
  if (start !== undefined) {
    const run = Array.from({ length: set.size }, (_, i) => (start + i) % 7);
    if (run.every((d) => set.has(d))) {
      return run.length === 1 ? DAY_SHORT[run[0]] : `${DAY_SHORT[run[0]]}–${DAY_SHORT[run[run.length - 1]]}`;
    }
  }
  return weekOrder(weekend).filter((d) => set.has(d)).map((d) => DAY_SHORT[d]).join(', ');
}

/** "Sun–Thu" / "Fri–Sat": the days a choice covers, shown on its chip so a wrong guess is visible. */
export function repeatDays(repeat: 'weekdays' | 'weekends', weekend: number[] = phoneWeekend()): string {
  const days = repeat === 'weekends' ? weekend : [0, 1, 2, 3, 4, 5, 6].filter((d) => !weekend.includes(d));
  return formatDays(days, weekend);
}

/** A 'days' reminder's days, cleaned up (stored JSON may hold anything). None left: every day, never silence. */
export function ringDays(r: Pick<PlaceReminder, 'days'>): number[] {
  const days = [...new Set((r.days ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
  return days.length > 0 ? days : [0, 1, 2, 3, 4, 5, 6];
}

const localDay = (at: number) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** Whether a crossing that would ring rings now. */
export function ringNow(r: Pick<PlaceReminder, 'repeat' | 'lastFiredAt' | 'days'>, now: number, weekend: number[] = phoneWeekend()): boolean {
  if (!r.repeat) return true;
  if (r.lastFiredAt !== undefined && now - r.lastFiredAt < DAY_MS && localDay(r.lastFiredAt) === localDay(now)) return false;
  if (r.repeat === 'always') return true;
  if (r.repeat === 'days') return ringDays(r).includes(new Date(now).getDay());
  const isWeekend = weekend.includes(new Date(now).getDay());
  return r.repeat === 'weekends' ? isWeekend : !isWeekend;
}

/**
 * The reminder after a crossing that would ring: rung (`rang`), or held back by `ringNow`. A one-shot
 * that rang is done. A repeating one stays, on the side the phone is now on, so it rings again only
 * after the next real crossing (leave and come back, for "when I get to").
 */
export function afterCrossing(r: PlaceReminder, now: number, rang: boolean, late = false): PlaceReminder {
  const side = { insideAtSet: r.on === 'arrive' };
  if (!rang) return { ...r, ...side };
  if (!r.repeat) return { ...r, firedAt: now, ...(late ? { caughtLate: true } : {}) };
  return { ...r, ...side, lastFiredAt: now, ...(late ? { caughtLate: true } : { caughtLate: undefined }) };
}

const LEAVE = /\b(?:when(?:ever)? i leave|when i'm leaving|before i leave|after i leave|on leaving|leaving|theke ber|ber hole|ber hoye|ber hobar)\b|থেকে বের|বের হলে|বের হয়ে|বের হওয়ার|ছাড়লে|ছেড়ে যাওয়ার/i;
const ARRIVE =
  /\b(?:when(?:ever)? i (?:get|arrive|reach|am|go|'m)|when i'm|when im|once i (?:get|arrive|reach)|as soon as i (?:get|arrive|reach)|next time i'm|remind me (?:[\p{L}']+ ){0,6}?at|gele|gelei|pouchhe|pouche|pouchale|pouchaile)\b|গেলে|গেলেই|পৌঁছে|পৌঁছালে|পৌঁছাইলে/iu;

/** Endings that mean "at / in / to" in Banglish and Bangla ("bazare", "অফিসে", "বাসায়"). */
const AT_ENDINGS = ['', 'e', 'te', 'y', "'s", 's', 'ে', 'তে', 'য়', 'য়', 'র', 'ের'];

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();

function mentions(text: string, name: string): boolean {
  const n = norm(name);
  if (!n) return false;
  const t = ` ${norm(text)} `;
  return AT_ENDINGS.some((end) => t.includes(` ${n}${end} `));
}

const WEEKDAYS = /\b(?:weekdays?|workdays?|work days?|week days?)\b|কর্মদিবসে|সপ্তাহের দিনগুলোতে/i;
const WEEKENDS = /\b(?:weekends?|week ends?|on my days? off|chhutir dine)\b|ছুটির দিনে|সাপ্তাহিক ছুটিতে/i;
const EVERY_TIME =
  /\b(?:every ?time|each time|whenever|always|every day|everyday|daily|protidin|protibar|proti bar|roj)\b|প্রতিদিন|প্রতিবার|রোজ|যখনই/i;

// Day names, English, Banglish and Bangla (0 = Sunday). A day counts as "every" only when said so:
// "every Monday", "on Mondays", "প্রতি সোমবার", "proti sombar". A bare "on Monday" is one Monday.
const DAY_NAMES: [number, RegExp][] = [
  [0, /sunday|robibar|robbar|rabibar|রবিবার|রোববার/],
  [1, /monday|sombar|shombar|somobar|সোমবার/],
  [2, /tuesday|mongolbar|mangalbar|মঙ্গলবার/],
  [3, /wednesday|budhbar|budhbaar|বুধবার/],
  [4, /thursday|brihospotibar|brihaspatibar|bishudbar|বৃহস্পতিবার/],
  [5, /friday|shukrobar|sukrobar|শুক্রবার/],
  [6, /saturday|shonibar|sanibar|শনিবার/],
];
const DAY_WORD = new RegExp(`(every\\s+|proti\\s+|প্রতি\\s*)?(${DAY_NAMES.map(([, r]) => r.source).join('|')})(s)?`, 'giu');

/** The days named, when at least one is said to repeat ("every Monday and Thursday"). */
export function readPlaceDays(text: string): number[] | undefined {
  const found: { day: number; every: boolean }[] = [];
  for (const m of text.toLowerCase().matchAll(DAY_WORD)) {
    const day = DAY_NAMES.find(([, r]) => r.test(m[2]))?.[0];
    if (day !== undefined) found.push({ day, every: !!m[1] || !!m[3] });
  }
  if (!found.some((f) => f.every)) return undefined;
  return [...new Set(found.map((f) => f.day))].sort((a, b) => a - b);
}

/** "every weekday when I get to the office": how a place reminder repeats, or undefined (once). */
export function readPlaceSchedule(text: string): Pick<PlaceReminder, 'repeat' | 'days'> | undefined {
  const days = readPlaceDays(text);
  if (days) return days.length === 7 ? { repeat: 'always' } : { repeat: 'days', days };
  if (WEEKDAYS.test(text)) return { repeat: 'weekdays' };
  if (WEEKENDS.test(text)) return { repeat: 'weekends' };
  if (EVERY_TIME.test(text)) return { repeat: 'always' };
  return undefined;
}

export function readPlaceRepeat(text: string): PlaceRepeat | undefined {
  return readPlaceSchedule(text)?.repeat;
}

/** Undefined when the note names no saved place, names two, or doesn't say when. */
export function readPlaceReminder(text: string, places: Place[]): Pick<PlaceReminder, 'placeId' | 'on' | 'repeat' | 'days'> | undefined {
  if (!text.trim() || places.length === 0) return undefined;
  const leave = LEAVE.test(text);
  if (!leave && !ARRIVE.test(text)) return undefined;
  const hits = places.filter((p) => mentions(text, p.name));
  // "Office canteen" also mentions "Office": the longer name is the one meant.
  const meant = hits.filter((p) => !hits.some((q) => q !== p && norm(q.name).includes(norm(p.name))));
  if (meant.length !== 1) return undefined;
  return { placeId: meant[0].id, on: leave ? 'leave' : 'arrive', ...readPlaceSchedule(text) };
}
