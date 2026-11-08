import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MnemoItem, Place, PlaceReminder } from '@/types/mnemo';

// The phone side of place reminders (lib/geofence.ts), end to end below the OS: the database, the
// saved places and Android's location API are in memory; the notification is recorded. Real
// geofence delivery still needs a phone (see the manual test plan in the audit).

const db = vi.hoisted(() => ({ rows: new Map<string, string>() }));
const rang = vi.hoisted(() => [] as { title: string; body: string; data?: Record<string, unknown> }[]);
const android = vi.hoisted(() => ({
  started: false,
  regions: [] as { identifier: string; latitude: number; longitude: number; radius: number }[],
  starts: 0,
  networkAvailable: true,
  background: true,
}));
const storage = vi.hoisted(() => new Map<string, string>());
const places = vi.hoisted(() => ({ list: [] as Place[] }));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async (k: string) => storage.get(k) ?? null, setItem: async (k: string, v: string) => void storage.set(k, v) },
}));
// Rows are stored as JSON, like the SQLite `place` column: what's read back is what a restart sees.
vi.mock('@/lib/db', () => ({
  getAllItems: async () => [...db.rows.values()].map((r) => JSON.parse(r)),
  updatePartialItem: async (id: string, updates: object) => {
    const row = db.rows.get(id);
    if (row) db.rows.set(id, JSON.stringify({ ...JSON.parse(row), ...updates }));
  },
}));
vi.mock('@/lib/place-store', () => ({ loadPlaces: async () => places.list }));
vi.mock('@/lib/place-sound', () => ({ ringPlaceReminder: async (c: { title: string; body: string }) => void rang.push(c) }));
vi.mock('@/lib/preferences', () => ({ getPreferences: () => ({ places: true }) }));
vi.mock('@/lib/reliability', () => ({ openSettings: {}, reminderHealth: async () => null }));
vi.mock('@/lib/errors', () => ({ logError: () => {} }));
vi.mock('expo-location', () => ({
  Accuracy: { Balanced: 3, Highest: 6 },
  hasStartedGeofencingAsync: async () => android.started,
  stopGeofencingAsync: async () => {
    android.started = false;
    android.regions = [];
  },
  startGeofencingAsync: async (_task: string, regions: typeof android.regions) => {
    android.starts++;
    android.started = true;
    android.regions = regions;
  },
  getBackgroundPermissionsAsync: async () => ({ granted: android.background }),
  getForegroundPermissionsAsync: async () => ({ granted: true }),
  hasServicesEnabledAsync: async () => true,
  getProviderStatusAsync: async () => ({ networkAvailable: android.networkAvailable }),
}));

type Geofence = typeof import('@/lib/geofence');
let geofence: Geofence;

/** A fresh JS runtime (an app restart): module state gone, only storage and the database kept. */
async function restart(): Promise<void> {
  vi.resetModules();
  geofence = await import('@/lib/geofence');
}

const LOCATION_A: Place = { id: 'a', name: 'Location A', latitude: 23.78, longitude: 90.4, radius: 150, accuracy: 20, savedAt: 1 };
const TONGI: Place = { id: 'tongi', name: 'Tongi', latitude: 23.9, longitude: 90.41, radius: 300, accuracy: 20, savedAt: 1 };

function save(item: Partial<MnemoItem> & { id: string; place?: PlaceReminder }) {
  db.rows.set(item.id, JSON.stringify({ title: item.id, status: 'active', tags: [], ...item }));
}
const row = (id: string) => JSON.parse(db.rows.get(id)!) as MnemoItem;
const items = () => [...db.rows.values()].map((r) => JSON.parse(r) as MnemoItem);

/** 09:00 local, Monday 5 January 2026 plus `days`. */
const day = (days: number, hour = 9) => new Date(2026, 0, 5 + days, hour).getTime();

beforeEach(async () => {
  db.rows.clear();
  rang.length = 0;
  storage.clear();
  Object.assign(android, { started: false, regions: [], starts: 0, networkAvailable: true, background: true });
  places.list = [LOCATION_A, TONGI];
  // Two notes the relationship engine connected: B's note was suggested as part of A.
  save({ id: 'A', title: 'Pick up the keys', place: { placeId: 'a', on: 'arrive', setAt: 1, insideAtSet: false } });
  save({ id: 'B', title: 'Buy fabric', place: { placeId: 'tongi', on: 'arrive', setAt: 1, insideAtSet: false } });
  await restart();
});

