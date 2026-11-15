import { Notifications } from '@/lib/notifications';
import { Platform } from 'react-native';
import type { NotificationRequest, NotificationTriggerInput } from 'expo-notifications';
import type { MnemoItem } from '@/types/mnemo';
import { nativeRepeat, upcoming } from '@/lib/repeat';
import { leadTimes } from '@/lib/leads';
import { phoneWeekend } from '@/lib/places';
import { formatReminder } from '@/lib/when';

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

type ReminderItem = Pick<MnemoItem, 'id' | 'title' | 'dueDate' | 'status' | 'repeat' | 'nextStep' | 'whereLeftOff' | 'laterSteps' | 'leads'>;

const stepPrefix = (id: string) => `${id}:step:`;

/**
 * Besides the one named by the thread's id, a thread's reminder can be
 * several: later steps (`:step:`), the next few times of a repeat the phone
 * can't ring on its own (`:occ:`), one weekly alarm per working day (`:wd:`),
 * and heads-ups before an appointment (`:lead:`). All are set again together.
 */
const OWN = /^(step|occ|wd|lead):/;

async function cancelLaterSteps(id: string, scheduled?: NotificationRequest[]): Promise<void> {
  for (const r of scheduled ?? (await Notifications.getAllScheduledNotificationsAsync())) {
    if (r.identifier.startsWith(`${id}:`) && OWN.test(r.identifier.slice(id.length + 1))) {
      await Notifications.cancelScheduledNotificationAsync(r.identifier);
    }
  }
}

/** Answers notification buttons that don't open the app (lib/notification-task.ts defines it). */
export const NOTIFICATION_ACTION_TASK = 'mnemo-notification-action';
let actionsRegistered = false;

/** Once per launch; the phone keeps it between launches, and asking again is harmless. */
export async function registerNotificationActions(): Promise<void> {
  if (actionsRegistered || Platform.OS === 'web') return;
  actionsRegistered = true;
  try {
    await Notifications.registerTaskAsync(NOTIFICATION_ACTION_TASK);
  } catch {
    actionsRegistered = false;
  }
}

export const REMINDER_CATEGORY = 'reminder';
/** A heads-up before an appointment: OK puts it away and nothing else, so the reminders still to come come all the same. */
export const HEADS_UP_CATEGORY = 'heads-up';
/** "Reminder set": take it back, change it, or add to it, without opening the thread first (lib/saved-notice.ts). */
export const SAVED_CATEGORY = 'saved';
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
  // OK runs in the background (lib/notification-task.ts): the app doesn't open for it.
  await Notifications.setNotificationCategoryAsync(HEADS_UP_CATEGORY, [
    { identifier: 'ok', buttonTitle: 'OK', options: { opensAppToForeground: false } },
  ]);
  await Notifications.setNotificationCategoryAsync(SAVED_CATEGORY, [
    { identifier: 'undo', buttonTitle: 'Undo', options: { opensAppToForeground: true } },
    { identifier: 'change', buttonTitle: 'Change', options: { opensAppToForeground: true } },
    { identifier: 'note', buttonTitle: 'Add note', options: { opensAppToForeground: true } },
  ]);
  categoryReady = true;
}

/** What the reminder says: the step to take, or where they left off. */
function reminderBody(item: ReminderItem): string {
  if (item.nextStep) return `Next: ${item.nextStep}`;
  if (item.whereLeftOff) return `You left off: ${item.whereLeftOff}`;
  return 'Time to pick this back up.';
}

const onceAt = (at: number) =>
  ({ type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at), channelId: ANDROID_CHANNEL_ID }) as const;

function notify(
  identifier: string,
  item: ReminderItem,
  trigger: NotificationTriggerInput,
  body = reminderBody(item),
  data: Record<string, unknown> = { itemId: item.id },
  categoryIdentifier = REMINDER_CATEGORY,
) {
  return Notifications.scheduleNotificationAsync({
    identifier,
    content: { title: item.title, body, data, categoryIdentifier },
    trigger,
  });
}

