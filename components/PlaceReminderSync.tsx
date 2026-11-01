import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { catchUp, onPlaceReminderChange, syncGeofences } from '@/lib/geofence';
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

  useEffect(() => {
    if (!isLoaded) return;
    catchUp(latest.current);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') catchUp(latest.current);
    });
    return () => subscription.remove();
  }, [isLoaded]);

  return null;
}
