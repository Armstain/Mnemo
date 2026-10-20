import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

// How finishing something feels in the hand, timed to the ring closing on
// screen (components/CelebrationHost, components/ui/DoneCheck): small ticks
// while it closes, one firm confirm the moment the ends meet. Android uses
// the phone's own haptic effects where it has them; they're crisper than
// the vibration expo-haptics otherwise imitates.

const ANDROID = Platform.OS === 'android' ? Number(Platform.Version) : 0;

const ignore = () => {};

/** A soft tick: the ring moving. */
function tick() {
  if (ANDROID) Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Clock_Tick).catch(ignore);
  else Haptics.selectionAsync().catch(ignore);
}

/** The ends meet. CONFIRM came in Android 11; older phones get the success buzz. */
function confirm() {
  if (ANDROID >= 30) Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm).catch(ignore);
  else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(ignore);
}

/**
 * Plays the ticks across the ring's closing (from `start`, lasting
 * `duration` ms) and the confirm as it closes. With reduced motion there's
 * nothing closing, so just the confirm, now. Returns a cancel.
 */
export function playDone({ start, duration, ticks, reduceMotion }: { start: number; duration: number; ticks: number; reduceMotion: boolean }): () => void {
  if (reduceMotion) {
    confirm();
    return ignore;
  }
  // Ticks bunch up towards the end, like something speeding into place.
  const timers = Array.from({ length: ticks }, (_, i) =>
    setTimeout(tick, start + duration * Math.sqrt((i + 1) / (ticks + 1))),
  );
  timers.push(setTimeout(confirm, start + duration));
  return () => timers.forEach(clearTimeout);
}
