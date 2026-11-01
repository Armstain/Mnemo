import * as TaskManager from 'expo-task-manager';
import { GeofencingEventType, type LocationRegion } from 'expo-location';

import { GEOFENCE_TASK, handleGeofenceEvent } from '@/lib/geofence';

// Android starts Mnemo's JS in the background to run this, even with the
// app closed, so it's defined when the app's entry file loads (index.ts),
// not inside a screen.
TaskManager.defineTask<{ eventType: GeofencingEventType; region: LocationRegion }>(GEOFENCE_TASK, async ({ data, error }) => {
  if (error || !data?.region?.identifier) return;
  const event = data.eventType === GeofencingEventType.Enter ? 'enter' : data.eventType === GeofencingEventType.Exit ? 'exit' : null;
  if (!event) return;
  try {
    await handleGeofenceEvent(event, data.region.identifier);
  } catch {
    // Nothing to show from the background; Home's check catches it on opening.
  }
});
