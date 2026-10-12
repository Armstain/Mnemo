import { Notifications } from '@/lib/notifications';
import { Platform } from 'react-native';
import type { MnemoItem } from '@/types/mnemo';

const ANDROID_CHANNEL_ID = 'reminders';

// Only asked once per app session — if the user declines, we don't nag on
// every single due-date set afterward. They can still grant it from OS
// settings and the next sync (app restart, or any future item mutation
// once permission changes) will pick it up.
let permissionPromptedThisSession = false;

async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (permissionPromptedThisSession) return false;
  permissionPromptedThisSession = true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

let androidChannelReady = false;
async function ensureAndroidChannel(): Promise<void> {
  if (androidChannelReady || Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  androidChannelReady = true;
}

type ReminderItem = Pick<MnemoItem, 'id' | 'title' | 'dueDate' | 'status' | 'repeat' | 'nextStep' | 'whereLeftOff'>;

export const REMINDER_CATEGORY = 'reminder';
let categoryReady = false;

/** The buttons under a reminder: tick the step off, or put it off. */
async function ensureCategory(): Promise<void> {
  if (categoryReady) return;
  await Notifications.setNotificationCategoryAsync(REMINDER_CATEGORY, [
    { identifier: 'done', buttonTitle: 'Done', options: { opensAppToForeground: true } },
    { identifier: 'hour', buttonTitle: 'In an hour', options: { opensAppToForeground: true } },
    { identifier: 'tomorrow', buttonTitle: 'Tomorrow', options: { opensAppToForeground: true } },
  ]);
  categoryReady = true;
}

/** What the reminder says: the step to take, or where they left off. */
function reminderBody(item: ReminderItem): string {
  if (item.nextStep) return `Next: ${item.nextStep}`;
  if (item.whereLeftOff) return `You left off: ${item.whereLeftOff}`;
  return 'Time to pick this back up.';
}

function repeatingTrigger(item: ReminderItem & { dueDate: number }) {
  const d = new Date(item.dueDate);
  const hour = d.getHours();
  const minute = d.getMinutes();
  const T = Notifications.SchedulableTriggerInputTypes;
  const channelId = ANDROID_CHANNEL_ID;
  if (item.repeat === 'daily') return { type: T.DAILY, hour, minute, channelId } as const;
  if (item.repeat === 'weekly') return { type: T.WEEKLY, weekday: d.getDay() + 1, hour, minute, channelId } as const;
  return { type: T.MONTHLY, day: d.getDate(), hour, minute, channelId } as const;
}

/**
 * Schedules or cancels a local reminder for an item's due date, based on
 * its current dueDate/status/repeat. The scheduled notification's
 * identifier is always the item's own id, so calling this again for the
 * same item safely replaces any previous reminder rather than accumulating
 * duplicates — callers don't need to track whether one already exists.
 *
 * Best-effort by design, matching the rest of the AI/background layer:
 * permission denial, platform quirks, or scheduling failures are silently
 * absorbed rather than surfaced or thrown — a reminder is a convenience on
 * top of an already-saved note, never something a mutation should block on.
 */
export async function syncReminderForItem(item: ReminderItem): Promise<void> {
  try {
    // Clear any existing reminder first — covers the due date being
    // removed, moved into the past, or the item being completed/archived.
    await Notifications.cancelScheduledNotificationAsync(item.id);

    const isActive = item.status === 'active' || item.status === 'paused';
    if (!isActive || !item.dueDate) return;
    if (!item.repeat && item.dueDate <= Date.now()) return;

    const granted = await ensurePermission();
    if (!granted) return;

    await ensureAndroidChannel();
    await ensureCategory();

    await Notifications.scheduleNotificationAsync({
      identifier: item.id,
      content: {
        title: item.title,
        body: reminderBody(item),
        data: { itemId: item.id },
        categoryIdentifier: REMINDER_CATEGORY,
      },
      trigger: item.repeat
        ? repeatingTrigger({ ...item, dueDate: item.dueDate })
        : { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(item.dueDate), channelId: ANDROID_CHANNEL_ID },
    });
  } catch {
    // See doc comment — never let this surface or block the caller.
  }
}

/**
 * One extra reminder at `at`, leaving a repeating schedule as it is
 * ("In an hour" on a daily reminder shouldn't move tomorrow's).
 */
export async function remindOnce(item: ReminderItem, at: number): Promise<void> {
  try {
    await ensureAndroidChannel();
    await ensureCategory();
    await Notifications.scheduleNotificationAsync({
      identifier: `${item.id}:again`,
      content: {
        title: item.title,
        body: reminderBody(item),
        data: { itemId: item.id },
        categoryIdentifier: REMINDER_CATEGORY,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at), channelId: ANDROID_CHANNEL_ID },
    });
  } catch {
    // Best-effort, like every reminder.
  }
}

/** Cancels a single item's reminder, e.g. on delete. Safe to call even if none was scheduled. */
export async function cancelReminder(id: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // Nothing to clean up, or already cancelled.
  }
}

/** Cancels every scheduled reminder — used by "Clear all data". */
export async function cancelAllReminders(): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    // Best-effort.
  }
}
