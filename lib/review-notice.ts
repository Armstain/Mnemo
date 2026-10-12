import { Platform } from 'react-native';

import { formatValue } from '@/lib/measures';
import { hasNudgePermission, loadNudgePrefs } from '@/lib/nudges';
import { Notifications } from '@/lib/notifications';
import { reviewLine, weekReview } from '@/lib/review';
import type { Entry, MnemoItem } from '@/types/mnemo';

// One notification a week that opens the weekly review. It goes out at the
// start of the weekend: Friday morning in Bangladesh, Sunday evening
// elsewhere. It's planned whenever the app is used, saying what the week
// holds at that moment, and follows the same switch as the nudges.

const ID = 'weekly-review';
const CHANNEL = 'nudges';

function inBangladesh(): boolean {
  try {
    const { timeZone, locale } = Intl.DateTimeFormat().resolvedOptions();
    return timeZone === 'Asia/Dhaka' || /-BD$/i.test(locale) || /^bn/i.test(locale);
  } catch {
    return false;
  }
}

/** The next weekly review time after `now`. */
export function nextReviewAt(now = Date.now(), bangladesh = inBangladesh()): number {
  const [weekday, hour] = bangladesh ? [5, 10] : [0, 18]; // Friday 10:00 or Sunday 18:00
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
    if (!prefs.enabled || !(await hasNudgePermission())) return;
    if (!items.some((t) => t.status === 'active' || t.status === 'paused')) return;
    const at = nextReviewAt();
    // What the review will show then: this is close enough, and it's
    // re-planned every time the app is used.
    const review = weekReview(items, entries, at);
    await Notifications.scheduleNotificationAsync({
      identifier: ID,
      content: {
        title: 'Your week in Mnemo',
        body: reviewLine(review, (t) => `${t.metric} ${formatValue(t.total, t.unit)}`),
        data: { route: '/review' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at), channelId: CHANNEL },
    });
  } catch {
    // A missed weekly notification is no loss; the review is always in the app.
  }
}
