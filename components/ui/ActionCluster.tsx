import React, { useEffect, useRef, useState } from 'react';
import { Alert, View, Pressable, StyleSheet, Text, GestureResponderEvent } from 'react-native';
import { Mic, SquarePen, X, Trash2, Check } from 'lucide-react-native';
import { MotiView, AnimatePresence } from 'moti';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useAudioRecorderState, type AudioRecorder } from 'expo-audio';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { useThemeColors, useThemeName } from '@/hooks/use-theme';
import { useReduceMotion } from '@/hooks/use-accessibility-motion';
import { useQuickRecording } from '@/hooks/use-quick-recording';
import { EASE_OUT } from '@/utils/motion';
import { formatDuration } from '@/utils/time';
import { NAV_BAR_HEIGHT } from '@/components/ui/FloatingTabBar';

// How long a hold must be sustained before it commits to recording. Long
// enough that a normal tap never triggers it, short enough that intent
// reads as instant once it does.
const LONG_PRESS_MS = 380;

// Vertical drag (px) while holding that arms/disarms "release to cancel" —
// separate enter/exit distances (hysteresis) so the state doesn't flicker
// right at the boundary.
const CANCEL_ENTER_PX = 70;
const CANCEL_EXIT_PX = 40;

// How long the "Saved"/"Discarded" tail keeps the overlay up after release,
// before it disappears on its own.
const TAIL_MS = 650;

const SPRING = { type: 'spring' as const, damping: 20, stiffness: 260, mass: 0.6 };

type HoldPhase = 'idle' | 'charging' | 'recording' | 'cancelling';
type OverlayTail = 'finishing' | 'saved' | 'discarded' | null;

/**
 * ActionCluster — one floating action button for capture, not two.
 *
 * Tap reveals a small menu (Record / Note) for the deliberate path — full
 * screen, category picker, manual save. Holding skips all of that: it
 * starts recording immediately inline (no navigation), shows a small
 * floating indicator near the FAB, and releasing stops and auto-saves —
 * mirroring the hold-to-record convention from WhatsApp/Telegram voice
 * messages. Sliding up while held arms "release to cancel", same as those
 * apps' slide-to-cancel gesture.
 */
