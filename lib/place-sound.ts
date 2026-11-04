import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Linking, Platform } from 'react-native';

import { Notifications, notificationsAvailable } from '@/lib/notifications';
import { ensureReminderCategory, REMINDER_CATEGORY } from '@/lib/reminders';

// What a place reminder sounds like. It goes off when you're walking in
// somewhere, phone in a pocket, so it rings: its own channel at the
// highest importance, a real sound and a long buzz, shown on the lock
// screen.
//
// Android fixes a channel's sound when the channel is made, so each choice
// is its own channel, and the ones not in use are removed. "Your own
// ringtone" is a channel left on the phone's default sound for the person
// to change in Android's settings, which offer every ringtone on the
// phone; it's kept, so their pick stays.

export type PlaceSound = 'chime' | 'bells' | 'rise' | 'default' | 'custom';

export const PLACE_SOUNDS: { key: PlaceSound; label: string; file?: string }[] = [
  { key: 'chime', label: 'Chime', file: 'mnemo_chime.wav' },
  { key: 'bells', label: 'Bells', file: 'mnemo_bells.wav' },
  { key: 'rise', label: 'Rise', file: 'mnemo_rise.wav' },
  { key: 'default', label: "Phone's sound" },
  // Only Android lets an app send someone to pick any ringtone for it.
  ...(Platform.OS === 'android' ? [{ key: 'custom' as const, label: 'Your own…' }] : []),
];

export const DEFAULT_PLACE_SOUND: PlaceSound = 'chime';

// Android brings a deleted channel back with its old settings, sound included, when the same id is
// made again, so a channel first made with the default sound kept it however it was set after. New ids
// (bump CHANNEL_VERSION when a channel's sound or importance changes), and the old ones are removed.
const CHANNEL_VERSION = 2;
const channelId = (s: PlaceSound) => `place-${s}-v${CHANNEL_VERSION}`;
const OLD_CHANNEL_IDS = PLACE_SOUNDS.map((p) => `place-${p.key}`);
const LONG_BUZZ = [0, 500, 250, 500, 250, 500];

/**
 * The chosen sound, read from storage: the background task runs before the
 * app's preferences are loaded, so it can't ask them.
 */
export async function readPlaceSound(): Promise<PlaceSound> {
  try {
    const raw = Platform.OS === 'web' ? localStorage.getItem('mnemo-preferences') : await AsyncStorage.getItem('mnemo-preferences');
    const s = raw ? JSON.parse(raw)?.placeSound : undefined;
    return PLACE_SOUNDS.some((p) => p.key === s) ? (s as PlaceSound) : DEFAULT_PLACE_SOUND;
  } catch {
    return DEFAULT_PLACE_SOUND;
  }
}

/** Makes the channel for this sound (Android), and tidies away the unused ones. */
export async function ensurePlaceChannel(sound: PlaceSound): Promise<string> {
  const id = channelId(sound);
  if (Platform.OS !== 'android') return id;
  const file = PLACE_SOUNDS.find((p) => p.key === sound)?.file;
  await Notifications.setNotificationChannelAsync(id, {
    name: sound === 'custom' ? 'Place reminders (your ringtone)' : 'Place reminders',
    description: 'When you arrive at or leave a place you saved',
    importance: Notifications.AndroidImportance.MAX,
    sound: file ?? 'default',
    vibrationPattern: LONG_BUZZ,
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    audioAttributes: { usage: Notifications.AndroidAudioUsage.NOTIFICATION_RINGTONE },
  });
  for (const other of PLACE_SOUNDS) {
    if (other.key !== sound && other.key !== 'custom') await Notifications.deleteNotificationChannelAsync(channelId(other.key)).catch(() => {});
  }
  for (const old of OLD_CHANNEL_IDS) await Notifications.deleteNotificationChannelAsync(old).catch(() => {});
  return id;
}

/** Rings now: a place reminder, or the test from Settings. */
export async function ringPlaceReminder(content: { title: string; body: string; data?: Record<string, unknown> }, sound?: PlaceSound): Promise<void> {
  if (!notificationsAvailable) return;
  const chosen = sound ?? (await readPlaceSound());
  const channel = await ensurePlaceChannel(chosen);
  await ensureReminderCategory();
  const file = PLACE_SOUNDS.find((p) => p.key === chosen)?.file;
  await Notifications.scheduleNotificationAsync({
    content: {
      ...content,
      categoryIdentifier: REMINDER_CATEGORY,
      // iOS plays the file; Android plays the channel's sound.
      sound: file ?? 'default',
      priority: Notifications.AndroidNotificationPriority.MAX,
      vibrate: LONG_BUZZ,
    },
    trigger: Platform.OS === 'android' ? { channelId: channel } : null,
  });
}

/**
 * Opens Android's settings for the "your own ringtone" channel, where any
 * ringtone on the phone can be picked. Falls back to the app's settings.
 */
export async function chooseOwnRingtone(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const id = await ensurePlaceChannel('custom');
    const pkg = Constants.expoConfig?.android?.package ?? 'com.mnemo.app';
    await Linking.sendIntent('android.settings.CHANNEL_NOTIFICATION_SETTINGS', [
      { key: 'android.provider.extra.APP_PACKAGE', value: pkg },
      { key: 'android.provider.extra.CHANNEL_ID', value: id },
    ]);
  } catch {
    Linking.openSettings().catch(() => {});
  }
}

/** Asks to show notifications (Android 13+ asks only once a channel exists). */
export async function allowPlaceNotifications(): Promise<void> {
  if (!notificationsAvailable || Platform.OS === 'web') return;
  try {
    await ensurePlaceChannel(await readPlaceSound());
    const now = await Notifications.getPermissionsAsync();
    if (!now.granted && now.canAskAgain !== false) await Notifications.requestPermissionsAsync();
  } catch {
    // Settings → Location says if they're still off.
  }
}
