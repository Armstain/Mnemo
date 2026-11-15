import { Platform } from 'react-native';

import { Notifications, notificationsAvailable } from '@/lib/notifications';
import { ensureReminderCategory, SAVED_CATEGORY } from '@/lib/reminders';
import { formatReminder, repeatLabel } from '@/lib/when';
import type { MnemoItem } from '@/types/mnemo';
import type { ReminderState } from '@/lib/capture';

// "Reminder set · Tomorrow, 10:00 AM": said in the tray as well as by the
// toast, because a note is often spoken and the phone put away before the
// reminder is read from it. Its buttons take it back, change the time, or
// add a note to the thread, without finding the thread first. Quiet: no
// sound, no pop-up, and none at all while the app is open (app/_layout.tsx).

const CHANNEL_ID = 'saved';
const idFor = (threadId: string) => `saved:${threadId}`;

let channelReady = false;
async function ensureChannel(): Promise<void> {
  if (channelReady || Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Reminder set',
    description: 'Says when a note set a reminder, with a way to undo or change it',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: null,
    enableVibrate: false,
  });
  channelReady = true;
}

/** What the notification carries, so its buttons work even after the app was closed. */
export interface SavedNoticeData {
  kind: 'saved';
  itemId: string;
  /** The time it set: Undo only takes back this one, not one set since. */
  at: number;
  before: ReminderState;
}

export function savedTitle(at: number, repeat?: MnemoItem['repeat']): string {
  return `Reminder set · ${formatReminder(at)}${repeat ? ` · ${repeatLabel(repeat, at).toLowerCase()}` : ''}`;
}

export async function postSavedNotice(thread: Pick<MnemoItem, 'id' | 'title' | 'repeat'>, at: number, before: ReminderState): Promise<void> {
  if (Platform.OS === 'web' || !notificationsAvailable) return;
  try {
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    await ensureChannel();
    await ensureReminderCategory();
    const data: SavedNoticeData = { kind: 'saved', itemId: thread.id, at, before };
    await Notifications.scheduleNotificationAsync({
      identifier: idFor(thread.id),
      content: {
        title: savedTitle(at, thread.repeat),
        body: thread.title,
        data: JSON.parse(JSON.stringify(data)),
        categoryIdentifier: SAVED_CATEGORY,
      },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
    });
  } catch {
    // Best-effort, like every notification: the toast said it too.
  }
}

/** Taken back or changed in the app: the notice goes. */
export function dismissSavedNotice(threadId: string): void {
  if (Platform.OS === 'web' || !notificationsAvailable) return;
  Notifications.dismissNotificationAsync(idFor(threadId)).catch(() => {});
}

/** The thread's reminder as it was before the note set it; refused when it's been changed since. */
export function undoFor(thread: Pick<MnemoItem, 'dueDate'>, data: Pick<SavedNoticeData, 'at' | 'before'>): ReminderState | null {
  if (thread.dueDate !== data.at) return null;
  const b = data.before ?? {};
  return { dueDate: b.dueDate, repeat: b.repeat, laterSteps: b.laterSteps, leads: b.leads, inCalendar: b.inCalendar };
}
