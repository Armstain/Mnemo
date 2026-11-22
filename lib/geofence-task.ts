import * as TaskManager from 'expo-task-manager';
import { GeofencingEventType, type LocationRegion } from 'expo-location';

import { logError } from '@/lib/errors';
import { forgetWatch, GEOFENCE_EVENT_KEY, GEOFENCE_TASK, handleGeofenceEvent } from '@/lib/geofence';
import { writeJson } from '@/lib/storage';

// Android starts Mnemo's JS in the background to run this, even with the
// app closed, so it's defined when the app's entry file loads (index.ts),
// not inside a screen.
TaskManager.defineTask<{ eventType: GeofencingEventType; region: LocationRegion }>(GEOFENCE_TASK, async ({ data, error }) => {
  // Android's own errors, e.g. "Geofencing not available." when Google location accuracy is off.
  // Android drops every geofence then (Google's docs say to add them again), so the next sync does.
  if (error) {
    logError('geofence task', error);
    if (/not available/i.test(error.message)) await forgetWatch();
    return;
  }
  if (!data?.region?.identifier) return;
  const event = data.eventType === GeofencingEventType.Enter ? 'enter' : data.eventType === GeofencingEventType.Exit ? 'exit' : null;
  if (!event) return;
  await writeJson(GEOFENCE_EVENT_KEY, { at: Date.now(), event }).catch(() => {});
  try {
    await handleGeofenceEvent(event, data.region.identifier);
  } catch (e) {
    // Nothing to show from the background; Home's check catches it on opening.
    logError('geofence event', e);
  }
});
