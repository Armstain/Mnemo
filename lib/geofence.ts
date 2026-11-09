import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Platform } from 'react-native';
import * as Location from 'expo-location';

import { getAllItems, updatePartialItem } from '@/lib/db';
import { nativeGeofencing } from '@/lib/geofence-native';
import { outcomeProblem, outcomeReport, type GeofenceOutcome } from '@/lib/geofence-outcome';
import { logError } from '@/lib/errors';
import { loadPlaces } from '@/lib/place-store';
import { afterCrossing, isArmed, onFix, onPlaceEvent, pickWatched, placeLabel, PLACE_NOTIFICATION, ringNow, watchedRadius, type PlaceEvent } from '@/lib/places';
import { ringPlaceReminder } from '@/lib/place-sound';
import { getPreferences } from '@/lib/preferences';
import { openSettings, reminderHealth, type CheckState } from '@/lib/reliability';
import type { MnemoItem, Place, PlaceReminder } from '@/types/mnemo';

// Phone side of location reminders (rules in lib/places.ts). Background events need "all the time"
// location, and a phone may still hold one back, so opening Mnemo catches it (`catchUp`).

export const GEOFENCE_TASK = 'mnemo-geofence';
export const geofencingAvailable = Platform.OS === 'android' || Platform.OS === 'ios';

const WATCH_KEY = 'mnemo-geofence-watch';
/** The last enter/exit the background task heard (lib/geofence-task.ts), for the problem report. */
export const GEOFENCE_EVENT_KEY = 'mnemo-geofence-event';
const LATE_KEY = 'mnemo-geofence-late';

export interface Fix {
  latitude: number;
  longitude: number;
  accuracy: number;
}

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

/** Android 11+ can't ask in a dialog: it opens location settings, so the answer comes back on return. */
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

/** Throws with a sentence to show when it can't. */
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

async function lastFix(): Promise<Fix | null> {
  try {
    if (!(await Location.getForegroundPermissionsAsync()).granted) return null;
    const p = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000, requiredAccuracy: 200 });
    return p ? { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy ?? 200 } : null;
  } catch {
    return null;
  }
}

export interface PlaceHealth {
  available: boolean;
  services: CheckState;
  /** Android's network location ("Google Location Accuracy"): geofences run on it, so without it they may never fire. */
  network: CheckState;
  foreground: CheckState;
  background: CheckState;
  notifications: CheckState;
  battery: CheckState | null;
  lateAt: number | null;
  /** What Android answered when the places were last set (Android with the native registration). */
  registration: GeofenceOutcome | null;
}

export interface PlaceProblem {
  key: keyof Omit<PlaceHealth, 'available' | 'lateAt' | 'registration'> | 'late' | 'web' | 'registration';
  text: string;
  action?: string;
  fix?: () => void;
}

const LATE_MEMORY_MS = 14 * 24 * 60 * 60 * 1000;

export async function placeHealth(): Promise<PlaceHealth> {
  const late = Number(await AsyncStorage.getItem(LATE_KEY).catch(() => null)) || 0;
  const lateAt = late && Date.now() - late < LATE_MEMORY_MS ? late : null;
  if (!geofencingAvailable) {
    return { available: false, services: 'check', network: 'check', foreground: 'check', background: 'fix', notifications: 'check', battery: null, lateAt, registration: null };
  }
  const ok = (b: boolean): CheckState => (b ? 'ok' : 'fix');
  const services = await Location.hasServicesEnabledAsync().catch(() => true);
  const network =
    Platform.OS === 'android' && services
      ? await Location.getProviderStatusAsync().then((s) => s.networkAvailable !== false).catch(() => true)
      : true;
  const fg = await Location.getForegroundPermissionsAsync().catch(() => ({ granted: false }));
  const bg = await Location.getBackgroundPermissionsAsync().catch(() => ({ granted: false }));
  const r = await reminderHealth().catch(() => null);
  return {
    available: true,
    services: ok(services),
    network: ok(network),
    foreground: ok(fg.granted),
    background: ok(bg.granted),
    notifications: r?.notifications.state ?? 'check',
    battery: r?.battery ?? null,
    lateAt,
    registration: geofenceOutcome(),
  };
}

