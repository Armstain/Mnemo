import { Notifications } from '@/lib/notifications';
import { Platform } from 'react-native';
import type { MnemoItem } from '@/types/mnemo';

// Reminders pop up and make a sound (HIGH). Android never raises an existing
// channel's importance, so they moved off the first, quieter channel.
export const ANDROID_CHANNEL_ID = 'reminder-alerts';
const LEGACY_CHANNEL_ID = 'reminders';

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
export async function ensureAndroidChannel(): Promise<void> {
  if (androidChannelReady || Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Reminders',
    description: 'The reminders you set on a thread, at the time you chose',
    importance: Notifications.AndroidImportance.HIGH,
    enableVibrate: true,
    vibrationPattern: [0, 250, 200, 250],
  });
  // Anything still on the old channel is re-set on this one by rearmReminders.
  await Notifications.deleteNotificationChannelAsync(LEGACY_CHANNEL_ID).catch(() => {});
  androidChannelReady = true;
}

type ReminderItem = Pick<MnemoItem, 'id' | 'title' | 'dueDate' | 'status' | 'repeat' | 'nextStep' | 'whereLeftOff'>;

export const REMINDER_CATEGORY = 'reminder';
let categoryReady = false;

/**
 * The buttons under a reminder or nudge: tick the step off, put it off, or
 * reply with what happened (it goes into the thread). Android shows three.
 */
export async function ensureReminderCategory(): Promise<void> {
  if (categoryReady) return;
  await Notifications.setNotificationCategoryAsync(REMINDER_CATEGORY, [
    { identifier: 'done', buttonTitle: 'Done', options: { opensAppToForeground: true } },
    { identifier: 'hour', buttonTitle: 'In an hour', options: { opensAppToForeground: true } },
    {
      identifier: 'reply',
      buttonTitle: 'Reply',
      textInput: { submitButtonTitle: 'Add', placeholder: 'What happened?' },
      options: { opensAppToForeground: true },
    },
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

    // Channel first: Android 13+ shows no permission prompt until one exists.
    await ensureAndroidChannel();
    const granted = await ensurePermission();
    if (!granted) return;

    await ensureReminderCategory();

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
    await ensureReminderCategory();
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

/**
 * Sets every reminder again from the threads. A scheduled alarm doesn't
 * always survive: a restart on a phone that blocks autostart, the app being
 * force-stopped (some battery savers do this when it's swiped away), or
 * exact alarms being switched off and on all drop them. Re-setting them
 * whenever the app opens means the worst case is one missed, not all.
 * Never asks for permission.
 */
export async function rearmReminders(items: ReminderItem[]): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    const byId = new Map(items.map((i) => [i.id, i]));
    // One-off "In an hour" reminders on repeating threads: same time again.
    const again = (await Notifications.getAllScheduledNotificationsAsync()).flatMap((r) => {
      if (!r.identifier.endsWith(':again')) return [];
      const t = r.trigger as { value?: number; date?: number | string } | null;
      const at = typeof t?.value === 'number' ? t.value : t?.date ? new Date(t.date).getTime() : NaN;
      const item = byId.get(r.identifier.slice(0, -':again'.length));
      return item && at > Date.now() ? [{ item, at }] : [];
    });
    for (const item of items) if (item.dueDate) await syncReminderForItem(item);
    for (const { item, at } of again) await remindOnce(item, at);
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
