import { requireOptionalNativeModule } from 'expo';
import type { LocationRegion } from 'expo-location';
import { Platform } from 'react-native';

import { asOutcome, type GeofenceOutcome } from '@/lib/geofence-outcome';

// Android: Mnemo's own geofence registration (modules/mnemo-reliability), which reports what
// Android answered. Absent on iOS, the web, Expo Go, and builds made before it existed; then
// lib/geofence.ts uses expo-location as before.

interface NativeGeofencing {
  startGeofencing(task: string, regions: LocationRegion[]): Promise<unknown>;
  stopGeofencing(task: string): Promise<void>;
  hasStartedGeofencing(task: string): boolean;
  geofenceOutcome(): unknown;
}

const mod = Platform.OS === 'android' ? requireOptionalNativeModule<Partial<NativeGeofencing>>('MnemoReliability') : null;
const native = mod && typeof mod.startGeofencing === 'function' ? (mod as NativeGeofencing) : null;

export interface Geofencing {
  start(task: string, regions: LocationRegion[]): Promise<GeofenceOutcome>;
  stop(task: string): Promise<void>;
  started(task: string): boolean;
  /** Android's last answer, stored on the phone; also the one given after a restart. */
  outcome(): GeofenceOutcome | null;
}

export const nativeGeofencing: Geofencing | null = native
  ? {
      start: async (task, regions) => asOutcome(await native.startGeofencing(task, regions)) ?? { state: 'unknown' },
      stop: (task) => native.stopGeofencing(task),
      started: (task) => {
        try {
          return native.hasStartedGeofencing(task);
        } catch {
          return false;
        }
      },
      outcome: () => {
        try {
          return asOutcome(native.geofenceOutcome());
        } catch {
          return null;
        }
      },
    }
  : null;
