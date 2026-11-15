import * as TaskManager from 'expo-task-manager';

import { Notifications } from '@/lib/notifications';
import { logError } from '@/lib/errors';
import { NOTIFICATION_ACTION_TASK } from '@/lib/reminders';

// A notification button that doesn't open the app (a heads-up's OK) is
// answered here: Android starts Mnemo's JS in the background for it, even
// with the app closed, so it's defined when the entry file loads (index.ts).
// The button only puts that one notification away; nothing else changes.

interface ActionPayload {
  actionIdentifier?: string;
  notification?: { request?: { identifier?: string } } | null;
}

TaskManager.defineTask<ActionPayload>(NOTIFICATION_ACTION_TASK, async ({ data, error }) => {
  if (error) {
    logError('notification action', error);
    return;
  }
  const identifier = data?.notification?.request?.identifier;
  if (data?.actionIdentifier !== 'ok' || !identifier) return;
  await Notifications.dismissNotificationAsync(identifier).catch(() => {});
});
