import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import type { Place } from '@/types/mnemo';

// Saved places live on the phone only, in their own small store: a handful
// of named points. Not in backups for now (a home's coordinates are about
// as private as it gets); a thread pointing at a place that isn't saved
// says so instead of silently never firing.

const KEY = 'mnemo-places';
let places: Place[] = [];
let loaded: Promise<Place[]> | null = null;
const listeners = new Set<(p: Place[]) => void>();

function valid(p: unknown): p is Place {
  const x = p as Place;
  return (
    !!x &&
    typeof x.id === 'string' &&
    typeof x.name === 'string' &&
    [x.latitude, x.longitude, x.radius, x.accuracy].every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

/** Reads the saved places once; later calls get the same answer. */
export function loadPlaces(): Promise<Place[]> {
  if (!loaded) {
    loaded = AsyncStorage.getItem(KEY)
      .then((raw) => {
        const parsed = raw ? JSON.parse(raw) : [];
        places = Array.isArray(parsed) ? parsed.filter(valid) : [];
        return places;
      })
      .catch(() => places);
  }
  return loaded;
}

/** The places as last loaded; [] until loadPlaces resolves. */
export function getPlaces(): Place[] {
  return places;
}

async function commit(next: Place[]): Promise<void> {
  places = next;
  listeners.forEach((l) => l(next));
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
}

export async function savePlace(place: Place): Promise<void> {
  await loadPlaces();
  await commit([...places.filter((p) => p.id !== place.id), place]);
}

export async function removePlace(id: string): Promise<void> {
  await loadPlaces();
  await commit(places.filter((p) => p.id !== id));
}

/** "Clear all data" takes places too. */
export async function removeAllPlaces(): Promise<void> {
  await commit([]);
}

/** The saved places, kept current. */
export function usePlaces(): Place[] {
  const [list, setList] = useState<Place[]>(places);
  useEffect(() => {
    listeners.add(setList);
    loadPlaces().then(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);
  return list;
}