describe('two connected place reminders stay independent', () => {
  it('both places are watched, each as its own region', async () => {
    await geofence.syncGeofences(items(), places.list);
    expect(android.regions.map((r) => r.identifier).sort()).toEqual(['a', 'tongi']);
    expect(android.regions.find((r) => r.identifier === 'tongi')?.radius).toBe(300);
  });

  it('Scenario A: arriving at Location A rings A only', async () => {
    await geofence.handleGeofenceEvent('enter', 'a', day(0));
    expect(rang.map((r) => r.title)).toEqual(['Pick up the keys']);
    expect(rang[0].data).toEqual({ itemId: 'A', kind: 'place' });
    expect(row('A').place?.firedAt).toBe(day(0));
    expect(row('B').place).toEqual({ placeId: 'tongi', on: 'arrive', setAt: 1, insideAtSet: false });
  });

  it('Scenario B: arriving at Tongi rings B only', async () => {
    await geofence.handleGeofenceEvent('enter', 'tongi', day(0));
    expect(rang.map((r) => r.title)).toEqual(['Buy fabric']);
    expect(row('A').place?.firedAt).toBeUndefined();
  });

  it('Scenario D: editing one reminder’s place leaves the other exactly as it was', async () => {
    await geofence.syncGeofences(items(), places.list);
    const before = row('A').place;
    save({ ...row('B'), place: { placeId: 'a', on: 'leave', setAt: 2 } });
    await geofence.syncGeofences(items(), places.list);
    expect(row('A').place).toEqual(before);
    // Tongi is no longer needed; Location A is watched for both.
    expect(android.regions.map((r) => r.identifier)).toEqual(['a']);
  });

  it('finishing one thread stops only its own reminder', async () => {
    save({ ...row('A'), status: 'completed' });
    await geofence.syncGeofences(items(), places.list);
    expect(android.regions.map((r) => r.identifier)).toEqual(['tongi']);
    await geofence.handleGeofenceEvent('enter', 'a', day(0));
    await geofence.handleGeofenceEvent('enter', 'tongi', day(0));
    expect(rang.map((r) => r.title)).toEqual(['Buy fabric']);
  });

  it('two reminders on the same place both ring, each once', async () => {
    save({ id: 'C', title: 'Return the book', place: { placeId: 'a', on: 'arrive', setAt: 1, insideAtSet: false } });
    await geofence.handleGeofenceEvent('enter', 'a', day(0));
    await geofence.handleGeofenceEvent('enter', 'a', day(0) + 1000);
    expect(rang.map((r) => r.title).sort()).toEqual(['Pick up the keys', 'Return the book']);
  });
});

describe('Scenario E: a restart', () => {
  it('the watch list is set again on the next launch, with both places', async () => {
    await geofence.syncGeofences(items(), places.list);
    expect(android.starts).toBe(1);
    await geofence.syncGeofences(items(), places.list);
    expect(android.starts).toBe(1); // not reset on every change: each reset makes Android report "inside" again
    await restart();
    await geofence.syncGeofences(items(), places.list);
    expect(android.starts).toBe(2);
    expect(android.regions.map((r) => r.identifier).sort()).toEqual(['a', 'tongi']);
  });

  it('a reminder state written by the background task is what the next launch reads', async () => {
    await geofence.handleGeofenceEvent('exit', 'tongi', day(0));
    await restart();
    expect(row('B').place?.insideAtSet).toBe(false);
    await geofence.handleGeofenceEvent('enter', 'tongi', day(0, 10));
    expect(rang.map((r) => r.title)).toEqual(['Buy fabric']);
  });
});

describe('registration that Android would reject is not recorded as done', () => {
  it('network location off: nothing is set, and it is set as soon as it can work', async () => {
    android.networkAvailable = false;
    await geofence.syncGeofences(items(), places.list);
    expect(android.starts).toBe(0);
    android.networkAvailable = true;
    await geofence.syncGeofences(items(), places.list);
    expect(android.starts).toBe(1);
  });

  it('without "all the time" location nothing is set, and it is retried once allowed', async () => {
    android.background = false;
    await geofence.syncGeofences(items(), places.list);
    expect(android.starts).toBe(0);
    android.background = true;
    await geofence.syncGeofences(items(), places.list);
    expect(android.starts).toBe(1);
  });

  it('Android dropping the list ("not available") makes the next sync set it again', async () => {
    await geofence.syncGeofences(items(), places.list);
    await geofence.forgetWatch();
    await geofence.syncGeofences(items(), places.list);
    expect(android.starts).toBe(2);
  });
});

describe('a weekday reminder at the office, across days, in the background', () => {
  beforeEach(() => {
    db.rows.clear();
    save({ id: 'W', title: 'Log in to the VPN', place: { placeId: 'a', on: 'arrive', repeat: 'always', setAt: 1, insideAtSet: false } });
  });

  it('rings each day, Done completes that day, the reminder stays set', async () => {
    const { completeOccurrence, occurrenceOf, isArmed } = await import('@/lib/places');
    for (const d of [0, 1, 2]) {
      await geofence.handleGeofenceEvent('enter', 'a', day(d));
      // Done from the notification (the store's completePlaceOccurrence does exactly this).
      const done = completeOccurrence(row('W').place!, day(d, 10))!;
      save({ ...row('W'), place: done });
      expect(occurrenceOf(row('W').place!, day(d, 11)).state).toBe('done');
      await geofence.handleGeofenceEvent('exit', 'a', day(d, 18));
    }
    expect(rang).toHaveLength(3);
    expect(isArmed(row('W'))).toBe(true);
    expect(row('W').place?.repeat).toBe('always');
  });

  it('a second arrival the same day does not ring again', async () => {
    await geofence.handleGeofenceEvent('enter', 'a', day(0));
    await geofence.handleGeofenceEvent('exit', 'a', day(0, 12));
    await geofence.handleGeofenceEvent('enter', 'a', day(0, 13));
    expect(rang).toHaveLength(1);
  });
});