export function placeProblems(h: PlaceHealth): PlaceProblem[] {
  if (!h.available) return [{ key: 'web', text: 'Place reminders need the phone app; here places can only be saved.' }];
  const out: PlaceProblem[] = [];
  if (h.services === 'fix') {
    out.push({ key: 'services', text: 'Location is turned off on this phone.', action: 'Turn on', fix: () => Linking.openSettings().catch(() => {}) });
  }
  if (h.network === 'fix') {
    out.push({
      key: 'network',
      text: 'Google Location Accuracy is off. Android notices places with it, so without it reminders may never go off.',
      action: 'Turn on',
      fix: () => void Location.enableNetworkProviderAsync().catch(() => Linking.openSettings().catch(() => {})),
    });
  }
  if (h.foreground === 'fix' || h.background === 'fix') {
    out.push({
      key: 'background',
      text: "Mnemo can't notice places while it's closed. Allow location “All the time”.",
      action: 'Allow',
      fix: () => void allowBackground(),
    });
  }
  // What Android itself answered, unless a check above already says the same thing. This is the
  // case the checks can't see: settings that look fine and Android still saying no, or a
  // refusal after a restart while Mnemo was closed.
  const said = outcomeProblem(h.registration);
  const alreadyShown =
    said?.cause === 'accuracy' ? h.network === 'fix'
    : said?.cause === 'background' ? h.foreground === 'fix' || h.background === 'fix'
    : said?.cause === 'services' ? h.services === 'fix'
    : false;
  if (said && !alreadyShown) {
    const fix =
      said.cause === 'accuracy' ? () => void Location.enableNetworkProviderAsync().catch(() => Linking.openSettings().catch(() => {}))
      : said.cause === 'background' ? () => void allowBackground()
      : said.cause === 'services' ? () => Linking.openSettings().catch(() => {})
      : undefined;
    out.push({ key: 'registration', text: said.text, action: fix ? (said.cause === 'background' ? 'Allow' : 'Turn on') : undefined, fix });
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

interface Watch {
  signature: string;
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

export function watchList(items: MnemoItem[], places: Place[]): Location.LocationRegion[] {
  return pickWatched(items, places).watched.map((p) => ({
    identifier: p.id,
    latitude: p.latitude,
    longitude: p.longitude,
    radius: watchedRadius(p),
    notifyOnEnter: true,
    notifyOnExit: true,
  }));
}

/**
 * Android dropped the geofences ("Geofencing not available", usually location or its accuracy
 * mode turned off) and won't bring them back: forget the list, so the next sync sets it again.
 */
export async function forgetWatch(): Promise<void> {
  await AsyncStorage.setItem(WATCH_KEY, JSON.stringify({ signature: '', since: 0 })).catch(() => {});
}

async function networkLocationOn(): Promise<boolean> {
  return Location.getProviderStatusAsync()
    .then((s) => s.networkAvailable !== false)
    .catch(() => true);
}

/** Told after each registration, so screens showing Android's answer refresh (usePlaceProblems). */
const outcomeListeners = new Set<() => void>();

export function onGeofenceOutcome(listener: () => void): () => void {
  outcomeListeners.add(listener);
  return () => outcomeListeners.delete(listener);
}

/** Android's last answer to Mnemo's geofences (null without the native registration). */
export function geofenceOutcome(): GeofenceOutcome | null {
  return nativeGeofencing?.outcome() ?? null;
}

/** Phones drop geofences on restart, so the list is set again once per launch. */
let setThisLaunch = false;

/** Not set more often than needed: every new list makes the phone report "inside" again. Never asks for permission. */
export async function syncGeofences(items: MnemoItem[], places: Place[]): Promise<void> {
  if (!geofencingAvailable) return;
  try {
    const regions = getPreferences().places ? watchList(items, places) : [];
    const signature = regions.map((r) => `${r.identifier}:${r.latitude.toFixed(5)},${r.longitude.toFixed(5)},${r.radius}`).sort().join('|');
    const native = nativeGeofencing;
    // Installs from before Mnemo registered its own: expo-location holds the task. Handed over
    // once (stopped here, set below), so two registrations never watch at the same time.
    if (native && (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false))) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK).catch((e) => logError('geofence handover', e));
    }
    const started = native ? native.started(GEOFENCE_TASK) : await Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false);
    const watch = await loadWatch();
    if (regions.length === 0) {
      if (started) await (native ? native.stop(GEOFENCE_TASK) : Location.stopGeofencingAsync(GEOFENCE_TASK));
      if (watch.signature) await AsyncStorage.setItem(WATCH_KEY, JSON.stringify({ signature: '', since: 0 }));
      return;
    }
    if (started && watch.signature === signature && setThisLaunch) return;
    if (!(await Location.getBackgroundPermissionsAsync()).granted) return;
    // With location off, Android quietly sets nothing; wait until it's on (rechecked on return to the app).
    if (!(await Location.hasServicesEnabledAsync().catch(() => true))) return;
    if (native) {
      // Android's own answer decides: the list counts as set only when it said yes. Anything else
      // is retried at the next sync (a change, or coming back to Mnemo) and shown in Settings.
      const outcome = await native.start(GEOFENCE_TASK, regions);
      setThisLaunch = true;
      if (outcome.state === 'ok') {
        await AsyncStorage.setItem(WATCH_KEY, JSON.stringify({ signature, since: Date.now() }));
      } else {
        await forgetWatch();
        logError('geofence register', new Error(outcomeReport(outcome)));
      }
      outcomeListeners.forEach((l) => l());
      return;
    }
    // expo-location (iOS, and Android builds without the module) can't say whether Android
    // accepted the list, so known causes of a refusal are checked first.
    // Android geofences run on network location ("Google Location Accuracy"). Without it Play
    // Services rejects the list, and expo-location's start still resolves (it never listens for
    // the result), so a list recorded as set would never ring and never be set again this launch.
    // Not recorded: the next sync (any change, or coming back to Mnemo) tries again.
    if (Platform.OS === 'android' && !(await networkLocationOn())) {
      await forgetWatch();
      return;
    }
    await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
    setThisLaunch = true;
    await AsyncStorage.setItem(WATCH_KEY, JSON.stringify({ signature, since: Date.now() }));
  } catch (e) {
    logError('geofence sync', e);
  }
}