function repeatingTrigger(due: number, repeat: 'daily' | 'weekly' | 'monthly' | 'yearly') {
  const d = new Date(due);
  const hour = d.getHours();
  const minute = d.getMinutes();
  const T = Notifications.SchedulableTriggerInputTypes;
  const channelId = ANDROID_CHANNEL_ID;
  if (repeat === 'daily') return { type: T.DAILY, hour, minute, channelId } as const;
  if (repeat === 'weekly') return { type: T.WEEKLY, weekday: d.getDay() + 1, hour, minute, channelId } as const;
  if (repeat === 'yearly') return { type: T.YEARLY, month: d.getMonth(), day: d.getDate(), hour, minute, channelId } as const;
  return { type: T.MONTHLY, day: d.getDate(), hour, minute, channelId } as const;
}

/** What a heads-up says, as read when it rings: "In 1 hour, at 10:00 AM", "Tomorrow, 10:00 AM". */
export function headsUpBody(due: number, ringsAt: number, nextStep?: string): string {
  const minutes = Math.round((due - ringsAt) / 60_000);
  const time = new Date(due).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const when =
    minutes < 60 ? `In ${minutes} minutes, at ${time}` : minutes < 180 && minutes % 60 === 0 ? `In ${minutes / 60 === 1 ? '1 hour' : `${minutes / 60} hours`}, at ${time}` : formatReminder(due, ringsAt);
  return nextStep ? `${when} · ${nextStep}` : when;
}

/** The thread's own reminder, however it repeats. */
async function notifyDue(item: ReminderItem & { dueDate: number }, now: number): Promise<void> {
  if (!item.repeat) {
    await notify(item.id, item, onceAt(item.dueDate));
    return;
  }
  const native = nativeRepeat(item.repeat);
  if (native === 'weekdays') {
    // One weekly alarm per working day: rings for good, like the other repeats the phone keeps.
    const d = new Date(item.dueDate);
    const weekend = phoneWeekend();
    for (let day = 0; day < 7; day++) {
      if (weekend.includes(day)) continue;
      const T = Notifications.SchedulableTriggerInputTypes;
      await notify(`${item.id}:wd:${day}`, item, { type: T.WEEKLY, weekday: day + 1, hour: d.getHours(), minute: d.getMinutes(), channelId: ANDROID_CHANNEL_ID });
    }
  } else if (native) {
    await notify(item.id, item, repeatingTrigger(item.dueDate, native));
  } else {
    // Every other week, the last Friday: the next few times, set again whenever the app opens (rearmReminders).
    for (const at of upcoming(item.dueDate, item.repeat, now)) await notify(`${item.id}:occ:${at}`, item, onceAt(at));
  }
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
export async function syncReminderForItem(item: ReminderItem, scheduled?: NotificationRequest[]): Promise<void> {
  try {
    // Clear any existing reminder first — covers the due date being
    // removed, moved into the past, or the item being completed/archived.
    await Notifications.cancelScheduledNotificationAsync(item.id);
    await cancelLaterSteps(item.id, scheduled);

    const isActive = item.status === 'active' || item.status === 'paused';
    if (!isActive || !item.dueDate) return;
    const now = Date.now();
    const later = (item.laterSteps ?? []).filter((s) => s.at > now);
    const current = !!item.repeat || item.dueDate > now;
    if (!current && later.length === 0) return;

    // Channel first: Android 13+ shows no permission prompt until one exists.
    await ensureAndroidChannel();
    const granted = await ensurePermission();
    if (!granted) return;

    await ensureReminderCategory();

    if (current) await notifyDue({ ...item, dueDate: item.dueDate }, now);
    if (!item.repeat && item.dueDate > now) {
      for (const { at } of leadTimes(item.dueDate, item.leads, now)) {
        await notify(`${item.id}:lead:${at}`, item, onceAt(at), headsUpBody(item.dueDate, at, item.nextStep), { itemId: item.id, headsUp: true }, HEADS_UP_CATEGORY);
      }
    }
    for (const s of later) {
      await notify(`${stepPrefix(item.id)}${s.at}`, item, onceAt(s.at), s.step ? `Next: ${s.step}` : undefined, { itemId: item.id, at: s.at });
    }
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
    if (!(await Notifications.getPermissionsAsync()).granted) return;
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

/** Cancels a single item's reminder, e.g. on delete. Safe to call even if none was scheduled. */
export async function cancelReminder(id: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
    await cancelLaterSteps(id);
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
