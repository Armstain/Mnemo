import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Platform } from 'react-native';
import * as Location from 'expo-location';

import { getAllItems, updatePartialItem } from '@/lib/db';
import { Notifications, notificationsAvailable } from '@/lib/notifications';
import { getPlaces, loadPlaces } from '@/lib/place-store';
import { caughtLate, distance, isArmed, onPlaceEvent, placeLabel, watchedRadius, type PlaceEvent } from '@/lib/places';
import { ANDROID_CHANNEL_ID, ensureAndroidChannel, ensureReminderCategory, REMINDER_CATEGORY } from '@/lib/reminders';
import { openSettings, reminderHealth, type CheckState } from '@/lib/reliability';
import type { MnemoItem, Place, PlaceReminder } from '@/types/mnemo';

// The phone's side of location reminders (the rules are in lib/places.ts).
//
// Android watches the saved places that have a reminder waiting (a
// geofence each) and wakes Mnemo's background task on entering or leaving
// one, even with the app closed. That only works when Mnemo may use
// location "all the time", location is on, and the battery saver leaves it
// alone, so `placeHealth` checks all of that and Home says what's missing.
// When the phone holds an event back anyway, opening Mnemo catches it
// (`catchUp`) and remembers that it happened, so the warning stays honest.

export const GEOFENCE_TASK = 'mnemo-geofence';
/** Geofencing needs a phone; the web can still save places (browser location). */
export const geofencingAvailable = Platform.OS === 'android' || Platform.OS === 'ios';

const WATCH_KEY = 'mnemo-geofence-watch';
const LATE_KEY = 'mnemo-geofence-late';

export interface Fix {
  latitude: number;
  longitude: number;
  accuracy: number;
}

// ─── Where am I ─────────────────────────────────────────────────

/** Asks for location while the app is open, if it hasn't been allowed. */
export async function allowForeground(): Promise<boolean> {
  try {
    const now = await Location.getForegroundPermissionsAsync();
    if (now.granted) return true;
    if (!now.canAskAgain) return false;
    return (await Location.requestForegroundPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/**
 * Asks for "Allow all the time". Android 11+ can't ask in a dialog: it
 * opens Mnemo's location settings, so the answer comes back on return.
 */
export async function allowBackground(): Promise<boolean> {
  if (!geofencingAvailable) return false;
  if (!(await allowForeground())) return false;
  try {
    const now = await Location.getBackgroundPermissionsAsync();
    if (now.granted) return true;
    if (!now.canAskAgain) {
      Linking.openSettings().catch(() => {});
      return false;
    }
    return (await Location.requestBackgroundPermissionsAsync()).granted;
  } catch {
    Linking.openSettings().catch(() => {});
    return false;
  }
}

/** A fresh, careful fix for saving a place. Throws with a sentence to show when it can't. */
export async function locateHere(): Promise<Fix> {
  if (!(await allowForeground())) throw new Error('Mnemo needs location to save where you are.');
  if (Platform.OS !== 'web' && !(await Location.hasServicesEnabledAsync().catch(() => true))) {
    throw new Error('Location is turned off on this phone.');
  }
  const fix = await Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Couldn't get a fix in time. Try near a window or outside.")), 20_000)),
  ]);
  return { latitude: fix.coords.latitude, longitude: fix.coords.longitude, accuracy: Math.round(fix.coords.accuracy ?? 999) };
}

/** A recent position without waking the GPS, or null. */
async function lastFix(): Promise<Fix | null> {
  try {
    if (!(await Location.getForegroundPermissionsAsync()).granted) return null;
    const p = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000, requiredAccuracy: 200 });
    return p ? { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy ?? 200 } : null;
  } catch {
    return null;
  }
}

// ─── Will it work ───────────────────────────────────────────────

export interface PlaceHealth {
  /** False on the web: places can be saved, but nothing watches them. */
  available: boolean;
  services: CheckState;
  foreground: CheckState;
  /** "Allow all the time": without it, nothing fires while Mnemo is closed. */
  background: CheckState;
  notifications: CheckState;
  /** Android battery optimisation, where it can be read. */
  battery: CheckState | null;
  /** The last time a reminder had to be caught on opening Mnemo, if recent. */
  lateAt: number | null;
}