type Listener = (itemId: string, place: PlaceReminder) => void;
const listeners = new Set<Listener>();

export function onPlaceReminderChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function save(item: MnemoItem, place: PlaceReminder): Promise<void> {
  await updatePartialItem(item.id, { place });
  listeners.forEach((l) => l(item.id, place));
}

async function show(item: MnemoItem, placeName: string | undefined, note?: string): Promise<void> {
  const step = item.place?.step || item.nextStep;
  const where = placeLabel(item.place!, placeName ? { name: placeName } : undefined);
  await ringPlaceReminder({
    title: item.title,
    body: `${where}${note ? ` (${note})` : ''}${step ? `\nNext: ${step}` : ''}`,
    data: { itemId: item.id, kind: PLACE_NOTIFICATION },
  });
}

/** So two quick reports can't ring one reminder twice. */
const rung = new Set<string>();

/**
 * A crossing that would ring. A repeating reminder on the wrong day, or one that already rang today,
 * only notes the side the phone is on (lib/places.ts `ringNow`, `afterCrossing`). True when it rang.
 */
async function fire(item: MnemoItem, place: Place | undefined, now: number, note?: string, late = false): Promise<boolean> {
  const r = item.place!;
  const rang = ringNow(r, now);
  if (rang) {
    const key = `${item.id}:${r.setAt}:${r.lastFiredAt ?? 0}`;
    if (rung.has(key)) return false;
    rung.add(key);
    await show(item, place?.name, note);
  }
  await save(item, afterCrossing(r, now, rang, late));
  return rang;
}

/** Runs with the app closed, so it reads the threads itself. */
export async function handleGeofenceEvent(event: PlaceEvent, placeId: string, now = Date.now()): Promise<void> {
  const [items, places, watch] = await Promise.all([getAllItems(), loadPlaces(), loadWatch()]);
  const place = places.find((p) => p.id === placeId);
  for (const item of items) {
    if (!isArmed(item) || item.place.placeId !== placeId) continue;
    const action = onPlaceEvent(item.place, event, now, watch.since);
    if (action === 'fire') {
      await fire(item, place, now);
    } else if (action === 'inside' || action === 'outside') {
      const inside = action === 'inside';
      if (item.place.insideAtSet !== inside) await save(item, { ...item.place, insideAtSet: inside });
    }
  }
}

/** `opening`: the app just opened, so a ring now is one the phone should have given earlier, and it says so. */
async function applyFix(items: MnemoItem[], here: Fix, opening: boolean): Promise<void> {
  const now = Date.now();
  const places = await loadPlaces();
  const watching = opening && (await Location.getBackgroundPermissionsAsync().catch(() => ({ granted: false }))).granted;
  for (const item of items.filter(isArmed)) {
    const r = item.place as PlaceReminder;
    const place = places.find((p) => p.id === r.placeId);
    if (!place) continue;
    const action = onFix(r, place, here);
    if (action === 'inside' || action === 'outside') {
      await save(item, { ...r, insideAtSet: action === 'inside' });
    } else if (action === 'fire' && opening) {
      // Watched and still missed: the phone held it back. Unwatched: only noticeable now.
      const rang = await fire(item, place, now, watching ? 'late: your phone held it back' : 'noticed when you opened Mnemo', watching);
      if (rang && watching) await AsyncStorage.setItem(LATE_KEY, String(Date.now())).catch(() => {});
    } else if (action === 'fire') {
      await fire(item, place, now);
    }
  }
}

/** No recent position cached (common: nothing else asked for one): read one, briefly. */
async function freshFix(): Promise<Fix | null> {
  try {
    if (!(await Location.getForegroundPermissionsAsync()).granted) return null;
    const p = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000)),
    ]);
    return p ? { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy ?? 200 } : null;
  } catch {
    return null;
  }
}

export async function catchUp(items: MnemoItem[]): Promise<void> {
  if (!getPreferences().places || !items.some(isArmed)) return;
  const here = (await lastFix()) ?? (await freshFix());
  if (here) await applyFix(items, here, true);
}

/**
 * While Mnemo is open, follow the position so a reminder rings on the spot. Also with
 * "all the time": Android's geofence alerts can lag minutes, or never come. Returns the way to stop.
 */
export async function watchWhileOpen(getItems: () => MnemoItem[]): Promise<() => void> {
  if (!geofencingAvailable || !getPreferences().places) return () => {};
  try {
    if (!(await Location.getForegroundPermissionsAsync()).granted) return () => {};
    const sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, distanceInterval: 40, timeInterval: 30_000 },
      (p) => {
        const items = getItems();
        if (!items.some(isArmed)) return;
        applyFix(items, { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy ?? 200 }, false);
      },
    );
    return () => sub.remove();
  } catch {
    return () => {};
  }
}
