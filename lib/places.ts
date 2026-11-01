import type { MnemoItem, Place, PlaceReminder } from '@/types/mnemo';

// Place reminders. One idea carries all of it: a place is a circle, and
// anywhere inside the circle counts as being there. A phone only knows
// roughly where it is, so the circle is never smaller than MIN_RADIUS
// (nor than how unsure the phone was, when saved from where you stood).
//
// Everything that can go wrong, and what Mnemo does about it:
//
// Said to the person (never silent):
//  1. Two saved circles overlap: being in one can count as being in the
//     other. Shown on the map while placing a pin, under the place, on the
//     thread, and on Home while a reminder relies on it.
//  2. Saved from where you stood with a poor fix: the circle grows to the
//     fix's size, and it says so.
//  3. The phone won't let Mnemo watch: location off, not allowed "all the
//     time", notifications off, battery saver (lib/geofence.ts).
//  4. The phone held an event back: caught when Mnemo opens, marked late,
//     and Home keeps a warning for a while.
//  5. More places waiting than a phone will watch (MAX_WATCHED): the
//     nearest-set ones are watched, and the rest say so.
//  6. A reminder whose place was removed: says it can't go off.
//
// Handled quietly, because there's one right answer:
//  7. Set while already inside: arriving only counts after leaving first,
//     leaving only once inside.
//  8. Android reports "inside" again whenever the watch list is set; that
//     isn't an arrival (SETTLE_MS).
//  9. The phone forgets its watch list on restart: set again each launch.
// 10. A place moved or resized: its reminders forget where the phone was.
// 11. A note naming two saved places: no guess, nothing set.
// 12. Names match whole words only ("Office" isn't in "officer"), with the
//     Bangla endings that mean "at" ("বাসায়", "bazare").
// 13. Two places with the same name: not allowed.
// 14. A thread done, archived or deleted: its reminder never goes off.
// 15. Location reminders turned off: nothing is watched or shown, and
//     nothing is asked; reminders wait until it's on again.
//
// Pure, so it's all tested; the phone's side is lib/geofence.ts.

/** Smaller than this, phones fire late, early, or not at all. */
export const MIN_RADIUS = 150;
/** The circle sizes offered. */
export const RADIUS_CHOICES = [150, 300, 500];
/** A fix worse than this widens the circle, and is worth saying. */
export const POOR_FIX = 100;
/** iOS watches at most 20 places per app (Android 100); one limit for both. */
export const MAX_WATCHED = 20;

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

type Point = Pick<Place, 'latitude' | 'longitude'>;

/** Metres between two points (haversine). */
export function distance(a: Point, b: Point): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The circle that's actually watched: as chosen, but never narrower than the phone can see. */
export function watchedRadius(place: Pick<Place, 'radius' | 'accuracy'>): number {
  return Math.round(Math.max(place.radius, MIN_RADIUS, place.accuracy));
}

