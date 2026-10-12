import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo';
import { Linking, Platform } from 'react-native';

import { Notifications, notificationsAvailable } from '@/lib/notifications';
import { ANDROID_CHANNEL_ID, ensureAndroidChannel } from '@/lib/reminders';
import { judge, STRICT, type CheckState, type NativeStatus } from '@/lib/reliability-rules';

export type { CheckState };

// Will a reminder actually reach this person? On a Pixel it simply does. On
// Xiaomi, Oppo, Vivo, Huawei, Transsion and (less so) Samsung phones, the
// maker's battery saver stops apps in the background, which can hold
// reminders back or drop them. Some of that can be read
// (modules/mnemo-reliability), some can't, and the only real proof is a
// test reminder arriving with the app closed. This file is all three.


interface NativeReliability {
  status(): NativeStatus;
  openExactAlarms(): boolean;
  openBattery(): boolean;
  openAutostart(): boolean;
  openNotifications(): boolean;
}

// Absent on iOS, the web, Expo Go and builds made before the module existed.
const native = Platform.OS === 'android' ? requireOptionalNativeModule<NativeReliability>('MnemoReliability') : null;

function device(): { maker: string; brand: string; sdk: number } {
  if (Platform.OS !== 'android') return { maker: Platform.OS, brand: Platform.OS, sdk: 0 };
  try {
    const s = native?.status();
    if (s) return { maker: s.manufacturer, brand: s.brand.split(/\s+/)[0], sdk: s.sdk };
  } catch {
    // Fall through to what React Native knows.
  }
  const c = Platform.constants as { Manufacturer?: string; Brand?: string };
  // First word only: Transsion phones say "INFINIX MOBILITY LIMITED".
  const first = (v?: string) => (v ?? '').trim().toLowerCase().split(/\s+/)[0];
  return { maker: first(c.Manufacturer), brand: first(c.Brand), sdk: Number(Platform.Version) || 0 };
}

/** "Xiaomi", "Redmi", "Samsung"… if this is a phone known to be strict; null otherwise. */
export function strictPhone(): string | null {
  const { maker, brand } = device();
  if (!STRICT[maker]) return null;
  return STRICT[brand] ?? STRICT[maker];
}


export interface ReminderHealth {
  /** False in Expo Go on Android and on the web: no reminders there at all. */
  available: boolean;
  /** Whether the settings below could be read (the native module is in this build). */
  readable: boolean;
  maker: string;
  /** Display name when the phone is strict ("Xiaomi"), else null. */
  strict: string | null;
  notifications: { state: CheckState; canAsk: boolean };
  /** Android 12+ only; null where it doesn't apply. */
  exactAlarms: CheckState | null;
  battery: CheckState | null;
  /** Only on makers with an autostart switch. */
  autostart: CheckState | null;
  /** Only where pop-ups start off; can't be read, so always "check". */
  popups: CheckState | null;
}

export async function reminderHealth(): Promise<ReminderHealth> {
  const { maker, sdk } = device();
  const strict = strictPhone();
  if (!notificationsAvailable || Platform.OS === 'web') {
    return { available: false, readable: false, maker, strict, notifications: { state: 'fix', canAsk: false }, exactAlarms: null, battery: null, autostart: null, popups: null };
  }
  let perm = { granted: false, canAskAgain: true };
  try {
    perm = await Notifications.getPermissionsAsync();
  } catch {
    // Unknown: treat as not yet allowed.
  }
  const notifications = { state: (perm.granted ? 'ok' : 'fix') as CheckState, canAsk: perm.canAskAgain !== false };
  if (Platform.OS !== 'android') {
    return { available: true, readable: true, maker, strict, notifications, exactAlarms: null, battery: null, autostart: null, popups: null };
  }

  let s: NativeStatus | null = null;
  try {
    s = native?.status() ?? null;
  } catch {
    s = null;
  }
  const { exactAlarms, battery, autostart, popups } = judge(s, { sdk, maker, strict: !!strict });
  return {
    available: true,
    readable: !!s,
    maker,
    strict,
    notifications,
    exactAlarms,
    battery,
    autostart,
    popups,
  };
}

/** Whether every check that can be read is fine. Unreadable ones don't count against. */
export function allClear(h: ReminderHealth): boolean {
  return h.available && [h.notifications.state, h.exactAlarms, h.battery, h.autostart].every((s) => s !== 'fix');
}

// ─── Opening the right settings ─────────────────────────────────

function open(fn: ((m: NativeReliability) => boolean) | null): void {
  try {
    if (native && fn && fn(native)) return;
  } catch {
    // Fall back below.
  }
  Linking.openSettings().catch(() => {});
}

