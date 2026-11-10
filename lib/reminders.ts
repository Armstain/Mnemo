import { Platform } from 'react-native';
import type { NotificationRequest, NotificationTriggerInput } from 'expo-notifications';
import {
  ACTIONS,
  askNotificationPermission,
  CHANNELS,
  ensureChannel,
  hasNotificationPermission,
  Notifications,
  type NotificationData,
} from '@/lib/notifications';
import { hasLiveTime } from '@/lib/reminder-ownership';
import { isOpenStatus, type MnemoItem } from '@/types/mnemo';

export const HOUR_MS = 60 * 60 * 1000;
// Edits arrive in bursts; rescheduling waits for them to settle.
export const EDIT_SETTLE_MS = 1500;

// Asked once per app session: after a refusal, setting another due date doesn't nag.
let permissionPromptedThisSession = false;

async function ensurePermission(): Promise<boolean> {
  if (await hasNotificationPermission()) return true;
  if (permissionPromptedThisSession) return false;
  permissionPromptedThisSession = true;
  return askNotificationPermission();
}

/** The fields a thread's scheduled reminder is built from: a change to any of them reschedules it. */
export const REMINDER_FIELDS = ['dueDate', 'status', 'title', 'repeat', 'nextStep', 'whereLeftOff', 'laterSteps'] as const;

type ReminderItem = Pick<MnemoItem, 'id' | (typeof REMINDER_FIELDS)[number]>;

const stepPrefix = (id: string) => `${id}:step:`;

async function cancelLaterSteps(id: string, scheduled?: NotificationRequest[]): Promise<void> {
  for (const r of scheduled ?? (await Notifications.getAllScheduledNotificationsAsync())) {
    if (r.identifier.startsWith(stepPrefix(id))) await Notifications.cancelScheduledNotificationAsync(r.identifier);
  }
}

export const REMINDER_CATEGORY = 'reminder';
let categoryReady = false;

export async function ensureReminderCategory(): Promise<void> {
  if (categoryReady) return;
  await Notifications.setNotificationCategoryAsync(REMINDER_CATEGORY, [
    { identifier: ACTIONS.done, buttonTitle: 'Done', options: { opensAppToForeground: true } },
    { identifier: ACTIONS.hour, buttonTitle: 'In an hour', options: { opensAppToForeground: true } },
    {
      identifier: ACTIONS.reply,
      buttonTitle: 'Reply',
      textInput: { submitButtonTitle: 'Add', placeholder: 'What happened?' },
      options: { opensAppToForeground: true },
    },
  ]);
  categoryReady = true;
}

function reminderBody(item: ReminderItem): string {
  if (item.nextStep) return `Next: ${item.nextStep}`;
  if (item.whereLeftOff) return `You left off: ${item.whereLeftOff}`;
  return 'Time to pick this back up.';
}

const onceAt = (at: number) =>
  ({ type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at), channelId: CHANNELS.reminders }) as const;

function notify(
  identifier: string,
  item: ReminderItem,
  trigger: NotificationTriggerInput,
  body = reminderBody(item),
  data: NotificationData = { itemId: item.id },
) {
  return Notifications.scheduleNotificationAsync({
    identifier,
    content: { title: item.title, body, data, categoryIdentifier: REMINDER_CATEGORY },
    trigger,
  });
}

function repeatingTrigger(item: ReminderItem & { dueDate: number }) {
  const d = new Date(item.dueDate);
  const hour = d.getHours();
  const minute = d.getMinutes();
  const T = Notifications.SchedulableTriggerInputTypes;
  const channelId = CHANNELS.reminders;
  if (item.repeat === 'daily') return { type: T.DAILY, hour, minute, channelId } as const;
  if (item.repeat === 'weekly') return { type: T.WEEKLY, weekday: d.getDay() + 1, hour, minute, channelId } as const;
  return { type: T.MONTHLY, day: d.getDate(), hour, minute, channelId } as const;
}

/**
 * The notification's identifier is the item's own id, so calling this again
 * replaces the previous reminder. Best-effort: a reminder is a convenience on
 * top of a saved note, so denial and scheduling failures never reach the caller.
 */
export async function syncReminderForItem(item: ReminderItem, scheduled?: NotificationRequest[]): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(item.id);
    await cancelLaterSteps(item.id, scheduled);

    if (!isOpenStatus(item.status) || !item.dueDate) return;
    const now = Date.now();
    if (!hasLiveTime(item, now)) return;
    const later = (item.laterSteps ?? []).filter((s) => s.at > now);
    const current = !!item.repeat || item.dueDate > now;

    await ensureChannel('reminders');
    const granted = await ensurePermission();
    if (!granted) return;

    await ensureReminderCategory();

    if (current) {
      await notify(item.id, item, item.repeat ? repeatingTrigger({ ...item, dueDate: item.dueDate }) : onceAt(item.dueDate));
    }
    for (const s of later) {
      await notify(`${stepPrefix(item.id)}${s.at}`, item, onceAt(s.at), s.step ? `Next: ${s.step}` : undefined, { itemId: item.id, at: s.at });
    }
  } catch {
    // Best-effort, see above.
  }
}

/**
 * One extra reminder at `at`, leaving a repeating schedule as it is
 * ("In an hour" on a daily reminder shouldn't move tomorrow's).
 */
export async function remindOnce(item: ReminderItem, at: number): Promise<void> {
  try {
    await ensureChannel('reminders');
    await ensureReminderCategory();
    await notify(`${item.id}:again`, item, onceAt(at));
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
    if (!(await hasNotificationPermission())) return;
    const byId = new Map(items.map((i) => [i.id, i]));
    // One-off "In an hour" reminders on repeating threads: same time again.
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const again = scheduled.flatMap((r) => {
      if (!r.identifier.endsWith(':again')) return [];
      const t = r.trigger as { value?: number; date?: number | string } | null;
      const at = typeof t?.value === 'number' ? t.value : t?.date ? new Date(t.date).getTime() : NaN;
      const item = byId.get(r.identifier.slice(0, -':again'.length));
      return item && at > Date.now() ? [{ item, at }] : [];
    });
    for (const item of items) if (item.dueDate) await syncReminderForItem(item, scheduled);
    for (const { item, at } of again) await remindOnce(item, at);
  } catch {
    // Best-effort, like every reminder.
  }
}

export async function cancelReminder(id: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
    await cancelLaterSteps(id);
  } catch {
    // Nothing to clean up, or already cancelled.
  }
}

export async function cancelAllReminders(): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    // Best-effort.
  }
}
