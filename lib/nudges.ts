import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { MnemoItem } from '@/types/mnemo';

// ─── Gentle nudges ──────────────────────────────────────────────
// "Resume" only works if the user remembers to open the app. Nudges are
// the app reaching out instead: when a thread goes quiet for a couple of
// days, one local notification brings it back with its next step.
//
// Everything is local notifications planned ahead of time — there's no
// server, so the next PLAN_DAYS of nudges are computed from the current
// items and scheduled up front, then re-planned whenever items change or
// the app comes back to the foreground. Items can only change while the
// app is open, so a plan made at the last change stays accurate until the
// next one.

export type NudgeTime = 'morning' | 'midday' | 'evening';

export interface NudgePrefs {
  enabled: boolean;
  time: NudgeTime;
}

export const NUDGE_TIMES: Record<NudgeTime, { label: string; hour: number; minute: number }> = {
  morning: { label: 'Morning · 9:00', hour: 9, minute: 0 },
  midday: { label: 'Midday · 12:30', hour: 12, minute: 30 },
  evening: { label: 'Evening · 18:00', hour: 18, minute: 0 },
};

const DEFAULT_PREFS: NudgePrefs = { enabled: true, time: 'morning' };

const PREFS_KEY = 'mnemo-nudge-prefs';
const STATE_KEY = 'mnemo-nudge-state';
const ID_PREFIX = 'nudge-';
const ANDROID_CHANNEL_ID = 'nudges';

const DAY_MS = 24 * 60 * 60 * 1000;
/** How many days ahead to schedule. At most one nudge per day. */
const PLAN_DAYS = 7;
/** A thread counts as quiet once it's been untouched this long. */
const QUIET_AFTER_MS = 2 * DAY_MS;
/** Past this, a thread is probably abandoned, not paused — stop nudging it. */
const GIVE_UP_AFTER_MS = 14 * DAY_MS;
/** Minimum gap before the same thread can be nudged again. */
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
  /** What the last plan scheduled. Slots whose time has passed were delivered. */
  planned: NudgeSlot[];
  /** itemId → when it was last nudged, so an ignored nudge doesn't repeat daily. */
  delivered: Record<string, number>;
}

// ─── Preferences ────────────────────────────────────────────────

export async function loadNudgePrefs(): Promise<NudgePrefs> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        enabled: parsed.enabled !== false,
        time: parsed.time in NUDGE_TIMES ? parsed.time : DEFAULT_PREFS.time,
      };
    }
  } catch {
    // Unreadable — fall back to defaults.
  }
  return DEFAULT_PREFS;
}

export async function saveNudgePrefs(prefs: NudgePrefs): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Non-critical — the preference just won't survive a restart.
  }
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
  } catch {
    // Unreadable — start fresh.
  }
  return { planned: [], delivered: {} };
}

// ─── Permission ─────────────────────────────────────────────────

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Gentle nudges',
    description: 'A reminder when a thread has gone quiet for a few days',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/** Whether notifications are currently allowed, without prompting. */
export async function hasNudgePermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return (await Notifications.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/**
 * Asks for notification permission. Only call from an explicit user action
 * (onboarding's "Turn on nudges", the Settings toggle) — never on mount.
 */
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

// ─── Planning ───────────────────────────────────────────────────

function lastTouched(item: NudgeItem): number {
  return Math.max(item.updatedAt, item.lastResumedAt ?? 0);
}

/**
 * Pure: which thread, if any, each of the next PLAN_DAYS nudge times should
 * bring back. Each thread appears at most once per plan, and never within
 * RENUDGE_AFTER_MS of the last time it was actually delivered.
 */
function planSlots(
  items: NudgeItem[],
  time: NudgeTime,
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
    // Threads with a next step first — the nudge can say what to do, not
    // just that something exists. Then the most recently touched, since
    // the freshest quiet thread is the one most likely still wanted.
    .sort((a, b) => {
      const byNextStep = Number(!!b.nextStep) - Number(!!a.nextStep);
      return byNextStep !== 0 ? byNextStep : lastTouched(b) - lastTouched(a);
    });

  const { hour, minute } = NUDGE_TIMES[time];
  const first = new Date(now);
  first.setHours(hour, minute, 0, 0);
  if (first.getTime() <= now) first.setDate(first.getDate() + 1);

  const used = new Set<string>();
  const slots: NudgeSlot[] = [];
  for (let day = 0; day < PLAN_DAYS; day++) {
    // setDate (not + day * DAY_MS) so a DST shift doesn't move the hour.
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

  // Slots from the previous plan whose time has passed were delivered.
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
    const byId = new Map(items.map((item) => [item.id, item]));
    const slots = planSlots(items, prefs.time, delivered, now);
    for (const [index, slot] of slots.entries()) {
      const item = byId.get(slot.itemId)!;
      await Notifications.scheduleNotificationAsync({
        identifier: `${ID_PREFIX}${index}`,
        content: {
          title: item.title,
          body: nudgeBody(item, slot.fireAt),
          // Routing reads itemId from here — the identifier is a slot, not
          // an item id like a due-date reminder's is.
          data: { itemId: item.id },
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

  // Drop history for deleted items and anything old enough not to matter.
  const liveIds = new Set(items.map((item) => item.id));
  const pruned: Record<string, number> = {};
  for (const [id, at] of Object.entries(delivered)) {
    if (liveIds.has(id) && now - at < GIVE_UP_AFTER_MS + RENUDGE_AFTER_MS) pruned[id] = at;
  }

  await AsyncStorage.setItem(STATE_KEY, JSON.stringify({ planned, delivered: pruned }));
}

// Serialized — an items change and a Settings change can both trigger a
// replan at once, and interleaved cancel/schedule passes could otherwise
// leave a slot from the older plan behind.
let replanChain: Promise<void> = Promise.resolve();

/**
 * Re-plans every upcoming nudge from the current items and preferences.
 * Safe to call as often as needed. Best-effort, like reminders: failures
 * are absorbed, never thrown.
 */
export function scheduleNudges(items: NudgeItem[]): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  replanChain = replanChain.then(() => replan(items)).catch(() => {});
  return replanChain;
}
