import type { MnemoItem, Place, PlaceReminder } from '@/types/mnemo';

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

export function placeLabel(r: Pick<PlaceReminder, 'on'>, place?: Pick<Place, 'name'>): string {
  const name = place?.name ?? 'a place no longer saved';
  return r.on === 'arrive' ? `When you get to ${name}` : `When you leave ${name}`;
}

/** Most recently set reminders win the MAX_WATCHED slots; the rest are `overflow`. */
export function pickWatched(items: Pick<MnemoItem, 'place' | 'status'>[], places: Place[]): { watched: Place[]; overflow: Set<string> } {
  const lastSet = new Map<string, number>();
  for (const t of items) {
    if (!isArmed(t)) continue;
    lastSet.set(t.place.placeId, Math.max(lastSet.get(t.place.placeId) ?? 0, t.place.setAt));
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

const LEAVE = /\b(?:when i leave|when i'm leaving|before i leave|after i leave|on leaving|leaving|theke ber|ber hole|ber hoye|ber hobar)\b|থেকে বের|বের হলে|বের হয়ে|বের হওয়ার|ছাড়লে|ছেড়ে যাওয়ার/i;
const ARRIVE =
  /\b(?:when i (?:get|arrive|reach|am|go|'m)|when i'm|when im|once i (?:get|arrive|reach)|as soon as i (?:get|arrive|reach)|next time i'm|remind me (?:[\p{L}']+ ){0,6}?at|gele|gelei|pouchhe|pouche|pouchale|pouchaile)\b|গেলে|গেলেই|পৌঁছে|পৌঁছালে|পৌঁছাইলে/iu;

/** Endings that mean "at / in / to" in Banglish and Bangla ("bazare", "অফিসে", "বাসায়"). */
const AT_ENDINGS = ['', 'e', 'te', 'y', "'s", 's', 'ে', 'তে', 'য়', 'য়', 'র', 'ের'];

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();

function mentions(text: string, name: string): boolean {
  const n = norm(name);
  if (!n) return false;
  const t = ` ${norm(text)} `;
  return AT_ENDINGS.some((end) => t.includes(` ${n}${end} `));
}

/** Undefined when the note names no saved place, names two, or doesn't say when. */
export function readPlaceReminder(text: string, places: Place[]): Pick<PlaceReminder, 'placeId' | 'on'> | undefined {
  if (!text.trim() || places.length === 0) return undefined;
  const leave = LEAVE.test(text);
  if (!leave && !ARRIVE.test(text)) return undefined;
  const hits = places.filter((p) => mentions(text, p.name));
  // "Office canteen" also mentions "Office": the longer name is the one meant.
  const meant = hits.filter((p) => !hits.some((q) => q !== p && norm(q.name).includes(norm(p.name))));
  return meant.length === 1 ? { placeId: meant[0].id, on: leave ? 'leave' : 'arrive' } : undefined;
}
