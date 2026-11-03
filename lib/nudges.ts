import AsyncStorage from '@react-native-async-storage/async-storage';
import { Notifications } from '@/lib/notifications';
import { Platform } from 'react-native';
import type { MnemoItem } from '@/types/mnemo';
import { ensureReminderCategory, REMINDER_CATEGORY } from '@/lib/reminders';
import { DAY_MS } from '@/utils/time';

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
/** Shared with the weekly review: one switch in system settings. */
export const ANDROID_CHANNEL_ID = 'nudges';

const PLAN_DAYS = 7;
const QUIET_AFTER_MS = 2 * DAY_MS;
/** Past this a thread is probably abandoned, not paused. */
const GIVE_UP_AFTER_MS = 14 * DAY_MS;
const RENUDGE_AFTER_MS = 4 * DAY_MS;

type NudgeItem = Pick<
  MnemoItem,
  'id' | 'title' | 'status' | 'pending' | 'nextStep' | 'whereLeftOff' | 'dueDate' | 'updatedAt' | 'lastResumedAt'
>;

interface NudgeSlot {
  itemId: string;
  fireAt: number;
}

interface NudgeState {
  /** Slots whose time has passed were delivered. */
  planned: NudgeSlot[];
  delivered: Record<string, number>;
}

export async function loadNudgePrefs(): Promise<NudgePrefs> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
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
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

async function loadState(): Promise<NudgeState> {
  try {
    const raw = await AsyncStorage.getItem(STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        planned: Array.isArray(parsed.planned) ? parsed.planned : [],
        delivered: parsed.delivered && typeof parsed.delivered === 'object' ? parsed.delivered : {},
      };
    }
  } catch {}
  return { planned: [], delivered: {} };
}

export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Gentle nudges',
    description: 'A reminder when a thread has gone quiet for a few days',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export async function hasNudgePermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return (await Notifications.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Only call from an explicit user action, never on mount. */
export async function requestNudgePermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    // Android 13+ only shows the permission prompt once a channel exists.
    await ensureAndroidChannel();
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    return (await Notifications.requestPermissionsAsync()).granted;
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
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 5, channelId: ANDROID_CHANNEL_ID },
    });
    return true;
  } catch {
    return false;
  }
}

export function nudgeClock(prefs: NudgePrefs): { hour: number; minute: number } {
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
        (item.status === 'active' || item.status === 'paused') &&
        !item.pending &&
        // A future due date already has its own reminder (lib/reminders.ts).
        !(item.dueDate && item.dueDate > now),
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
  if (prefs.enabled && (await hasNudgePermission())) {
    await ensureAndroidChannel();
    await ensureReminderCategory();
    const byId = new Map(items.map((item) => [item.id, item]));
    const slots = planSlots(items, nudgeClock(prefs), delivered, now);
    for (const [index, slot] of slots.entries()) {
      const item = byId.get(slot.itemId)!;
      await Notifications.scheduleNotificationAsync({
        identifier: `${ID_PREFIX}${index}`,
        content: {
          title: item.title,
          body: nudgeBody(item, slot.fireAt),
          // The identifier is a slot, not an item id, so routing reads itemId from here.
          data: { itemId: item.id },
          categoryIdentifier: REMINDER_CATEGORY,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(slot.fireAt),
          channelId: ANDROID_CHANNEL_ID,
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

  await AsyncStorage.setItem(STATE_KEY, JSON.stringify({ planned, delivered: pruned }));
}

// Serialized: interleaved cancel/schedule passes could leave a slot from the older plan behind.
let replanChain: Promise<void> = Promise.resolve();

/** Failures are absorbed, never thrown. */
export function scheduleNudges(items: NudgeItem[]): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  replanChain = replanChain.then(() => replan(items)).catch(() => {});
  return replanChain;
}
