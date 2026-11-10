import { Platform } from 'react-native';
import { askNotificationPermission, CHANNELS, ensureChannel, hasNotificationPermission, Notifications, type NotificationData } from '@/lib/notifications';
import { hasLiveTime } from '@/lib/reminder-ownership';
import { ensureReminderCategory, REMINDER_CATEGORY } from '@/lib/reminders';
import { readJson, writeJson } from '@/lib/storage';
import { isOpenStatus, type MnemoItem } from '@/types/mnemo';
import { DAY_MS, GIVE_UP_AFTER_MS } from '@/utils/time';

// No server: the next PLAN_DAYS of nudges are scheduled locally up front and re-planned on item change or foreground.
// Items only change while the app is open, so the last plan stays accurate until then.

export type NudgeTime = 'morning' | 'midday' | 'evening';

export interface NudgePrefs {
  enabled: boolean;
  time: NudgeTime | 'custom';
  custom?: { hour: number; minute: number };
  weekly: boolean;
}

export const NUDGE_TIMES: Record<NudgeTime, { label: string; hour: number; minute: number }> = {
  morning: { label: 'Morning · 9:00', hour: 9, minute: 0 },
  midday: { label: 'Midday · 12:30', hour: 12, minute: 30 },
  evening: { label: 'Evening · 18:00', hour: 18, minute: 0 },
};

const DEFAULT_PREFS: NudgePrefs = { enabled: true, time: 'morning', weekly: true };

const PREFS_KEY = 'mnemo-nudge-prefs';
const STATE_KEY = 'mnemo-nudge-state';
const ID_PREFIX = 'nudge-';

const PLAN_DAYS = 7;
const QUIET_AFTER_MS = 2 * DAY_MS;
const RENUDGE_AFTER_MS = 4 * DAY_MS;

type NudgeItem = Pick<
  MnemoItem,
  'id' | 'title' | 'status' | 'pending' | 'nextStep' | 'whereLeftOff' | 'dueDate' | 'repeat' | 'laterSteps' | 'updatedAt' | 'lastResumedAt'
>;

interface NudgeSlot {
  itemId: string;
  fireAt: number;
}

interface NudgeState {
  planned: NudgeSlot[];
  delivered: Record<string, number>;
}

export async function loadNudgePrefs(): Promise<NudgePrefs> {
  try {
    const parsed = (await readJson(PREFS_KEY)) as any;
    if (parsed) {
      return {
        enabled: parsed.enabled !== false,
        weekly: parsed.weekly !== false,
        time: parsed.time in NUDGE_TIMES || (parsed.time === 'custom' && parsed.custom) ? parsed.time : DEFAULT_PREFS.time,
        custom: parsed.custom,
      };
    }
  } catch {}
  return DEFAULT_PREFS;
}

export async function saveNudgePrefs(prefs: NudgePrefs): Promise<void> {
  try {
    await writeJson(PREFS_KEY, prefs);
  } catch {}
}

async function loadState(): Promise<NudgeState> {
  try {
    const parsed = (await readJson(STATE_KEY)) as any;
    if (parsed) {
      return {
        planned: Array.isArray(parsed.planned) ? parsed.planned : [],
        delivered: parsed.delivered && typeof parsed.delivered === 'object' ? parsed.delivered : {},
      };
    }
  } catch {}
  return { planned: [], delivered: {} };
}

/** Only call from an explicit user action, never on mount. */
export async function requestNudgePermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    // Android 13+ only shows the permission prompt once a channel exists.
    await ensureChannel('nudges');
    return await askNotificationPermission();
  } catch {
    return false;
  }
}

export async function sendTestNudge(): Promise<boolean> {
  if (!(await requestNudgePermission())) return false;
  try {
    await Notifications.scheduleNotificationAsync({
      // Outside ID_PREFIX, so a replan in the next few seconds can't cancel it.
      identifier: 'mnemo-test-nudge',
      content: { title: 'Mnemo', body: 'Nudges work. This is how one will look.' },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 5, channelId: CHANNELS.nudges },
    });
    return true;
  } catch {
    return false;
  }
}

function nudgeClock(prefs: NudgePrefs): { hour: number; minute: number } {
  return prefs.time === 'custom' && prefs.custom ? prefs.custom : NUDGE_TIMES[prefs.time === 'custom' ? 'morning' : prefs.time];
}

function lastTouched(item: NudgeItem): number {
  return Math.max(item.updatedAt, item.lastResumedAt ?? 0);
}

