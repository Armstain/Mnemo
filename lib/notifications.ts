import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

// Since SDK 55, merely importing expo-notifications in Expo Go on Android
// throws, which takes down every route that imports it. There, reminders and
// nudges are simply off; a development build has them.
export const notificationsAvailable = !(
  Platform.OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient
);

// Typed as always present on purpose: every use in lib/reminders.ts and
// lib/nudges.ts runs inside try/catch, so the null case fails silently there.
// Code outside those must check notificationsAvailable first.
export const Notifications: typeof import('expo-notifications') = notificationsAvailable
  ? require('expo-notifications')
  : (null as never);
