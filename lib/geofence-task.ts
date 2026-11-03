import AsyncStorage from '@react-native-async-storage/async-storage';
import * as TaskManager from 'expo-task-manager';
import { GeofencingEventType, type LocationRegion } from 'expo-location';

import { logError } from '@/lib/errors';
import { GEOFENCE_EVENT_KEY, GEOFENCE_TASK, handleGeofenceEvent } from '@/lib/geofence';

// Android starts Mnemo's JS in the background to run this, even with the
// app closed, so it's defined when the app's entry file loads (index.ts),
// not inside a screen.
TaskManager.defineTask<{ eventType: GeofencingEventType; region: LocationRegion }>(GEOFENCE_TASK, async ({ data, error }) => {
  // Android's own errors, e.g. "Geofencing not available." when Google location accuracy is off.
  if (error) return logError('geofence task', error);
  if (!data?.region?.identifier) return;
  const event = data.eventType === GeofencingEventType.Enter ? 'enter' : data.eventType === GeofencingEventType.Exit ? 'exit' : null;
  if (!event) return;
  // The last event heard, for the problem report: whether the phone ever tells Mnemo anything.
  await AsyncStorage.setItem(GEOFENCE_EVENT_KEY, JSON.stringify({ at: Date.now(), event })).catch(() => {});
  try {
    await handleGeofenceEvent(event, data.region.identifier);
  } catch (e) {
    // Nothing to show from the background; Home's check catches it on opening.
    logError('geofence event', e);
  }
});
