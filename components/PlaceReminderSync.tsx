import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { catchUp, onPlaceReminderChange, syncGeofences, watchWhileOpen } from '@/lib/geofence';
import { usePlaces } from '@/lib/place-store';
import { isArmed } from '@/lib/places';
import { usePreferences } from '@/lib/preferences';

// Edits come in bursts; set the watch list once they settle.
const SYNC_DEBOUNCE_MS = 1500;

/**
 * Invisible, at the app root next to NudgeScheduler. Keeps the phone's
 * geofences in step with the place reminders (lib/geofence.ts), brings in
 * what the background task changed, and on opening the app notes where new
 * reminders started and catches any the phone held back.
 */
export function PlaceReminderSync() {
  const { items, isLoaded, updateItem } = useMnemoStore();
  const places = usePlaces();
  // Turning place reminders on or off sets (or clears) the watch list.
  const { places: on } = usePreferences();
  const latest = useRef(items);
  latest.current = items;
  const latestPlaces = useRef(places);
  latestPlaces.current = places;

  // The background task and late catches write to the database; the store follows.
  useEffect(() => onPlaceReminderChange((id, place) => updateItem(id, { place }, { touch: false })), [updateItem]);

  useEffect(() => {
    if (!isLoaded) return;
    const handle = setTimeout(() => {
      syncGeofences(items, places);
      // A reminder just set: where is the phone now, inside the place or not?
      if (items.some((t) => isArmed(t) && t.place?.insideAtSet === undefined)) catchUp(items);
    }, SYNC_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [items, places, isLoaded, on]);

  // "All the time" is granted in a dialog or the phone's settings, after the
  // sync above already ran and found it missing (setting a reminder asks for
  // it). Nothing else changes on the way back, so without this the geofences
  // were never set until the next edit or launch, and nothing rang.
  useEffect(() => {
    if (!isLoaded) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncGeofences(latest.current, latestPlaces.current);
    });
    return () => subscription.remove();
  }, [isLoaded]);

  // On opening: one position, to catch what was missed. While open (and the
  // phone isn't watching in the background): follow the position, so a
  // reminder rings on the spot. Stopped in the background.
  const anyArmed = items.some(isArmed);
  useEffect(() => {
    if (!isLoaded || !on || !anyArmed) return;
    let stop: (() => void) | null = null;
    let live = true;
    const startWatching = () =>
      watchWhileOpen(() => latest.current).then((s) => {
        if (live && AppState.currentState === 'active') stop = s;
        else s();
      });
    catchUp(latest.current);
    startWatching();
    const subscription = AppState.addEventListener('change', (state) => {
      stop?.();
      stop = null;
      if (state === 'active') {
        catchUp(latest.current);
        // Permissions may have changed in the phone's settings meanwhile.
        startWatching();
      }
    });
    return () => {
      live = false;
      stop?.();
      subscription.remove();
    };
  }, [isLoaded, on, anyArmed]);

  return null;
}
