import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

import { getPreferences } from '@/lib/preferences';

const ANDROID = Platform.OS === 'android' ? Number(Platform.Version) : 0;
const NATIVE = Platform.OS !== 'web';
const A = Haptics.AndroidHaptics;

const ignore = () => {};

function hapticsOn(): boolean {
  return NATIVE && getPreferences().haptics !== false;
}

function fire(effect: Haptics.AndroidHaptics | null, minApi: number, fallback: () => Promise<void>) {
  if (!hapticsOn()) return;
  if (ANDROID && effect && ANDROID >= minApi) Haptics.performAndroidHapticsAsync(effect).catch(ignore);
  else fallback().catch(ignore);
}

export const haptic = {
  select: () => fire(A.Clock_Tick, 0, () => Haptics.selectionAsync()),
  detent: () => fire(ANDROID >= 34 ? A.Segment_Tick : A.Clock_Tick, 0, () => Haptics.selectionAsync()),
  tap: () => fire(A.Virtual_Key, 0, () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  press: () => fire(A.Context_Click, 0, () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  heavy: () => fire(A.Long_Press, 0, () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
  firm: () => fire(A.Gesture_Start, 30, () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid)),
  success: () => fire(A.Confirm, 30, () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => fire(null, 0, () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => fire(A.Reject, 30, () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
  toggle: (on: boolean) => {
    if (!hapticsOn() || !ANDROID) return;
    const effect = ANDROID >= 34 ? (on ? A.Toggle_On : A.Toggle_Off) : A.Clock_Tick;
    Haptics.performAndroidHapticsAsync(effect).catch(ignore);
  },
};

/**
 * Plays the ticks across the done ring's closing (from `start`, lasting
 * `duration` ms) and the confirm as it closes. With reduced motion there's
 * nothing closing, so just the confirm, now. Returns a cancel.
 */
export function playDone({ start, duration, ticks, reduceMotion }: { start: number; duration: number; ticks: number; reduceMotion: boolean }): () => void {
  if (reduceMotion) {
    haptic.success();
    return ignore;
  }
  const timers = Array.from({ length: ticks }, (_, i) =>
    setTimeout(haptic.select, start + duration * Math.sqrt((i + 1) / (ticks + 1))),
  );
  timers.push(setTimeout(haptic.success, start + duration));
  return () => timers.forEach(clearTimeout);
}