/** "15 m", "250 m", "1.4 km". */
export function formatMeters(m: number): string {
  if (m < 100) return `${Math.max(5, Math.round(m / 5) * 5)} m`;
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

// ─── The one warning about places ───────────────────────────────

/** Other saved places whose circles overlap this one's, nearest first. */
export function overlaps(place: Place, places: Place[]): Place[] {
  return places
    .filter((p) => p.id !== place.id && distance(place, p) < watchedRadius(place) + watchedRadius(p))
    .sort((a, b) => distance(place, a) - distance(place, b));
}

/** "Its circle overlaps Home and Gym: being at one can count as being at the other." */
export function overlapText(others: Pick<Place, 'name'>[]): string | null {
  if (others.length === 0) return null;
  const names = others.map((o) => o.name);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Its circle overlaps ${list}. Being at one can count as being at ${others.length === 1 ? 'the other' : 'another'}.`;
}

/** Only a poor fix is worth a word: the circle had to grow to it. */
export function fixText(accuracy: number): string | null {
  return accuracy > POOR_FIX
    ? `Your phone could only tell where you are to within ${formatMeters(accuracy)}, so the circle is that wide. Try again outside or with Wi-Fi on, or drop the pin yourself.`
    : null;
}

/** Why a name can't be used, or null. */
export function nameProblem(name: string, places: Place[], id?: string): string | null {
  const n = name.trim().toLowerCase();
  if (!n) return 'Give it a name.';
  if (places.some((p) => p.id !== id && p.name.trim().toLowerCase() === n)) return 'You already have a place with that name.';
  return null;
}

/** Whether a change to a place moves or resizes its circle (its reminders then start over). */
export function circleChanged(a: Place, b: Place): boolean {
  return a.latitude !== b.latitude || a.longitude !== b.longitude || watchedRadius(a) !== watchedRadius(b);
}

// ─── Reminders ──────────────────────────────────────────────────

/** A reminder still waiting to go off, on a thread that's still open. */
export function isArmed(t: Pick<MnemoItem, 'place' | 'status'>): t is Pick<MnemoItem, 'status'> & { place: PlaceReminder } {
  return !!t.place && !t.place.firedAt && (t.status === 'active' || t.status === 'paused');
}

/** "When you get to Gym", "When you leave Home". */
export function placeLabel(r: Pick<PlaceReminder, 'on'>, place?: Pick<Place, 'name'>): string {
  const name = place?.name ?? 'a place no longer saved';
  return r.on === 'arrive' ? `When you get to ${name}` : `When you leave ${name}`;
}

/**
 * Which places to watch, at most MAX_WATCHED: those with the most recently
 * set reminder first. The rest are `overflow`, and their reminders say so.
 */
export function pickWatched(items: Pick<MnemoItem, 'place' | 'status'>[], places: Place[]): { watched: Place[]; overflow: Set<string> } {
  const lastSet = new Map<string, number>();
  for (const t of items) {
    if (!isArmed(t)) continue;
    lastSet.set(t.place.placeId, Math.max(lastSet.get(t.place.placeId) ?? 0, t.place.setAt));
  }
  const wanted = places.filter((p) => lastSet.has(p.id)).sort((a, b) => lastSet.get(b.id)! - lastSet.get(a.id)!);
  return { watched: wanted.slice(0, MAX_WATCHED), overflow: new Set(wanted.slice(MAX_WATCHED).map((p) => p.id)) };
}

// ─── What the phone does with an event ──────────────────────────

/** Events this soon after the watch list was set are the phone reporting where it already is. */
export const SETTLE_MS = 2 * 60 * 1000;

export type PlaceEvent = 'enter' | 'exit';

/**
 * What an enter or exit means for one reminder: fire it, note where the
 * phone now is (so the next crossing counts), or nothing.
 */
export function onPlaceEvent(
  r: PlaceReminder,
  event: PlaceEvent,
  now: number,
  watchedSince: number,
): 'fire' | 'outside' | 'inside' | 'ignore' {
  if (r.firedAt) return 'ignore';
  const settling = now - Math.max(watchedSince, r.setAt) < SETTLE_MS;
  if (event === 'enter') {
    if (r.on === 'leave') return r.insideAtSet ? 'ignore' : 'inside';
    if (settling || r.insideAtSet) return 'inside';
    return 'fire';
  }
  if (r.on === 'arrive') return 'outside';
  if (settling || r.insideAtSet === false) return 'outside';
  return 'fire';
}

/**
 * Opening the app is a second chance: if the phone is plainly inside the
 * circle (or plainly out of it) and the reminder never went off, the phone
 * held the event back. Fire it now, and say so.
 */
export function caughtLate(r: PlaceReminder, place: Place, here: Point & { accuracy: number }): boolean {
  if (r.firedAt || r.insideAtSet === undefined) return false;
  const d = distance(place, here);
  const radius = watchedRadius(place);
  if (r.on === 'arrive') return r.insideAtSet === false && d + here.accuracy <= radius;
  return r.insideAtSet === true && d - here.accuracy > radius;
}

// ─── Reading it from a note ─────────────────────────────────────
// "when I get to <place>", "when I leave <place>", "<place>-e gele",
// "<place> থেকে বের হলে". English, Banglish and Bangla. Needs a saved
// place's name and words that say when; anything less sets nothing.

const LEAVE = /\b(?:when i leave|when i'm leaving|before i leave|after i leave|on leaving|leaving|theke ber|ber hole|ber hoye|ber hobar)\b|থেকে বের|বের হলে|বের হয়ে|বের হওয়ার|ছাড়লে|ছেড়ে যাওয়ার/i;
const ARRIVE =
  /\b(?:when i (?:get|arrive|reach|am|go|'m)|when i'm|when im|once i (?:get|arrive|reach)|as soon as i (?:get|arrive|reach)|next time i'm|remind me (?:[\p{L}']+ ){0,6}?at|gele|gelei|pouchhe|pouche|pouchale|pouchaile)\b|গেলে|গেলেই|পৌঁছে|পৌঁছালে|পৌঁছাইলে/iu;

/** Endings that mean "at / in / to" in Banglish and Bangla ("bazare", "অফিসে", "বাসায়"). */
const AT_ENDINGS = ['', 'e', 'te', 'y', "'s", 's', 'ে', 'তে', 'য়', 'য়', 'র', 'ের'];

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** Whether `name` appears in `text` as whole words, allowing an "at" ending. */
function mentions(text: string, name: string): boolean {
  const n = norm(name);
  if (!n) return false;
  const t = ` ${norm(text)} `;
  return AT_ENDINGS.some((end) => t.includes(` ${n}${end} `));
}

/**
 * The saved place a note asks to be reminded at, and whether on arriving
 * or leaving. Nothing when it names no saved place, names two, or doesn't
 * say when.
 */
export function readPlaceReminder(text: string, places: Place[]): Pick<PlaceReminder, 'placeId' | 'on'> | undefined {
  if (!text.trim() || places.length === 0) return undefined;
  const leave = LEAVE.test(text);
  if (!leave && !ARRIVE.test(text)) return undefined;
  const hits = places.filter((p) => mentions(text, p.name));
  // "Office canteen" also mentions "Office": the longer name is the one meant.
  const meant = hits.filter((p) => !hits.some((q) => q !== p && norm(q.name).includes(norm(p.name))));
  return meant.length === 1 ? { placeId: meant[0].id, on: leave ? 'leave' : 'arrive' } : undefined;
}
