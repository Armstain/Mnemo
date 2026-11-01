import type { MnemoItem, Place, PlaceReminder } from '@/types/mnemo';

// Location reminders, honestly. A phone knows where it is only roughly:
// GPS indoors is often 30-100 m off, Wi-Fi and cell positions worse, and
// Android checks geofences every few minutes, not every second. So:
//
// - A place is never a circle smaller than MIN_RADIUS, nor smaller than how
//   unsure the phone was when it was saved.
// - Two places whose circles touch can't be told apart. Mnemo says so when
//   you save the second one and on every reminder that uses either, instead
//   of letting a reminder fire at the wrong one, or not at all.
// - Places a little further apart may still mix up on a poor fix: "close".
//
// Everything here is pure, so it can be tested; the phone's side (asking
// for the position, geofencing) is in lib/geofence.ts.

/**
 * Below this, Android's geofencing is unreliable (Google suggests 100-150 m
 * as the smallest practical radius); it may fire late, early, or never.
 */
export const MIN_RADIUS = 150;
/** The circles offered when saving a place. */
export const RADIUS_CHOICES = [150, 300, 500];
/** A fix this good is good. Worse than POOR_FIX, it's worth trying again. */
export const GOOD_FIX = 30;
export const POOR_FIX = 100;
/** Circles this close (edge to edge) may still be mixed up on a poor fix. */
export const CLOSE_GAP = 200;

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Metres between two points (haversine). */
export function distance(a: Pick<Place, 'latitude' | 'longitude'>, b: Pick<Place, 'latitude' | 'longitude'>): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The circle the phone actually watches: what was chosen, but never narrower than it can see. */
export function watchedRadius(place: Pick<Place, 'radius' | 'accuracy'>): number {
  return Math.round(Math.max(place.radius, MIN_RADIUS, place.accuracy));
}

export type FixQuality = 'good' | 'fair' | 'poor';

export function fixQuality(accuracy: number): FixQuality {
  return accuracy <= GOOD_FIX ? 'good' : accuracy <= POOR_FIX ? 'fair' : 'poor';
}

export type Separation = 'apart' | 'close' | 'overlap';

export interface Nearby {
  place: Place;
  /** Centre to centre. */
  meters: number;
  verdict: Exclude<Separation, 'apart'>;
}

export function separation(a: Place, b: Place): { meters: number; verdict: Separation } {
  const meters = distance(a, b);
  const gap = meters - watchedRadius(a) - watchedRadius(b);
  return { meters, verdict: gap < 0 ? 'overlap' : gap < CLOSE_GAP ? 'close' : 'apart' };
}

/** Saved places too near this one to be told apart reliably, nearest first. */
export function nearbyPlaces(place: Place, places: Place[]): Nearby[] {
  return places
    .filter((p) => p.id !== place.id)
    .map((p) => ({ place: p, ...separation(place, p) }))
    .filter((n): n is Nearby => n.verdict !== 'apart')
    .sort((a, b) => a.meters - b.meters);
}