export interface PlaceProblem {
  key: keyof Omit<PlaceHealth, 'available' | 'lateAt'> | 'late' | 'web';
  text: string;
  /** Label for the button that fixes it. */
  action?: string;
  fix?: () => void;
}

/** A late catch older than this is old news. */
const LATE_MEMORY_MS = 14 * 24 * 60 * 60 * 1000;

export async function placeHealth(): Promise<PlaceHealth> {
  const late = Number(await AsyncStorage.getItem(LATE_KEY).catch(() => null)) || 0;
  const lateAt = late && Date.now() - late < LATE_MEMORY_MS ? late : null;
  if (!geofencingAvailable) {
    return { available: false, services: 'check', foreground: 'check', background: 'fix', notifications: 'check', battery: null, lateAt };
  }
  const ok = (b: boolean): CheckState => (b ? 'ok' : 'fix');
  const services = await Location.hasServicesEnabledAsync().catch(() => true);
  const fg = await Location.getForegroundPermissionsAsync().catch(() => ({ granted: false }));
  const bg = await Location.getBackgroundPermissionsAsync().catch(() => ({ granted: false }));
  const r = await reminderHealth().catch(() => null);
  return {
    available: true,
    services: ok(services),
    foreground: ok(fg.granted),
    background: ok(bg.granted),
    notifications: r?.notifications.state ?? 'check',
    battery: r?.battery ?? null,
    lateAt,
  };
}

/** What stands between a place reminder and it going off, most important first. */
export function placeProblems(h: PlaceHealth): PlaceProblem[] {
  if (!h.available) return [{ key: 'web', text: 'Place reminders need the phone app; here places can only be saved.' }];
  const out: PlaceProblem[] = [];
  if (h.services === 'fix') {
    out.push({ key: 'services', text: 'Location is turned off on this phone.', action: 'Turn on', fix: () => Linking.openSettings().catch(() => {}) });
  }
  if (h.foreground === 'fix' || h.background === 'fix') {
    out.push({
      key: 'background',
      text: "Mnemo can't see you arrive while it's closed. Allow location “All the time”.",
      action: 'Allow',
      fix: () => void allowBackground(),
    });
  }
  if (h.notifications === 'fix') {
    out.push({ key: 'notifications', text: "Notifications are off, so a reminder can't show.", action: 'Allow', fix: openSettings.notifications });
  }
  if (h.battery === 'fix') {
    out.push({ key: 'battery', text: 'The battery saver can stop Mnemo noticing places.', action: 'Fix', fix: openSettings.battery });
  }
  if (h.lateAt) {
    out.push({
      key: 'late',
      text: "A place reminder went off late: your phone didn't tell Mnemo, so it was caught when you opened the app.",
      action: h.battery ? 'Battery' : undefined,
      fix: h.battery ? openSettings.battery : undefined,
    });
  }
  return out;
}

// ─── Watching places ────────────────────────────────────────────

interface Watch {
  /** Which circles are watched, so an unchanged list isn't set again. */
  signature: string;
  /** When the list was last set: events just after are "where you already are". */
  since: number;
}

async function loadWatch(): Promise<Watch> {
  try {
    const raw = await AsyncStorage.getItem(WATCH_KEY);
    const w = raw ? JSON.parse(raw) : null;
    return { signature: String(w?.signature ?? ''), since: Number(w?.since) || 0 };
  } catch {
    return { signature: '', since: 0 };
  }
}

/** The circles to watch: each saved place some open reminder is waiting on. */
export function watchList(items: MnemoItem[], places: Place[]): Location.LocationRegion[] {
  const wanted = new Set(items.filter(isArmed).map((t) => t.place!.placeId));
  return places
    .filter((p) => wanted.has(p.id))
    .map((p) => ({ identifier: p.id, latitude: p.latitude, longitude: p.longitude, radius: watchedRadius(p), notifyOnEnter: true, notifyOnExit: true }));
}

/**
 * Keeps Android's geofences in step with the reminders. Sets them only when
 * the list changes: every new list makes the phone report "inside" again.
 * Never asks for permission (setting a reminder does).
 */
