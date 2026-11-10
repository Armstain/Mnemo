import { Platform } from 'react-native';

import { formatValue } from '@/lib/measures';
import { CHANNELS, ensureChannel, hasNotificationPermission, Notifications, type NotificationData } from '@/lib/notifications';
import { loadNudgePrefs } from '@/lib/nudges';
import { reviewLine, weekReview } from '@/lib/review';
import { reviewHref } from '@/lib/routes';
import { isOpenStatus, type Entry, type MnemoItem } from '@/types/mnemo';

// One notification a week that opens the weekly review. It goes out at the
// start of the weekend: Friday morning in Bangladesh, Sunday evening
// elsewhere. It's planned whenever the app is used, saying what the week
// holds at that moment, and follows the same switch as the nudges.

const ID = 'weekly-review';

function inBangladesh(): boolean {
  try {
    const { timeZone, locale } = Intl.DateTimeFormat().resolvedOptions();
    return timeZone === 'Asia/Dhaka' || /-BD$/i.test(locale) || /^bn/i.test(locale);
  } catch {
    return false;
  }
}

/** When the weekly review notification goes out, for Settings to say. */
export function reviewTimeLabel(): string {
  return inBangladesh() ? 'Fridays at 10:00' : 'Sundays at 18:00';
}

function nextReviewAt(now = Date.now()): number {
  const [weekday, hour] = inBangladesh() ? [5, 10] : [0, 18];
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  const ahead = (weekday - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + ahead);
  if (d.getTime() <= now) d.setDate(d.getDate() + 7);
  return d.getTime();
}

/** Plans (or re-plans) the week's review notification. Best-effort. */
export async function scheduleWeeklyReview(items: MnemoItem[], entries: Entry[]): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.cancelScheduledNotificationAsync(ID);
    const prefs = await loadNudgePrefs();
    if (!prefs.enabled || !prefs.weekly || !(await hasNotificationPermission())) return;
    if (!items.some((t) => isOpenStatus(t.status))) return;
    await ensureChannel('nudges');
    const at = nextReviewAt();
    // What the review will show then: this is close enough, and it's
    // re-planned every time the app is used.
    const review = weekReview(items, entries, at);
    const data: NotificationData = { route: reviewHref };
    await Notifications.scheduleNotificationAsync({
      identifier: ID,
      content: {
        title: 'Your week in Mnemo',
        body: reviewLine(review, (t) => `${t.metric} ${formatValue(t.total, t.unit)}`),
        data,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at), channelId: CHANNELS.nudges },
    });
  } catch {
    // A missed weekly notification is no loss; the review is always in the app.
  }
}