/** Each thread appears at most once per plan, and never within RENUDGE_AFTER_MS of its last delivery. */
function planSlots(
  items: NudgeItem[],
  clock: { hour: number; minute: number },
  delivered: Record<string, number>,
  now: number,
): NudgeSlot[] {
  const candidates = items
    .filter(
      (item) =>
        isOpenStatus(item.status) &&
        !item.pending &&
        // A live time reminder already has its own notification (lib/reminders.ts).
        !hasLiveTime(item, now),
    )
    // Next step first, then freshest: the nudge can say what to do, and recent threads are most likely still wanted.
    .sort((a, b) => {
      const byNextStep = Number(!!b.nextStep) - Number(!!a.nextStep);
      return byNextStep !== 0 ? byNextStep : lastTouched(b) - lastTouched(a);
    });

  const { hour, minute } = clock;
  const first = new Date(now);
  first.setHours(hour, minute, 0, 0);
  if (first.getTime() <= now) first.setDate(first.getDate() + 1);

  const used = new Set<string>();
  const slots: NudgeSlot[] = [];
  for (let day = 0; day < PLAN_DAYS; day++) {
    // setDate, not + day * DAY_MS, so DST doesn't move the hour.
    const fire = new Date(first);
    fire.setDate(first.getDate() + day);
    const fireAt = fire.getTime();

    const pick = candidates.find((item) => {
      if (used.has(item.id)) return false;
      const lastNudged = delivered[item.id];
      if (lastNudged && fireAt - lastNudged < RENUDGE_AFTER_MS) return false;
      const quietFor = fireAt - lastTouched(item);
      return quietFor >= QUIET_AFTER_MS && quietFor <= GIVE_UP_AFTER_MS;
    });
    if (pick) {
      used.add(pick.id);
      slots.push({ itemId: pick.id, fireAt });
    }
  }
  return slots;
}

function nudgeBody(item: NudgeItem, fireAt: number): string {
  if (item.nextStep) return `Next step: ${item.nextStep}`;
  if (item.whereLeftOff) return `You left off: ${item.whereLeftOff}`;
  const days = Math.round((fireAt - lastTouched(item)) / DAY_MS);
  return `Untouched for ${days} days. Pick it back up?`;
}

async function cancelScheduledNudges(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => n.identifier.startsWith(ID_PREFIX))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}

async function replan(items: NudgeItem[]): Promise<void> {
  const now = Date.now();
  const [prefs, state] = await Promise.all([loadNudgePrefs(), loadState()]);

  const delivered = { ...state.delivered };
  for (const slot of state.planned) {
    if (slot.fireAt <= now) {
      delivered[slot.itemId] = Math.max(delivered[slot.itemId] ?? 0, slot.fireAt);
    }
  }

  await cancelScheduledNudges();

  const planned: NudgeSlot[] = [];
  if (prefs.enabled && (await hasNotificationPermission())) {
    await ensureChannel('nudges');
    await ensureReminderCategory();
    const byId = new Map(items.map((item) => [item.id, item]));
    const slots = planSlots(items, nudgeClock(prefs), delivered, now);
    for (const [index, slot] of slots.entries()) {
      const item = byId.get(slot.itemId)!;
      const data: NotificationData = { itemId: item.id };
      await Notifications.scheduleNotificationAsync({
        identifier: `${ID_PREFIX}${index}`,
        content: {
          title: item.title,
          body: nudgeBody(item, slot.fireAt),
          // The identifier is a slot, not an item id, so routing reads itemId from here.
          data,
          categoryIdentifier: REMINDER_CATEGORY,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(slot.fireAt),
          channelId: CHANNELS.nudges,
        },
      });
      planned.push(slot);
    }
  }

  const liveIds = new Set(items.map((item) => item.id));
  const pruned: Record<string, number> = {};
  for (const [id, at] of Object.entries(delivered)) {
    if (liveIds.has(id) && now - at < GIVE_UP_AFTER_MS + RENUDGE_AFTER_MS) pruned[id] = at;
  }

  await writeJson(STATE_KEY, { planned, delivered: pruned });
}

// Serialized: interleaved cancel/schedule passes could leave a slot from the older plan behind.
let replanChain: Promise<void> = Promise.resolve();

export function scheduleNudges(items: NudgeItem[]): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  replanChain = replanChain.then(() => replan(items)).catch(() => {});
  return replanChain;
}