export function ActionCluster() {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const reduceMotion = useReduceMotion();
  const { audioRecorder, start, finish } = useQuickRecording();

  const [expanded, setExpanded] = useState(false);
  const [holdPhase, setHoldPhase] = useState<HoldPhase>('idle');
  const [tail, setTail] = useState<OverlayTail>(null);

  // Pressable doesn't reliably suppress onPress after onLongPress fires,
  // so we track it ourselves to avoid also toggling the menu on release.
  const longPressFired = useRef(false);
  const startTouchY = useRef(0);
  const tailTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // start() awaits real async work (permission + recorder prep). If the
  // finger lifts before it resolves, the gesture is already over by the
  // time we'd flip to "recording" — this ref lets beginHold notice and
  // immediately discard instead of leaving the mic running unattended.
  const isPressed = useRef(false);

  useEffect(() => {
    return () => {
      if (tailTimeout.current) clearTimeout(tailTimeout.current);
    };
  }, []);

  const entrance = reduceMotion
    ? {
        from: { opacity: 0 },
        animate: { opacity: 1 },
        transition: { type: 'timing' as const, duration: 200, easing: EASE_OUT },
      }
    : {
        from: { opacity: 0, translateY: 24, scale: 0.9 },
        animate: { opacity: 1, translateY: 0, scale: 1 },
        transition: { type: 'timing' as const, duration: 300, delay: 80, easing: EASE_OUT },
      };

  const closeMenu = () => setExpanded(false);

  // The tap-menu's "Record" option and the accessibility fallback both use
  // the full manual screen — deliberate category pick, explicit Cancel/Save.
  const goRecordScreen = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpanded(false);
    router.push('/dump' as any);
  };

  const goNote = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpanded(false);
    router.push('/capture' as any);
  };

  const beginHold = async () => {
    const result = await start();
    if (result !== 'ok') {
      setHoldPhase('idle');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      if (result === 'permission-denied') {
        Alert.alert('Permission required', 'Please enable microphone access to record thoughts.');
      } else {
        Alert.alert(
          'Microphone error',
          'Could not start recording. Check that the app has microphone permission in Settings.',
        );
      }
      return;
    }
    if (!isPressed.current) {
      // Finger already lifted while we were still awaiting permission/prep
      // — the gesture ended before recording could visibly begin. Discard
      // rather than leave the mic recording with no one holding the button.
      finish('general', false);
      setHoldPhase('idle');
      return;
    }
    setHoldPhase('recording');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const endHold = (phaseAtRelease: HoldPhase) => {
    if (phaseAtRelease !== 'recording' && phaseAtRelease !== 'cancelling') {
      setHoldPhase('idle');
      return;
    }
    const wantsSave = phaseAtRelease === 'recording';
    setHoldPhase('idle');
    setTail('finishing');
    if (tailTimeout.current) clearTimeout(tailTimeout.current);

    finish('general', wantsSave).then((item) => {
      const saved = wantsSave && !!item;
      setTail(saved ? 'saved' : 'discarded');
      if (saved) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      tailTimeout.current = setTimeout(() => setTail(null), TAIL_MS);
    });
  };

  const handlePressMove = (e: GestureResponderEvent) => {
    if (holdPhase !== 'recording' && holdPhase !== 'cancelling') return;
    const deltaY = startTouchY.current - e.nativeEvent.pageY;
    if (holdPhase === 'recording' && deltaY > CANCEL_ENTER_PX) {
      setHoldPhase('cancelling');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else if (holdPhase === 'cancelling' && deltaY < CANCEL_EXIT_PX) {
      setHoldPhase('recording');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const showOverlay = holdPhase === 'recording' || holdPhase === 'cancelling' || tail !== null;
  const cancelling = holdPhase === 'cancelling';

  const iconMode: 'mic' | 'close' | 'cancel' =
    holdPhase === 'cancelling' ? 'cancel' : expanded ? 'close' : 'mic';
  const fabTint =
    holdPhase === 'recording' || holdPhase === 'cancelling' ? colors.error : colors.accent;
  const fabInk = holdPhase === 'recording' || holdPhase === 'cancelling' ? colors.errorInk : colors.accentInk;

  return (
    <>
      {/* Backdrop — only present (and hit-testable) while the tap-menu is
          open, so tapping anywhere else closes it without ever stealing
          touches from the rest of the app while collapsed. */}
      {expanded && (
        <Pressable
          onPress={closeMenu}
          style={StyleSheet.absoluteFillObject}
          className="z-40"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      )}

      <View
        pointerEvents="box-none"
        className="absolute bottom-0 right-0 z-50 items-end"
        style={{
          paddingRight: 16,
          paddingBottom: insets.bottom + NAV_BAR_HEIGHT + 16,
        }}
      >
        <MotiView {...entrance} style={styles.stack}>
          <AnimatePresence>
            {showOverlay && (
              <RecordingOverlay
                key="recording-overlay"
                recorder={audioRecorder}
                cancelling={cancelling}
                tail={tail}
                reduceMotion={reduceMotion}
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {expanded && (
              <MiniAction
                key="record"
                label="Record"
                icon={<Mic size={20} color={colors.onPrimaryContainer} strokeWidth={2.2} />}
                bg={colors.primaryContainer}
                delay={60}
                reduceMotion={reduceMotion}
                onPress={goRecordScreen}
              />
            )}
            {expanded && (
              <MiniAction
                key="note"
                label="Note"
                icon={<SquarePen size={20} color={colors.fg} strokeWidth={1.9} />}
                bg={colors.surfaceHighest}
                delay={0}
                reduceMotion={reduceMotion}
                onPress={goNote}
              />
            )}
          </AnimatePresence>

          {/* Main FAB — tap to open the menu; hold to record inline. */}
          <View style={styles.mainWrap}>
            {/* Charging ring — grows continuously while held, so the hold
                itself reads as "in progress" before it commits. */}
            {holdPhase === 'charging' && !reduceMotion && (
              <MotiView
                from={{ scale: 1, opacity: 0.35 }}
                animate={{ scale: 1.5, opacity: 0 }}
                transition={{ type: 'timing', duration: LONG_PRESS_MS, easing: EASE_OUT }}
                style={[styles.chargingRing, { borderColor: colors.accent }]}
                pointerEvents="none"
              />
            )}
            {/* Breathing ring while actually recording — a live pulse,
                tinted to match the cancel/record state. */}
            {(holdPhase === 'recording' || holdPhase === 'cancelling') && !reduceMotion && (
              <MotiView
                from={{ scale: 1, opacity: 0.35 }}
                animate={{ scale: 1.4, opacity: 0 }}
                transition={{ type: 'timing', duration: 1400, loop: true, easing: EASE_OUT }}
                style={[styles.chargingRing, { borderColor: fabTint }]}
                pointerEvents="none"
              />
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                expanded ? 'Close quick actions' : 'Capture — tap for options, hold to record'
              }
              accessibilityActions={[{ name: 'longpress', label: 'Record a voice note' }]}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === 'longpress') goRecordScreen();
              }}
              android_ripple={{ color: 'rgba(255,255,255,0.18)', borderless: false, radius: 30 }}
              delayLongPress={LONG_PRESS_MS}
              onPressIn={(e) => {
                longPressFired.current = false;
                isPressed.current = true;
                startTouchY.current = e.nativeEvent.pageY;
                setHoldPhase('charging');
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              // onPressMove isn't in Pressable's public TS types, but it's a
              // real, first-class Pressability prop at runtime — unlike a
              // raw onTouchMove, it's guaranteed to fire throughout the same
              // press/long-press gesture Pressability is already tracking,
              // which is what makes the slide-to-cancel drag reliable.
              {...({ onPressMove: handlePressMove } as any)}
              onPressOut={() => {
                isPressed.current = false;
                endHold(holdPhase);
              }}
              onLongPress={() => {
                longPressFired.current = true;
                // A hold always wins over an already-open tap-menu — the
                // two shouldn't ever be visible at once.
                setExpanded(false);
                beginHold();
              }}
              onPress={() => {
                if (longPressFired.current) {
                  longPressFired.current = false;
                  return;
                }
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setExpanded((v) => !v);
              }}
              style={styles.mainFabTouchable}
            >
              <MotiView
                animate={{ backgroundColor: fabTint, scale: holdPhase === 'idle' ? 1 : 0.94 }}
                transition={{ type: 'timing', duration: 180 }}
                style={styles.mainFab}
              >
                <MotiView
                  animate={{ opacity: iconMode === 'mic' ? 1 : 0, scale: iconMode === 'mic' ? 1 : 0.5 }}
                  transition={reduceMotion ? { type: 'timing', duration: 150 } : SPRING}
                  style={StyleSheet.absoluteFillObject}
                >
                  <View style={styles.iconCenter}>
                    <Mic size={26} color={fabInk} strokeWidth={2.2} />
                  </View>
                </MotiView>
                <MotiView
                  animate={{ opacity: iconMode === 'close' ? 1 : 0, scale: iconMode === 'close' ? 1 : 0.5 }}
                  transition={reduceMotion ? { type: 'timing', duration: 150 } : SPRING}
                  style={StyleSheet.absoluteFillObject}
                >
                  <View style={styles.iconCenter}>
                    <X size={26} color={fabInk} strokeWidth={2.4} />
                  </View>
                </MotiView>
                <MotiView
                  animate={{ opacity: iconMode === 'cancel' ? 1 : 0, scale: iconMode === 'cancel' ? 1 : 0.5 }}
                  transition={reduceMotion ? { type: 'timing', duration: 150 } : SPRING}
                  style={StyleSheet.absoluteFillObject}
                >
                  <View style={styles.iconCenter}>
                    <Trash2 size={24} color={fabInk} strokeWidth={2.2} />
                  </View>
                </MotiView>
              </MotiView>
            </Pressable>
          </View>
        </MotiView>
      </View>
    </>
  );
}

function RecordingOverlay({
  recorder,
  cancelling,
  tail,
  reduceMotion,
}: {
  recorder: AudioRecorder;
  cancelling: boolean;
  tail: OverlayTail;
  reduceMotion: boolean;
}) {
  const colors = useThemeColors();
  const themeName = useThemeName();
  // Polls the recorder only while this overlay itself is mounted — i.e.
  // only during (and just after) an actual hold-to-record session, not for
  // the app's whole lifetime.
  const { durationMillis, metering } = useAudioRecorderState(recorder, 60);
  const isLive = tail === null;
  const tint = tail === 'saved' ? colors.accent : colors.error;

  const eyebrow =
    tail === 'saved'
      ? 'Saved'
      : tail === 'discarded'
        ? 'Discarded'
        : tail === 'finishing'
          ? 'Saving'
          : cancelling
            ? 'Release to cancel'
            : 'Recording';

  const hint = cancelling ? 'Release to discard' : 'Slide up to cancel · release to save';

  // Rough dBFS-ish → 0..1 normalization for the waveform bars. Not
  // scientifically precise — this is decoration, not a metering tool.
  const level = Math.max(0.12, Math.min(1, ((metering ?? -50) + 50) / 45));

  const motionProps = reduceMotion
    ? {
        from: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { type: 'timing' as const, duration: 150 },
      }
    : {
        from: { opacity: 0, translateY: 8, scale: 0.85 },
        animate: { opacity: 1, translateY: 0, scale: 1 },
        exit: { opacity: 0, translateY: 6, scale: 0.92 },
        transition: SPRING,
      };

  return (
    <MotiView {...motionProps} style={styles.overlayShadow}>
      <BlurView
        intensity={64}
        tint={themeName === 'dark' ? 'dark' : 'light'}
        style={styles.overlayCard}
      >
        {/* Soft color wash over the glass — ties the material to the
            current state (recording / cancelling / saved) without
            resorting to a flat, opaque card. */}
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: tint, opacity: 0.1 }]} />
        <View style={[styles.overlayBorder, { borderColor: tint, opacity: 0.35 }]} />

        <View className="flex-row items-center gap-1.5 mb-1">
          {isLive && !cancelling && (
            <MotiView
              from={{ opacity: 0.35 }}
              animate={{ opacity: reduceMotion ? 0.9 : 1 }}
              transition={
                reduceMotion
                  ? { type: 'timing', duration: 200 }
                  : { type: 'timing', duration: 650, loop: true }
              }
              style={[styles.recDot, { backgroundColor: tint }]}
            />
          )}
          {tail === 'saved' && <Check size={12} color={tint} strokeWidth={2.6} />}
          {(tail === 'discarded' || cancelling) && (
            <Trash2 size={11} color={tint} strokeWidth={2.4} />
          )}
          <Text
            className="font-sans-semi text-[10px] uppercase tracking-wider"
            style={{ color: tint }}
          >
            {eyebrow}
          </Text>
        </View>

        {isLive && (
          <Text className="font-sans-semi text-[28px] text-fg mb-2.5" style={{ letterSpacing: -0.5 }}>
            {formatDuration(durationMillis)}
          </Text>
        )}

        {isLive && (
          <View className="flex-row items-center justify-center gap-0.75 h-9 mb-2.5">
            {BAR_VARIANCE.map((variance, i) => (
              <MotiView
                key={i}
                animate={{ scaleY: Math.max(0.12, Math.min(1, level * variance)) }}
                transition={{ type: 'timing', duration: 90 }}
                style={[styles.bar, { backgroundColor: tint, transformOrigin: 'bottom' } as any]}
              />
            ))}
          </View>
        )}

        {isLive && (
          <Text className="font-sans text-[11px] text-fg-secondary">{hint}</Text>
        )}
      </BlurView>
    </MotiView>
  );
}

// Center-weighted so the bars read like an actual waveform silhouette
// rather than a flat row of equal-ish blips.
const BAR_VARIANCE = [0.35, 0.55, 0.8, 1, 0.85, 1.05, 0.75, 0.5, 0.3];

function MiniAction({
  label,
  icon,
  bg,
  onPress,
  delay,
  reduceMotion,
}: {
  label: string;
  icon: React.ReactNode;
  bg: string;
  onPress: () => void;
  delay: number;
  reduceMotion: boolean;
}) {
  const colors = useThemeColors();

  const motionProps = reduceMotion
    ? {
        from: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { type: 'timing' as const, duration: 150 },
      }
    : {
        from: { opacity: 0, translateY: 12, scale: 0.7 },
        animate: { opacity: 1, translateY: 0, scale: 1 },
        exit: { opacity: 0, translateY: 8, scale: 0.7 },
        transition: { ...SPRING, delay },
      };

  return (
    <MotiView {...motionProps} style={styles.miniRow}>
      <View style={[styles.miniLabel, { backgroundColor: colors.surfaceHigh, borderColor: colors.border }]}>
        <Text className="font-sans-medium text-xs" style={{ color: colors.fg }}>
          {label}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        android_ripple={{ color: colors.border, borderless: false, radius: 24 }}
        onPress={onPress}
        style={[styles.miniFab, { backgroundColor: bg }]}
      >
        {icon}
      </Pressable>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  stack: {
    alignItems: 'flex-end',
    gap: 16,
  },
  mainWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainFabTouchable: {
    width: 60,
    height: 60,
    borderRadius: 30,
    overflow: 'hidden',
    // M3 elevation level 3.
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    shadowOpacity: 0.22,
    elevation: 8,
  },
  mainFab: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chargingRing: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
  },
  iconCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
  },
  miniLabel: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  miniFab: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    // M3 elevation level 2.
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    shadowOpacity: 0.16,
    elevation: 4,
  },
  overlayShadow: {
    // Pulled slightly closer to the FAB than the mini-menu's gap — reads
    // as emerging from the button rather than a detached popup.
    marginBottom: -6,
    borderRadius: 26,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 20,
    shadowOpacity: 0.22,
    elevation: 10,
  },
  overlayCard: {
    width: 264,
    borderRadius: 26,
    padding: 20,
    overflow: 'hidden',
  },
  overlayBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 26,
    borderWidth: 1.5,
  },
  recDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  bar: {
    width: 5,
    height: 32,
    borderRadius: 2.5,
  },
});