export const openSettings = {
  exactAlarms: () => open((m) => m.openExactAlarms()),
  battery: () => open((m) => m.openBattery()),
  autostart: () => open((m) => m.openAutostart()),
  notifications: () => open((m) => m.openNotifications()),
  app: () => open(null),
};

/** Asks for notification permission where it still can be asked; otherwise opens settings. */
export async function allowNotifications(canAsk: boolean): Promise<void> {
  if (canAsk) {
    try {
      await ensureAndroidChannel(); // Android 13 only prompts once a channel exists.
      const r = await Notifications.requestPermissionsAsync();
      if (r.granted || r.canAskAgain) return;
    } catch {
      // Fall through to settings.
    }
  }
  openSettings.notifications();
}

// ─── The test reminder ──────────────────────────────────────────

export const TEST_ID = 'mnemo-reminder-test';
export const TEST_ROUTE = '/reminders-check';
const TEST_KEY = 'mnemo-reminder-test';
const SETUP_KEY = 'mnemo-reminder-setup';
/** How long after it was due before asking whether it came. */
export const TEST_GRACE_MS = 90_000;

export interface TestState {
  fireAt: number;
  arrivedAt?: number;
  /** What the person said when it didn't show while the app was open. */
  answer?: 'yes' | 'no';
  /** It came while Mnemo was on screen, which proves little: strict phones interfere once it's closed. */
  seenOpen?: boolean;
}

export async function loadTest(): Promise<TestState | null> {
  try {
    const raw = await AsyncStorage.getItem(TEST_KEY);
    return raw ? (JSON.parse(raw) as TestState) : null;
  } catch {
    return null;
  }
}

async function saveTest(t: TestState | null): Promise<void> {
  try {
    if (t) await AsyncStorage.setItem(TEST_KEY, JSON.stringify(t));
    else await AsyncStorage.removeItem(TEST_KEY);
  } catch {
    // Only affects what the check screen remembers.
  }
}

/** Schedules a real reminder, on the reminders channel, `delayMs` from now. */
export async function sendTestReminder(delayMs = 60_000): Promise<TestState | null> {
  try {
    await ensureAndroidChannel();
    const fireAt = Date.now() + delayMs;
    await Notifications.cancelScheduledNotificationAsync(TEST_ID).catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: TEST_ID,
      content: {
        title: 'Test reminder from Mnemo',
        body: 'It arrived. Tap to finish the check.',
        data: { route: TEST_ROUTE, test: true },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(fireAt), channelId: ANDROID_CHANNEL_ID },
    });
    const t = { fireAt };
    await saveTest(t);
    return t;
  } catch {
    return null;
  }
}

/** The test reminder was seen: tapped, shown while the app was open, or found in the tray. */
export async function markTestArrived(): Promise<void> {
  const t = await loadTest();
  if (!t || t.arrivedAt || t.seenOpen) return;
  await saveTest({ ...t, arrivedAt: Date.now() });
  await markSetup({ verifiedAt: Date.now() });
}

export async function markTestSeenWhileOpen(): Promise<void> {
  const t = await loadTest();
  if (t && !t.arrivedAt) await saveTest({ ...t, seenOpen: true });
}

export async function answerTest(answer: 'yes' | 'no'): Promise<void> {
  const t = await loadTest();
  if (!t) return;
  await saveTest({ ...t, answer, arrivedAt: answer === 'yes' ? Date.now() : undefined });
  if (answer === 'yes') await markSetup({ verifiedAt: Date.now() });
}

/** Whether the test reminder is sitting in the notification tray right now. */
export async function testInTray(): Promise<boolean> {
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    return shown.some((n) => n.request.identifier === TEST_ID);
  } catch {
    return false;
  }
}

// ─── The one-time prompt ────────────────────────────────────────

export interface SetupState {
  /** A test reminder arrived on this phone. */
  verifiedAt?: number;
  /** "Not now" on Home's prompt. */
  dismissedAt?: number;
}

export async function loadSetup(): Promise<SetupState> {
  try {
    const raw = await AsyncStorage.getItem(SETUP_KEY);
    return raw ? (JSON.parse(raw) as SetupState) : {};
  } catch {
    return {};
  }
}

export async function markSetup(update: SetupState): Promise<void> {
  try {
    await AsyncStorage.setItem(SETUP_KEY, JSON.stringify({ ...(await loadSetup()), ...update }));
  } catch {
    // The prompt may show again; nothing worse.
  }
}