export async function syncGeofences(items: MnemoItem[], places: Place[]): Promise<void> {
  if (!geofencingAvailable) return;
  try {
    const regions = watchList(items, places);
    const signature = regions.map((r) => `${r.identifier}:${r.latitude.toFixed(5)},${r.longitude.toFixed(5)},${r.radius}`).sort().join('|');
    const started = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false);
    const watch = await loadWatch();
    if (regions.length === 0) {
      if (started) await Location.stopGeofencingAsync(GEOFENCE_TASK);
      if (watch.signature) await AsyncStorage.setItem(WATCH_KEY, JSON.stringify({ signature: '', since: 0 }));
      return;
    }
    if (started && watch.signature === signature) return;
    if (!(await Location.getBackgroundPermissionsAsync()).granted) return;
    await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
    await AsyncStorage.setItem(WATCH_KEY, JSON.stringify({ signature, since: Date.now() }));
  } catch {
    // Best-effort like every reminder; placeHealth says what's wrong.
  }
}

// ─── When a reminder goes off ───────────────────────────────────

type Listener = (itemId: string, place: PlaceReminder) => void;
const listeners = new Set<Listener>();

/** A thread's place reminder changed outside the store (the background task, a late catch). */
export function onPlaceReminderChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function save(item: MnemoItem, place: PlaceReminder): Promise<void> {
  await updatePartialItem(item.id, { place });
  listeners.forEach((l) => l(item.id, place));
}

async function show(item: MnemoItem, placeName: string | undefined, late: boolean): Promise<void> {
  if (!notificationsAvailable) return;
  const step = item.place?.step || item.nextStep;
  const where = placeLabel(item.place!, placeName ? { name: placeName } : undefined);
  await ensureAndroidChannel();
  await ensureReminderCategory();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: item.title,
      body: `${where}${late ? ' (late: your phone held it back)' : ''}${step ? `\nNext: ${step}` : ''}`,
      data: { itemId: item.id },
      categoryIdentifier: REMINDER_CATEGORY,
    },
    trigger: Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : null,
  });
}

/**
 * The background task's work: Android says the phone entered or left a
 * watched place. Runs with the app closed, so it reads the threads itself.
 */
export async function handleGeofenceEvent(event: PlaceEvent, placeId: string, now = Date.now()): Promise<void> {
  const [items, places, watch] = await Promise.all([getAllItems(), loadPlaces(), loadWatch()]);
  const place = places.find((p) => p.id === placeId);
  for (const item of items) {
    if (!isArmed(item) || item.place.placeId !== placeId) continue;
    const action = onPlaceEvent(item.place, event, now, watch.since);
    if (action === 'fire') {
      await show(item, place?.name, false);
      await save(item, { ...item.place, firedAt: now });
    } else if (action === 'inside' || action === 'outside') {
      const inside = action === 'inside';
      if (item.place.insideAtSet !== inside) await save(item, { ...item.place, insideAtSet: inside });
    }
  }
}

/**
 * When Mnemo opens: note where newly set reminders started (inside the place
 * or not), and fire any the phone plainly should have already, saying so.
 */
export async function catchUp(items: MnemoItem[]): Promise<void> {
  const armed = items.filter(isArmed);
  if (armed.length === 0) return;
  const here = await lastFix();
  if (!here) return;
  const places = getPlaces().length ? getPlaces() : await loadPlaces();
  for (const item of armed) {
    const r = item.place as PlaceReminder;
    const place = places.find((p) => p.id === r.placeId);
    if (!place) continue;
    if (r.insideAtSet === undefined) {
      // Only when the fix is clear either way; otherwise ask again next time.
      const d = distance(place, here);
      const radius = watchedRadius(place);
      if (d + here.accuracy <= radius) await save(item, { ...r, insideAtSet: true });
      else if (d - here.accuracy > radius) await save(item, { ...r, insideAtSet: false });
      continue;
    }
    if (caughtLate(r, place, here)) {
      await show(item, place.name, true);
      await save(item, { ...r, firedAt: Date.now(), caughtLate: true });
      await AsyncStorage.setItem(LATE_KEY, String(Date.now())).catch(() => {});
    }
  }
}
