import React, { useEffect, useRef, useState } from 'react';
import { Alert, View, Pressable, StyleSheet, Text, GestureResponderEvent } from 'react-native';
import { Mic, SquarePen, X, Trash2, Check } from 'lucide-react-native';
import { MotiView, AnimatePresence } from 'moti';
import * as Haptics from 'expo-haptics';
import { useAudioRecorderState, type AudioRecorder } from 'expo-audio';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { useThemeColors } from '@/hooks/use-theme';
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

  // Tracks whether the hold has committed to recording, so a plain tap
  // (timer never fires) doesn't also get treated as a release-to-save.
  const longPressFired = useRef(false);
  const startTouchY = useRef(0);
  const tailTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Our own long-press timer — see the comment on the responder handlers
  // below for why this isn't Pressable's onLongPress/delayLongPress.
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors holdPhase for gesture *decisions* (state stays for rendering) —
  // always current the instant it's written, with no render/effect gap.
  const holdPhaseRef = useRef<HoldPhase>('idle');
  // start() awaits real async work (permission + recorder prep). If the
  // finger lifts before it resolves, the gesture is already over by the
  // time we'd flip to "recording" — this ref lets beginHold notice and
  // immediately discard instead of leaving the mic running unattended.
  const isPressed = useRef(false);

  useEffect(() => {
    return () => {
      if (tailTimeout.current) clearTimeout(tailTimeout.current);
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    };
  }, []);

  // Single point of truth update: keeps the ref and the render state in
  // lockstep so every call site only has to make one call.
  const setPhase = (phase: HoldPhase) => {
    holdPhaseRef.current = phase;
    setHoldPhase(phase);
  };

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
      setPhase('idle');
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
      setPhase('idle');
      return;
    }
    setPhase('recording');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const endHold = (phaseAtRelease: HoldPhase) => {
    if (phaseAtRelease !== 'recording' && phaseAtRelease !== 'cancelling') {
      setPhase('idle');
      return;
    }
    const wantsSave = phaseAtRelease === 'recording';
    setPhase('idle');
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

  const handleDragMove = (e: GestureResponderEvent) => {
    const current = holdPhaseRef.current;
    if (current !== 'recording' && current !== 'cancelling') return;
    const deltaY = startTouchY.current - e.nativeEvent.pageY;
    if (current === 'recording' && deltaY > CANCEL_ENTER_PX) {
      setPhase('cancelling');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else if (current === 'cancelling' && deltaY < CANCEL_EXIT_PX) {
      setPhase('recording');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  // The FAB's gesture is handled via the raw Responder System instead of
  // Pressable, deliberately. Pressable/Pressability sits its own state
  // machine between us and the touch stream (press-rect tracking, a
  // long-press deactivation distance, responder negotiation with any
  // ancestor pannable/scrollable view) — and a fast upward drag is exactly
  // the kind of gesture that negotiation can quietly reassign mid-flight.
  // That lines up with what was actually observed: the visual "cancelling"
  // state always appeared correctly, but release only *sometimes* honored
  // it — consistent with the responder occasionally being taken/terminated
  // through a path Pressable's onPressOut doesn't cover, rather than a
  // plain closure/timing bug (which the earlier holdPhaseRef fix already
  // ruled out — the ref stayed current, and it still misfired). Owning the
  // responder outright removes that whole negotiation layer: we grant it on
  // touch start, refuse to give it up mid-gesture, and drive our own
  // long-press timer, so every release is `onResponderRelease` on the exact
  // gesture we started, never something Pressability decided on our behalf.
  const handleGrant = (e: GestureResponderEvent) => {
    longPressFired.current = false;
    isPressed.current = true;
    startTouchY.current = e.nativeEvent.pageY;
    setPhase('charging');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      // A hold always wins over an already-open tap-menu — the two
      // shouldn't ever be visible at once.
      setExpanded(false);
      beginHold();
    }, LONG_PRESS_MS);
  };

  const clearLongPressTimer = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleRelease = () => {
    clearLongPressTimer();
    isPressed.current = false;
    const wasLongPress = longPressFired.current;
    longPressFired.current = false;
    // Always runs — resolves charging/recording/cancelling back to idle,
    // and saves/discards when a hold had actually committed.
    endHold(holdPhaseRef.current);
    if (!wasLongPress) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setExpanded((v) => !v);
    }
  };

  // Fires if the OS/another view rips the responder away mid-gesture
  // (a real release never reaches us in that case). Ambiguous intent, so
  // always discard rather than risk a save the user never actually asked
  // for by releasing normally.
  const handleTerminate = () => {
    clearLongPressTimer();
    isPressed.current = false;
    longPressFired.current = false;
    const phaseAtEnd = holdPhaseRef.current;
    if (phaseAtEnd === 'recording' || phaseAtEnd === 'cancelling') {
      endHold('cancelling');
    } else {
      setPhase('idle');
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
            <View
              accessible
              accessibilityRole="button"
              accessibilityLabel={
                expanded ? 'Close quick actions' : 'Capture — tap for options, hold to record'
              }
              accessibilityActions={[{ name: 'longpress', label: 'Record a voice note' }]}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === 'longpress') goRecordScreen();
              }}
              // Raw Responder System, not Pressable — see the comment above
              // handleGrant for why. We claim the responder immediately and
              // refuse to release it until the gesture ends on our terms.
              onStartShouldSetResponder={() => true}
              onResponderTerminationRequest={() => false}
              onResponderGrant={handleGrant}
              onResponderMove={handleDragMove}
              onResponderRelease={handleRelease}
              onResponderTerminate={handleTerminate}
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
            </View>
          </View>
        </MotiView>
      </View>
    </>
  );
}