/** "120 m", "1.4 km". */
export function formatMeters(m: number): string {
  if (m < 100) return `${Math.max(5, Math.round(m / 5) * 5)} m`;
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

/** What to tell someone about one place too near another. */
export function nearbyText(name: string, n: Nearby): string {
  const apart = formatMeters(n.meters);
  return n.verdict === 'overlap'
    ? `${name} and ${n.place.name} are ${apart} apart. Your phone can't tell them apart: a reminder for one may go off at the other, or late.`
    : `${name} and ${n.place.name} are ${apart} apart. On a weak signal your phone may mix them up.`;
}

/** What to say about the fix a place was saved with, if anything. */
export function fixText(accuracy: number): string | null {
  const q = fixQuality(accuracy);
  if (q === 'good') return null;
  if (q === 'fair') return `Located within about ${formatMeters(accuracy)}. Good enough for most places.`;
  return `Your phone could only place you within ${formatMeters(accuracy)}. Step outside or turn on Wi-Fi and try again, or the circle will be that wide.`;
}

/** A reminder still waiting to go off, on a thread that's still open. */
export function isArmed(t: Pick<MnemoItem, 'place' | 'status'>): t is Pick<MnemoItem, 'status'> & { place: PlaceReminder } {
  return !!t.place && !t.place.firedAt && (t.status === 'active' || t.status === 'paused');
}

/** "When you get to Market", "When you leave Home". */
export function placeLabel(r: Pick<PlaceReminder, 'on'>, place?: Pick<Place, 'name'>): string {
  const name = place?.name ?? 'a place no longer saved';
  return r.on === 'arrive' ? `When you get to ${name}` : `When you leave ${name}`;
}

// ─── What the phone does with an event ──────────────────────────

/** Events this soon after the watch list was set are the phone reporting where it already is. */
export const SETTLE_MS = 2 * 60 * 1000;

export type PlaceEvent = 'enter' | 'exit';

/**
 * What an enter or exit means for one reminder: fire it, note that the
 * phone is now outside (so the next arrival counts), or nothing.
 */
export function onPlaceEvent(
  r: PlaceReminder,
  event: PlaceEvent,
  now: number,
  watchedSince: number,
): 'fire' | 'outside' | 'inside' | 'ignore' {
  if (r.firedAt) return 'ignore';
  // Android reports "you're inside" right after the watch list is set.
  // That's where they already were, not an arrival.
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
 * Opening the app is a second chance: if the phone is plainly at the place
 * (or plainly gone from it) and the reminder never went off, the phone
 * held the event back. Fire it now, and say so.
 */
export function caughtLate(
  r: PlaceReminder,
  place: Place,
  here: { latitude: number; longitude: number; accuracy: number },
): boolean {
  if (r.firedAt || r.insideAtSet === undefined) return false;
  const d = distance(place, here);
  const radius = watchedRadius(place);
  if (r.on === 'arrive') return r.insideAtSet === false && d + here.accuracy <= radius;
  return r.insideAtSet === true && d - here.accuracy > radius;
}

// ─── Reading it from a note ─────────────────────────────────────
// "remind me to buy eggs when I get to the market", "bazare gele dim kinbo",
// "বাসা থেকে বের হলে চাবি নিও". English, Banglish and Bangla.

const LEAVE = /\b(?:when i leave|when i'm leaving|before i leave|after i leave|on leaving|leaving|theke ber|ber hole|ber hoye|ber hobar)\b|থেকে বের|বের হলে|বের হয়ে|বের হওয়ার|ছাড়লে|ছেড়ে যাওয়ার/i;
const ARRIVE =
  /\b(?:when i (?:get|arrive|reach|am|go|'m)|when i'm|when im|once i (?:get|arrive|reach)|as soon as i (?:get|arrive|reach)|next time i'm|remind me (?:[\p{L}']+ ){0,6}?at|gele|gelei|pouchhe|pouche|pouchale|pouchaile)\b|গেলে|গেলেই|পৌঁছে|পৌঁছালে|পৌঁছাইলে/iu;

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

/** Whether `name` starts a word in `text` ("bazar" in "bazare gele"). */
function mentions(text: string, name: string): boolean {
  const n = norm(name);
  if (!n) return false;
  const t = ` ${norm(text).replace(/[^\p{L}\p{M}\p{N}' ]+/gu, ' ')} `;
  return t.includes(` ${n}`);
}

/**
 * A saved place the note asks to be reminded at, and whether on arriving or
 * leaving. Needs both the place's name and words that say when: a note that
 * only mentions the market sets nothing.
 */
export function readPlaceReminder(text: string, places: Place[]): Pick<PlaceReminder, 'placeId' | 'on'> | undefined {
  if (!text.trim() || places.length === 0) return undefined;
  const leave = LEAVE.test(text);
  if (!leave && !ARRIVE.test(text)) return undefined;
  // Longest name first: "Office canteen" before "Office".
  const hit = [...places].sort((a, b) => b.name.length - a.name.length).find((p) => mentions(text, p.name));
  return hit ? { placeId: hit.id, on: leave ? 'leave' : 'arrive' } : undefined;
}
