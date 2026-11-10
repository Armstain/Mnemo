import { Platform } from 'react-native';

import { askNotificationPermission, Notifications, notificationsAvailable, type NotificationData } from '@/lib/notifications';
import { readSavedPreferences } from '@/lib/preferences';
import { buzz } from '@/lib/reliability';
import { ensureReminderCategory, REMINDER_CATEGORY } from '@/lib/reminders';

// What a place reminder sounds like. It goes off when you're walking in
// somewhere, phone in a pocket, so it rings: its own channel at the
// highest importance, a real sound and a long buzz, shown on the lock
// screen.
//
// Android fixes a channel's sound when the channel is made, so each choice
// is its own channel, and the ones not in use are removed.

export type PlaceSound = 'chime' | 'bells' | 'rise' | 'default';

export const PLACE_SOUNDS: { key: PlaceSound; label: string; file?: string }[] = [
  { key: 'chime', label: 'Chime', file: 'mnemo_chime.wav' },
  { key: 'bells', label: 'Bells', file: 'mnemo_bells.wav' },
  { key: 'rise', label: 'Rise', file: 'mnemo_rise.wav' },
  { key: 'default', label: "Phone's sound" },
];

export const DEFAULT_PLACE_SOUND: PlaceSound = 'chime';

// Android brings a deleted channel back with its old settings, sound included, when the same id is
// made again, so a channel first made with the default sound kept it however it was set after. New ids
// (bump CHANNEL_VERSION when a channel's sound or importance changes), and the old ones are removed.
// v3: release builds had been emptying the sound files (plugins/with-kept-sounds.js), so every v2
// channel was made with the phone's own sound and would have kept it.
const CHANNEL_VERSION = 3;
const channelId = (s: PlaceSound) => `place-${s}-v${CHANNEL_VERSION}`;
// "Your own…" (a channel to change in Android's settings) was removed: its picker fell back to the default sound.
const OLD_CHANNEL_IDS = [
  ...PLACE_SOUNDS.flatMap((p) => [`place-${p.key}`, `place-${p.key}-v2`]),
  'place-custom',
  'place-custom-v2',
];
const LONG_BUZZ = [0, 500, 250, 500, 250, 500];

const soundFile = (sound: PlaceSound) => PLACE_SOUNDS.find((p) => p.key === sound)?.file;

/** Read from storage: the background task runs before the app's preferences are loaded. */
async function readPlaceSound(): Promise<PlaceSound> {
  try {
    const s = (await readSavedPreferences()).placeSound;
    return PLACE_SOUNDS.some((p) => p.key === s) ? (s as PlaceSound) : DEFAULT_PLACE_SOUND;
  } catch {
    return DEFAULT_PLACE_SOUND;
  }
}

async function ensurePlaceChannel(sound: PlaceSound): Promise<string> {
  const id = channelId(sound);
  if (Platform.OS !== 'android') return id;
  const file = soundFile(sound);
  await Notifications.setNotificationChannelAsync(id, {
    name: 'Place reminders',
    description: 'When you arrive at or leave a place you saved',
    importance: Notifications.AndroidImportance.MAX,
    sound: file ?? 'default',
    vibrationPattern: LONG_BUZZ,
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    audioAttributes: { usage: Notifications.AndroidAudioUsage.NOTIFICATION_RINGTONE },
  });
  for (const other of PLACE_SOUNDS) {
    if (other.key !== sound) await Notifications.deleteNotificationChannelAsync(channelId(other.key)).catch(() => {});
  }
  for (const old of OLD_CHANNEL_IDS) await Notifications.deleteNotificationChannelAsync(old).catch(() => {});
  return id;
}

/** Rings now: a place reminder, or the test from Settings. */
export async function ringPlaceReminder(content: { title: string; body: string; data?: NotificationData }, sound?: PlaceSound): Promise<void> {
  if (!notificationsAvailable) return;
  const chosen = sound ?? (await readPlaceSound());
  const channel = await ensurePlaceChannel(chosen);
  await ensureReminderCategory();
  const file = soundFile(chosen);
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
  // The channel's own buzz follows the phone's "vibrate for notifications" setting, which many
  // phones ship switched off. This one doesn't, and works with the app closed.
  buzz(LONG_BUZZ);
}

/** Asks to show notifications (Android 13+ asks only once a channel exists). */
export async function allowPlaceNotifications(): Promise<void> {
  if (!notificationsAvailable || Platform.OS === 'web') return;
  try {
    await ensurePlaceChannel(await readPlaceSound());
    await askNotificationPermission();
  } catch {
    // Settings → Location says if they're still off.
  }
}