const WAVEFORM_BARS = 9;
// Rough dBFS-ish baseline so bars start small instead of flickering empty
// before the first real metering sample arrives.
const METERING_BASELINE = -50;

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
  // Polls the recorder only while this overlay itself is mounted — i.e.
  // only during (and just after) an actual hold-to-record session, not for
  // the app's whole lifetime.
  const { durationMillis, metering } = useAudioRecorderState(recorder, 60);
  const isLive = tail === null;
  const tint = tail === 'saved' ? colors.accent : colors.error;

  // A real rolling window of actual metering samples (one per poll tick)
  // rather than one instantaneous value fanned out across arbitrary shape
  // constants — each bar reflects an actual past instant, oldest to newest.
  const [levels, setLevels] = useState<number[]>(() =>
    Array(WAVEFORM_BARS).fill(METERING_BASELINE),
  );
  useEffect(() => {
    setLevels((prev) => [...prev.slice(1), metering ?? METERING_BASELINE]);
  }, [metering]);

  const label =
    tail === 'saved'
      ? 'Saved'
      : tail === 'discarded'
        ? 'Discarded'
        : tail === 'finishing'
          ? 'Saving…'
          : cancelling
            ? 'Release to cancel'
            : 'Recording';

  const hint = cancelling ? 'Release to discard' : 'Slide up to cancel · release to save';

  const motionProps = reduceMotion
    ? {
        from: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { type: 'timing' as const, duration: 150 },
      }
    : {
        from: { opacity: 0, translateY: 6, scale: 0.9 },
        animate: { opacity: 1, translateY: 0, scale: 1 },
        exit: { opacity: 0, translateY: 4, scale: 0.94 },
        transition: SPRING,
      };

  return (
    <MotiView {...motionProps} style={styles.overlayShadow}>
      <View style={[styles.overlayCard, { backgroundColor: colors.surfaceHigh, borderColor: tint }]}>
        <View className="flex-row items-center justify-between mb-1.5">
          <View className="flex-row items-center gap-1.5">
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
              {label}
            </Text>
          </View>
          {isLive && (
            <Text className="font-sans-medium text-xs" style={{ color: colors.fgSecondary }}>
              {formatDuration(durationMillis)}
            </Text>
          )}
        </View>

        {isLive && (
          <View className="flex-row items-center gap-0.5 h-7 mb-1.5">
            {levels.map((sample, i) => {
              const level = Math.max(0.12, Math.min(1, (sample + 50) / 45));
              return (
                <MotiView
                  key={i}
                  animate={{ scaleY: level }}
                  transition={{ type: 'timing', duration: 80 }}
                  style={[styles.bar, { backgroundColor: tint, transformOrigin: 'bottom' } as any]}
                />
              );
            })}
          </View>
        )}

        {isLive && (
          <Text className="font-sans text-[11px] text-fg-tertiary">{hint}</Text>
        )}
      </View>
    </MotiView>
  );
}

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
    borderRadius: 20,
    // Matches Glass's "regular" elevated-surface recipe (see
    // components/ui/Glass.tsx) — the app's own flat M3 language, not a
    // bespoke material just for this one component.
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 8,
    shadowOpacity: 0.16,
    elevation: 3,
  },
  overlayCard: {
    width: 224,
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 14,
    overflow: 'hidden',
  },
  recDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  bar: {
    width: 4,
    height: 24,
    borderRadius: 2,
  },
});
