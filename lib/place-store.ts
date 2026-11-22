import { useEffect, useState } from 'react';

import { createEmitter } from '@/lib/emitter';
import { storage, writeJson } from '@/lib/storage';
import type { Place } from '@/types/mnemo';

// Saved places live on the phone only, in their own small store: a handful
// of named points. Not in backups for now (a home's coordinates are about
// as private as it gets); a thread pointing at a place that isn't saved
// says so instead of silently never firing.

const KEY = 'mnemo-places';
let places: Place[] = [];
let loaded: Promise<void> | null = null;
let readFailed = false;
const changes = createEmitter<Place[]>();

function valid(p: unknown): p is Place {
  const x = p as Place;
  return (
    !!x &&
    typeof x.id === 'string' &&
    typeof x.name === 'string' &&
    [x.latitude, x.longitude, x.radius, x.accuracy].every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

async function read(): Promise<void> {
  let raw: string | null;
  try {
    raw = await storage.get(KEY);
  } catch {
    readFailed = true;
    return;
  }
  readFailed = false;
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : [];
  } catch {
    parsed = [];
  }
  places = Array.isArray(parsed) ? parsed.filter(valid) : [];
}

/**
 * The saved places, read from storage once. Always resolves to the list as
 * it is now: the first read is cached, not its result, so a screen opened
 * after a place was added or removed never sees the list as it was at launch.
 */
export function loadPlaces(): Promise<Place[]> {
  if (!loaded) loaded = read();
  return loaded.then(() => places);
}

/** [] until loadPlaces resolves. */
export function getPlaces(): Place[] {
  return places;
}

async function commit(next: Place[]): Promise<void> {
  places = next;
  changes.emit(next);
  await writeJson(KEY, next);
}

async function loadForWrite(): Promise<void> {
  await loadPlaces();
  if (!readFailed) return;
  loaded = null;
  await loadPlaces();
  if (readFailed) throw new Error("Saved places couldn't be read, so they were left as they are.");
}

export async function savePlace(place: Place): Promise<void> {
  await loadForWrite();
  await commit([...places.filter((p) => p.id !== place.id), place]);
}

export async function removePlace(id: string): Promise<void> {
  await loadForWrite();
  await commit(places.filter((p) => p.id !== id));
}

export async function removeAllPlaces(): Promise<void> {
  await commit([]);
}

export function usePlaces(): Place[] {
  const [list, setList] = useState<Place[]>(places);
  useEffect(() => {
    const off = changes.on(setList);
    loadPlaces().then(setList);
    return off;
  }, []);
  return list;
}
