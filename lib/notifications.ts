import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

// Since SDK 55, merely importing expo-notifications in Expo Go on Android
// throws, which takes down every route that imports it. There, reminders and
// nudges are simply off; a development build has them.
export const notificationsAvailable = !(
  Platform.OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient
);

// Typed as always present on purpose: every use runs inside try/catch or behind
// notificationsAvailable, so the null case fails silently there.
export const Notifications: typeof import('expo-notifications') = notificationsAvailable
  ? require('expo-notifications')
  : (null as never);

export const CHANNELS = { reminders: 'reminder-alerts', nudges: 'nudges' } as const;
type Channel = keyof typeof CHANNELS;

// The channel Android keeps the first, quieter reminders on.
const LEGACY_REMINDER_CHANNEL = 'reminders';

const channelReady = new Set<Channel>();

// Android never raises an existing channel's importance, so reminders moved off the first channel.
export async function ensureChannel(channel: Channel): Promise<void> {
  if (channelReady.has(channel) || Platform.OS !== 'android') return;
  if (channel === 'reminders') {
    await Notifications.setNotificationChannelAsync(CHANNELS.reminders, {
      name: 'Reminders',
      description: 'The reminders you set on a thread, at the time you chose',
      importance: Notifications.AndroidImportance.HIGH,
      enableVibrate: true,
      vibrationPattern: [0, 250, 200, 250],
    });
    await Notifications.deleteNotificationChannelAsync(LEGACY_REMINDER_CHANNEL).catch(() => {});
  } else {
    await Notifications.setNotificationChannelAsync(CHANNELS.nudges, {
      name: 'Gentle nudges',
      description: 'A reminder when a thread has gone quiet for a few days',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  channelReady.add(channel);
}

export async function hasNotificationPermission(): Promise<boolean> {
  if (!notificationsAvailable || Platform.OS === 'web') return false;
  try {
    return (await Notifications.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

export async function askNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (current.canAskAgain === false) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

export const ACTIONS = { done: 'done', hour: 'hour', reply: 'reply' } as const;

export type NotificationData = {
  itemId?: string;
  at?: number;
  kind?: string;
  route?: string;
  test?: boolean;
};

export function notificationData(raw: unknown): NotificationData {
  const d = (raw ?? {}) as Record<string, unknown>;
  return {
    itemId: typeof d.itemId === 'string' ? d.itemId : undefined,
    at: typeof d.at === 'number' ? d.at : undefined,
    kind: typeof d.kind === 'string' ? d.kind : undefined,
    route: typeof d.route === 'string' ? d.route : undefined,
    test: d.test === true,
  };
}
