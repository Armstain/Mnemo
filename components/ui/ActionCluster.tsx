import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  GestureResponderEvent,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Text } from '@/components/ui/Text';
import { MotiView, AnimatePresence } from 'moti';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Svg, { Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useGlobalSearchParams, usePathname } from 'expo-router';

import { useThemeColors } from '@/hooks/use-theme';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useReduceMotion } from '@/hooks/use-accessibility-motion';
import { useSpeechCapture } from '@/hooks/use-speech-capture';
import { saveVoiceNote } from '@/lib/capture';
import { aiEnabled } from '@/lib/ai-mode';
import { DUR_BASE, DUR_FAST, EASE_IN_OUT, EASE_OUT, EXIT_QUICK, REDUCED, SPRING_NAV } from '@/utils/motion';
import { formatDuration } from '@/utils/time';
import {
  CAPTURE_BUTTON_SIZE,
  CAPTURE_RING_SIZE,
  CENTER_BUTTON_RISE,
  NAV_BAR_HEIGHT,
  navBottom,
} from '@/components/ui/FloatingTabBar';
import { setCaptureActive } from '@/hooks/use-capture-active';
import { OpenRing } from '@/components/ui/ThreadRing';
import AsyncStorage from '@react-native-async-storage/async-storage';

// How long a hold must last before it commits to recording. Long enough that
// a normal tap never triggers it; the red fill inside the button shows the
// hold filling up over exactly this time.
const LONG_PRESS_MS = 320;

// Distance from the button's centre up to the bin's centre. Dragging past
// CANCEL_ENTER_PX arms "release to discard"; dropping back under
// CANCEL_EXIT_PX disarms it (two thresholds, so it doesn't flicker).
const CANCEL_DISTANCE = 116;
const CANCEL_ENTER_PX = 84;
const CANCEL_EXIT_PX = 56;
// Light ticks on the way up, so the slide has notches you can feel.
const DETENTS_PX = [28, 56];

// How long the result ("Saved", "Discarded") stays up after release.
const TAIL_MS = { saved: 1400, discarded: 900, tooShort: 1600 } as const;

// Main button diameter, and the brand ring drawn around it.
const FAB_SIZE = CAPTURE_BUTTON_SIZE;
/** The brand ring around the button; the tab bar's notch is shaped for it. */
const ORBIT_SIZE = CAPTURE_RING_SIZE;
/** The ring's stroke as a share of its size: about 3.5px. */
const ORBIT_WEIGHT = 0.05;
/** The closed ring at rest: a hairline under the open ring's weight. */
const REST_RING_STROKE = 2;
const BIN_SIZE = 56;
const FAB_CENTER = FAB_SIZE / 2;

// The tap menu: two options either side, above the button.
const OPTION_X = 92;
const OPTION_CIRCLE = 60;
const OPTION_CENTER_Y = FAB_CENTER + 108;

// Everything the button shows lives in one box above it, so every target is
// inside its parent's bounds (Android drops touches outside them).
const STAGE_HEIGHT = 380;

const SNAP = { damping: 18, stiffness: 260, mass: 0.6 };

type HoldPhase = 'idle' | 'charging' | 'recording' | 'cancelling';
type Tail =
  | { kind: 'finishing' }
  | { kind: 'saved'; where: string }
  | { kind: 'discarded' }
  | { kind: 'tooShort' }
  | null;

/**
 * ActionCluster: the capture button in the middle of the tab bar.
 *
 * Tap: the + turns into an ×, the page dims, and two choices fan out:
 * Write and Record. Hold: the button fills red, clicks, and records right
 * here. Release saves. Slide up into the bin to discard. On a thread's
 * screen everything it captures joins that thread.
 */
export function ActionCluster({ visible = true }: { visible?: boolean }) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const reduceMotion = useReduceMotion();
  // Live speech-to-text; the level drives the waveform and the voice halo.
  const levelNow = useRef(0);
  const speech = useSpeechCapture({ onLevel: (v) => (levelNow.current = v) });
  const store = useMnemoStore();

  const pathname = usePathname();
  const { id: routeId } = useGlobalSearchParams<{ id?: string }>();
  const { items, focusThreadId, getFocusThreadId } = useMnemoStore();
  const currentThread =
    pathname.includes('context') && typeof routeId === 'string'
      ? items.find((i) => i.id === routeId)
      : undefined;
  // Anywhere else, captures go to the focus thread if one is set (the
  // Write and Record screens resolve that themselves).
  const focusThread =
    !currentThread && focusThreadId ? items.find((i) => i.id === focusThreadId) : undefined;
  const target = currentThread ?? focusThread;
  const threadParams = currentThread ? { threadId: currentThread.id } : {};

  const [expanded, setExpanded] = useState(false);

  // "Hold to record" hint above the button, until hold has been used once
  // or the hint is dismissed.
  const [showHoldHint, setShowHoldHint] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(HOLD_HINT_KEY)
      .then((done) => setShowHoldHint(!done))
      .catch(() => {});
  }, []);
  const retireHoldHint = () => {
    setShowHoldHint(false);
    AsyncStorage.setItem(HOLD_HINT_KEY, '1').catch(() => {});
  };
  const [holdPhase, setHoldPhase] = useState<HoldPhase>('idle');
  const [tail, setTail] = useState<Tail>(null);

  // How far the button has been dragged up (px), and the live voice level
  // (0..1). Both are read on the UI thread by the animated styles below.
  const dragY = useSharedValue(0);
  const level = useSharedValue(0);

  const longPressFired = useRef(false);
  const startTouchY = useRef(0);
  const detent = useRef(0);
  const recordingSince = useRef(0);
  const tailTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Our own long-press timer; see handleGrant for why this isn't Pressable.
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors holdPhase for gesture decisions, current the instant it's
  // written (state stays for rendering).
  const holdPhaseRef = useRef<HoldPhase>('idle');
  // start() awaits permission and recorder prep. If the finger lifts before
  // it resolves, beginHold sees this and discards instead of leaving the
  // mic running with nobody holding the button.
  const isPressed = useRef(false);

  useEffect(() => {
    return () => {
      if (tailTimeout.current) clearTimeout(tailTimeout.current);
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    };
  }, []);

  const setPhase = (phase: HoldPhase) => {
    holdPhaseRef.current = phase;
    setHoldPhase(phase);
  };

  // Hidden rather than unmounted (see app/(tabs)/_layout.tsx), so coming
  // back from a detail screen doesn't replay the entrance.
  const entrance = reduceMotion
    ? { from: { opacity: 0 }, animate: { opacity: visible ? 1 : 0 }, transition: REDUCED }
    : {
        from: { opacity: 0, translateY: 24, scale: 0.9 },
        animate: {
          opacity: visible ? 1 : 0,
          translateY: visible ? 0 : 24,
          scale: visible ? 1 : 0.9,
        },
        transition: { type: 'timing' as const, duration: DUR_BASE, easing: EASE_OUT },
      };

  useEffect(() => {
    if (!visible) setExpanded(false);
  }, [visible]);

  const closeMenu = () => {
    Haptics.selectionAsync();
    setExpanded(false);
  };

  const goRecordScreen = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpanded(false);
    router.push({ pathname: '/dump', params: threadParams });
  };

  const goNote = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpanded(false);
    router.push({ pathname: '/capture', params: threadParams });
  };

  const showTail = (next: Exclude<Tail, null | { kind: 'finishing' }>) => {
    setTail(next);
    if (tailTimeout.current) clearTimeout(tailTimeout.current);
    tailTimeout.current = setTimeout(() => setTail(null), TAIL_MS[next.kind]);
  };

  const beginHold = async () => {
    const result = await speech.start();
    if (result !== 'ok') {
      setPhase('idle');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (result === 'permission-denied') {
        Alert.alert('Microphone is off', 'Allow the microphone and speech recognition in Settings to record thoughts.');
      } else {
        Alert.alert(
          "Can't listen on this phone",
          "Speech recognition isn't available. On Android it comes with the Google app. You can still write notes.",
        );
      }
      return;
    }
    if (!isPressed.current) {
      speech.cancel();
      setPhase('idle');
      return;
    }
    recordingSince.current = Date.now();
    setPhase('recording');
    if (showHoldHint) retireHoldHint();
    // The click that says "you're recording now".
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
  };

  const endHold = (phaseAtRelease: HoldPhase) => {
    dragY.value = reduceMotion ? 0 : withSpring(0, SNAP);
    level.value = 0;
    if (phaseAtRelease !== 'recording' && phaseAtRelease !== 'cancelling') {
      setPhase('idle');
      return;
    }
    const wantsSave = phaseAtRelease === 'recording';
    setPhase('idle');
    if (!wantsSave) {
      speech.cancel();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      showTail({ kind: 'discarded' });
      return;
    }
    setTail({ kind: 'finishing' });

    // Focus is checked again now: it may have lapsed while the app sat open.
    const focusNow = currentThread ? undefined : focusThread && getFocusThreadId() === focusThread.id ? focusThread : undefined;
    const saveTo = currentThread ?? focusNow;
    speech.stop().then(({ words, audio }) => {
      if (!words.trim() && audio.length === 0) {
        // Nothing was heard (or the hold was a slip): there's nothing to save.
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        showTail({ kind: 'tooShort' });
        return;
      }
      saveVoiceNote({
        text: words,
        audio,
        category: 'general',
        threadId: saveTo?.id,
        filing: currentThread ? { by: 'user' } : focusNow ? { by: 'focus' } : undefined,
        store,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showTail({ kind: 'saved', where: saveTo?.title ?? '' });
    });
  };

  const handleDragMove = (e: GestureResponderEvent) => {
    const current = holdPhaseRef.current;
    if (current !== 'recording' && current !== 'cancelling') return;
    const raw = Math.max(0, startTouchY.current - e.nativeEvent.pageY);

    if (current === 'recording') {
      const step = DETENTS_PX.filter((d) => raw >= d).length;
      if (step !== detent.current) {
        detent.current = step;
        Haptics.selectionAsync();
      }
    }

    if (current === 'recording' && raw > CANCEL_ENTER_PX) {
      setPhase('cancelling');
      // A heavier bump as the button drops into the bin.
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      dragY.value = reduceMotion ? CANCEL_DISTANCE : withSpring(CANCEL_DISTANCE, SNAP);
    } else if (current === 'cancelling' && raw < CANCEL_EXIT_PX) {
      setPhase('recording');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      dragY.value = reduceMotion ? raw : withSpring(raw, SNAP);
    } else if (current === 'recording') {
      // Follows the finger, so the button feels like something you carry.
      dragY.value = Math.min(raw, CANCEL_DISTANCE);
    }
  };

  // The button owns the raw responder instead of using Pressable: Pressable
  // negotiates the responder with scroll views and its own press-rect
  // logic, and a fast upward drag is exactly the gesture that negotiation
  // can take away mid-flight, which made slide-to-cancel unreliable. Here we
  // claim the responder on touch, refuse to hand it over, and run our own
  // long-press timer, so every release lands on the gesture we started.
  const handleGrant = (e: GestureResponderEvent) => {
    longPressFired.current = false;
    isPressed.current = true;
    detent.current = 0;
    startTouchY.current = e.nativeEvent.pageY;
    setPhase('charging');
    Haptics.selectionAsync();
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
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
    endHold(holdPhaseRef.current);
    if (!wasLongPress) {
      if (expanded) {
        Haptics.selectionAsync();
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      setExpanded((v) => !v);
    }
  };

  // The OS took the gesture away (a real release never arrives). Intent is
  // unclear, so discard rather than save something nobody released.
  const handleTerminate = () => {
    clearLongPressTimer();
    isPressed.current = false;
    longPressFired.current = false;
    const phaseAtEnd = holdPhaseRef.current;
    if (phaseAtEnd === 'recording' || phaseAtEnd === 'cancelling') {
      endHold('cancelling');
    } else {
      endHold('idle');
    }
  };

  const live = holdPhase === 'recording' || holdPhase === 'cancelling';

  // Lets the tab bar move its dot under this button while it's in use, and
  // close the menu when a tab is tapped.
  useEffect(() => {
    setCaptureActive(expanded || live, () => setExpanded(false));
  }, [expanded, live]);
  const cancelling = holdPhase === 'cancelling';
  const dimmed = expanded || live || tail !== null;

  const fabColor = expanded ? colors.fg : live ? colors.error : colors.accent;
  const fabInk = expanded ? colors.bg : live ? colors.errorInk : colors.accentInk;
  const glyph: 'plus' | 'mic' | 'trash' = cancelling ? 'trash' : live ? 'mic' : 'plus';

  const puckStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -dragY.value }],
  }));

  // A soft disc behind the button that swells with your voice.
  const voiceHaloStyle = useAnimatedStyle(() => ({
    opacity: interpolate(level.value, [0, 1], [0.16, 0.34]),
    transform: [
      { translateY: -dragY.value },
      { scale: interpolate(level.value, [0, 1], [1.08, 1.55], Extrapolation.CLAMP) },
    ],
  }));

  return (
    <>
      {/* Dims the page under the menu or a recording so the controls are the
          only thing to look at. Tapping it closes the menu; while recording
          it ignores touches (the finger is on the button anyway). */}
      <AnimatePresence>
        {dimmed && (
          <MotiView
            key="scrim"
            from={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reduceMotion ? REDUCED : { type: 'timing', duration: DUR_BASE, easing: EASE_OUT }}
            exitTransition={EXIT_QUICK}
            pointerEvents={expanded ? 'auto' : 'none'}
            style={[StyleSheet.absoluteFill, styles.scrimLayer]}
          >
            <Pressable
              onPress={closeMenu}
              style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg, opacity: 0.9 }]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
          </MotiView>
        )}
      </AnimatePresence>

      <View
        pointerEvents={visible ? 'box-none' : 'none'}
        accessibilityElementsHidden={!visible}
        importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
        style={[
          styles.dock,
          {
            // Same bottom gap as FloatingTabBar, then up so the button rises
            // CENTER_BUTTON_RISE above the bar's top edge.
            paddingBottom: navBottom(insets.bottom) + NAV_BAR_HEIGHT + CENTER_BUTTON_RISE - FAB_SIZE,
          },
        ]}
      >
        <MotiView {...entrance} pointerEvents="box-none" style={styles.stage}>
          {/* ── Tap menu ── */}
          <AnimatePresence>
            {expanded && (
              <MenuHint
                key="hint"
                threadTitle={target?.title}
                reduceMotion={reduceMotion}
              />
            )}
            {expanded && (
              <MenuOption
                key="write"
                x={-OPTION_X}
                icon="pencil"
                label="Write"
                caption="Type a note"
                tone="neutral"
                delay={0}
                reduceMotion={reduceMotion}
                onPress={goNote}
              />
            )}
            {expanded && (
              <MenuOption
                key="record"
                x={OPTION_X}
                icon="mic"
                label="Record"
                caption="Talk it through"
                tone="accent"
                delay={40}
                reduceMotion={reduceMotion}
                onPress={goRecordScreen}
              />
            )}
          </AnimatePresence>

          {/* ── First-run hint: hold is otherwise invisible ── */}
          <AnimatePresence>
            {showHoldHint && !expanded && holdPhase === 'idle' && tail === null && pathname === '/' && (
              <HoldHint key="hold-hint" reduceMotion={reduceMotion} onDismiss={retireHoldHint} />
            )}
          </AnimatePresence>

          {/* ── Recording ── */}
          <AnimatePresence>
            {(live || tail !== null) && (
              <RecordingCard
                key="card"
                transcript={speech.text}
                levelNow={levelNow}
                startedAt={recordingSince.current}
                level={level}
                cancelling={cancelling}
                tail={tail}
                threadTitle={target?.title}
                reduceMotion={reduceMotion}
              />
            )}
          </AnimatePresence>
          <AnimatePresence>
            {live && (
              <CancelLane
                key="lane"
                dragY={dragY}
                armed={cancelling}
                reduceMotion={reduceMotion}
              />
            )}
          </AnimatePresence>

          {/* ── The button ── */}
          <View pointerEvents="box-none" style={styles.fabSlot}>
            {live && !reduceMotion && (
              <Animated.View
                pointerEvents="none"
                style={[styles.halo, { backgroundColor: colors.error }, voiceHaloStyle]}
              />
            )}
            <Animated.View pointerEvents="box-none" style={[styles.fabSlotInner, puckStyle]}>
              {/* At rest, a closed ring, even all round like the notch it
                  sits in. Held, it gives way to the brand's open ring, red,
                  spinning while it records: the loop that isn't closed yet. */}
              <MotiView
                pointerEvents="none"
                style={styles.orbit}
                from={{ opacity: 0, scale: reduceMotion ? 1 : 0.92 }}
                animate={{ opacity: expanded || live || holdPhase === 'charging' ? 0 : 1, scale: 1 }}
                transition={{ type: 'timing', duration: DUR_BASE, easing: EASE_OUT }}
              >
                <Svg width={ORBIT_SIZE} height={ORBIT_SIZE}>
                  <Circle
                    cx={ORBIT_SIZE / 2}
                    cy={ORBIT_SIZE / 2}
                    r={ORBIT_SIZE / 2 - REST_RING_STROKE}
                    stroke={colors.accent}
                    strokeOpacity={0.4}
                    strokeWidth={REST_RING_STROKE}
                    fill="none"
                  />
                </Svg>
              </MotiView>
              <MotiView
                pointerEvents="none"
                style={styles.orbit}
                from={{ rotate: reduceMotion ? '0deg' : '-120deg', opacity: 0 }}
                animate={{
                  rotate: live && !reduceMotion ? '360deg' : '0deg',
                  opacity: !expanded && (live || holdPhase === 'charging') ? 1 : 0,
                  scale: holdPhase === 'charging' && !reduceMotion ? 1.06 : 1,
                }}
                // Only rotate loops: a shared looping transition would also
                // restart scale/opacity each lap, snapping the ring outward.
                transition={{
                  type: 'spring',
                  damping: 16,
                  stiffness: 160,
                  rotate:
                    live && !reduceMotion
                      ? { type: 'timing', duration: 3000, easing: Easing.linear, loop: true, repeatReverse: false }
                      : { type: 'spring', damping: 16, stiffness: 160 },
                }}
              >
                <OpenRing
                  size={ORBIT_SIZE}
                  color={live || holdPhase === 'charging' ? colors.error : colors.accent}
                  weight={ORBIT_WEIGHT}
                  core={false}
                />
              </MotiView>

              <View
                accessible
                accessibilityRole="button"
                accessibilityLabel={
                  expanded ? 'Close capture options' : 'Capture. Tap for options, hold to record.'
                }
                accessibilityActions={[{ name: 'longpress', label: 'Record a voice note' }]}
                onAccessibilityAction={(event) => {
                  if (event.nativeEvent.actionName === 'longpress') goRecordScreen();
                }}
                onStartShouldSetResponder={() => true}
                onResponderTerminationRequest={() => false}
                onResponderGrant={handleGrant}
                onResponderMove={handleDragMove}
                onResponderRelease={handleRelease}
                onResponderTerminate={handleTerminate}
                style={styles.fabTouch}
              >
                <MotiView
                  animate={{
                    backgroundColor: fabColor,
                    scale: holdPhase === 'charging' ? 0.94 : cancelling ? 0.86 : 1,
                  }}
                  transition={{
                    backgroundColor: { type: 'timing', duration: DUR_FAST, easing: EASE_OUT },
                    scale: reduceMotion ? REDUCED : SPRING_NAV,
                  }}
                  style={styles.fab}
                >
                  {/* Hold feedback: red fills the button from the centre over
                      exactly the hold time, then it clicks into recording. */}
                  <MotiView
                    pointerEvents="none"
                    animate={{ scale: holdPhase === 'charging' || live ? 1 : 0 }}
                    transition={
                      holdPhase === 'charging'
                        ? { type: 'timing', duration: LONG_PRESS_MS, easing: Easing.out(Easing.quad) }
                        : { type: 'timing', duration: DUR_FAST, easing: EASE_OUT }
                    }
                    style={[styles.fill, { backgroundColor: colors.error }]}
                  />
                  <Glyph
                    show={glyph === 'plus'}
                    rotate={expanded ? '135deg' : '0deg'}
                    reduceMotion={reduceMotion}
                  >
                    <Icon
                      name="plus"
                      size={30}
                      color={holdPhase === 'charging' ? colors.errorInk : fabInk}
                      stroke={2.4}
                    />
                  </Glyph>
                  <Glyph show={glyph === 'mic'} reduceMotion={reduceMotion}>
                    <Icon name="mic" size={26} color={fabInk} stroke={2.2} />
                  </Glyph>
                  <Glyph show={glyph === 'trash'} reduceMotion={reduceMotion}>
                    <Icon name="trash" size={24} color={fabInk} stroke={2.2} />
                  </Glyph>
                </MotiView>
              </View>
            </Animated.View>
          </View>
        </MotiView>
      </View>
    </>
  );
}

const HOLD_HINT_KEY = 'mnemo-hint-hold-done';

/**
 * A bubble pointing at the button: the one place that says it can be held.
 * Shown on Home until the person records by holding, or closes it.
 */
function HoldHint({ reduceMotion, onDismiss }: { reduceMotion: boolean; onDismiss: () => void }) {
  const colors = useThemeColors();
  return (
    <MotiView
      from={{ opacity: 0, translateY: 6 }}
      animate={{ opacity: 1, translateY: 0 }}
      exit={{ opacity: 0, translateY: 4 }}
      transition={reduceMotion ? REDUCED : { type: 'timing', duration: DUR_BASE, delay: 400, easing: EASE_OUT }}
      exitTransition={EXIT_QUICK}
      pointerEvents="box-none"
      style={[styles.hintWrap, { bottom: FAB_SIZE + 16 }]}
    >
      {/* A slow bob draws the eye once, then keeps still under Reduce Motion. */}
      <MotiView
        animate={{ translateY: reduceMotion ? 0 : -3 }}
        transition={
          reduceMotion
            ? REDUCED
            : { type: 'timing', duration: 900, loop: true, repeatReverse: true, easing: EASE_IN_OUT }
        }
        style={styles.hintColumn}
      >
        <View
          className="flex-row items-center rounded-full pl-3.5 pr-1.5 h-10"
          style={[styles.hintBubble, { backgroundColor: colors.fg }]}
        >
          <Icon name="mic" size={15} color={colors.bg} stroke={2.2} />
          <Text className="font-sans-semi text-sm ml-2" style={{ color: colors.bg }}>
            Hold to record
          </Text>
          <Text className="font-sans text-sm" style={{ color: colors.bg, opacity: 0.7 }}>
            {'  ·  tap for more'}
          </Text>
          <Pressable
            onPress={onDismiss}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Dismiss hint"
            className="w-7 h-7 rounded-full items-center justify-center ml-1.5"
          >
            <Icon name="x" size={14} color={colors.bg} stroke={2.2} />
          </Pressable>
        </View>
        {/* Arrow pointing down at the button */}
        <View style={[styles.hintArrow, { backgroundColor: colors.fg }]} />
      </MotiView>
    </MotiView>
  );
}

/** One of the button's glyphs; only the current one is visible. */
function Glyph({
  show,
  rotate = '0deg',
  reduceMotion,
  children,
}: {
  show: boolean;
  rotate?: string;
  reduceMotion: boolean;
  children: React.ReactNode;
}) {
  return (
    <MotiView
      pointerEvents="none"
      animate={{ opacity: show ? 1 : 0, scale: show ? 1 : 0.4, rotate }}
      transition={reduceMotion ? REDUCED : SPRING_NAV}
      style={[StyleSheet.absoluteFill, styles.center]}
    >
      {children}
    </MotiView>
  );
}

/** "Adding to …" above the menu, and the hint that teaches hold-to-record. */
function MenuHint({ threadTitle, reduceMotion }: { threadTitle?: string; reduceMotion: boolean }) {
  const colors = useThemeColors();
  return (
    <MotiView
      from={{ opacity: 0, translateY: reduceMotion ? 0 : 8 }}
      animate={{ opacity: 1, translateY: 0 }}
      exit={{ opacity: 0 }}
      transition={reduceMotion ? REDUCED : { type: 'timing', duration: DUR_BASE, delay: 80, easing: EASE_OUT }}
      exitTransition={EXIT_QUICK}
      pointerEvents="none"
      style={[styles.menuHint, { bottom: OPTION_CENTER_Y + OPTION_CIRCLE / 2 + 26 }]}
    >
      {threadTitle ? (
        <Text
          className="font-sans-semi text-xs uppercase tracking-caps text-center mb-1.5"
          style={{ color: colors.accent }}
          numberOfLines={1}
        >
          Adding to {threadTitle}
        </Text>
      ) : null}
      <Text className="font-sans text-sm text-center" style={{ color: colors.fgSecondary }}>
        Tip: hold <Text className="font-sans-semi" style={{ color: colors.fg }}>+</Text> to record without
        leaving the screen
      </Text>
    </MotiView>
  );
}

/** A choice in the tap menu: a big round target with a label underneath. */
function MenuOption({
  x,
  icon,
  label,
  caption,
  tone,
  delay,
  reduceMotion,
  onPress,
}: {
  x: number;
  icon: IconName;
  label: string;
  caption: string;
  tone: 'accent' | 'neutral';
  delay: number;
  reduceMotion: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const [pressed, setPressed] = useState(false);
  const circleBg = tone === 'accent' ? colors.accent : colors.surfaceRaised;
  const ink = tone === 'accent' ? colors.accentInk : colors.fg;

  // Each option flies out of the button along its own diagonal.
  const motionProps = reduceMotion
    ? { from: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: REDUCED }
    : {
        from: { opacity: 0, translateX: -x * 0.75, translateY: 70, scale: 0.4 },
        animate: { opacity: 1, translateX: 0, translateY: 0, scale: 1 },
        exit: { opacity: 0, translateX: -x * 0.6, translateY: 56, scale: 0.5 },
        transition: { ...SPRING_NAV, delay },
        exitTransition: { ...EXIT_QUICK, delay: 0 },
      };

  return (
    <MotiView
      {...motionProps}
      style={[
        styles.option,
        { marginLeft: x - OPTION_W / 2, bottom: OPTION_CENTER_Y - OPTION_CIRCLE / 2 - OPTION_LABEL_H },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${caption}.`}
        onPress={onPress}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        style={styles.optionPress}
      >
        <MotiView
          animate={{ scale: pressed ? 0.92 : 1 }}
          transition={reduceMotion ? REDUCED : { type: 'spring', damping: 20, stiffness: 380, mass: 0.5 }}
          style={[
            styles.optionCircle,
            {
              backgroundColor: circleBg,
              borderColor: tone === 'accent' ? 'transparent' : colors.border,
            },
          ]}
        >
          <Icon name={icon} size={24} color={ink} stroke={2} />
        </MotiView>
        <Text className="font-sans-semi text-body mt-2" style={{ color: colors.fg }}>
          {label}
        </Text>
        <Text className="font-sans text-sm" style={{ color: colors.fgTertiary }}>
          {caption}
        </Text>
      </Pressable>
    </MotiView>
  );
}

/**
 * The slide-to-cancel lane: chevrons that drift upward toward a bin. The bin
 * grows as the button gets closer and turns red once releasing would
 * discard.
 */
function CancelLane({
  dragY,
  armed,
  reduceMotion,
}: {
  dragY: SharedValue<number>;
  armed: boolean;
  reduceMotion: boolean;
}) {
  const colors = useThemeColors();

  const binStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale: interpolate(
          dragY.value,
          [0, CANCEL_ENTER_PX, CANCEL_DISTANCE],
          [0.86, 1, 1.18],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));
  const chevronsStyle = useAnimatedStyle(() => ({
    opacity: interpolate(dragY.value, [0, CANCEL_EXIT_PX], [1, 0], Extrapolation.CLAMP),
  }));

  return (
    <MotiView
      from={{ opacity: 0, translateY: reduceMotion ? 0 : 16 }}
      animate={{ opacity: 1, translateY: 0 }}
      exit={{ opacity: 0 }}
      transition={reduceMotion ? REDUCED : SPRING_NAV}
      exitTransition={EXIT_QUICK}
      pointerEvents="none"
      style={styles.lane}
    >
      <Animated.View style={[styles.binWrap, binStyle]}>
        <MotiView
          animate={{
            backgroundColor: armed ? colors.error : colors.surfaceRaised,
            borderColor: armed ? colors.error : colors.border,
          }}
          transition={{ type: 'timing', duration: DUR_FAST, easing: EASE_OUT }}
          style={styles.bin}
        >
          <Icon name="trash" size={22} color={armed ? colors.errorInk : colors.fgSecondary} stroke={2} />
        </MotiView>
      </Animated.View>

      <Animated.View style={[styles.chevrons, chevronsStyle]}>
        {[0, 1, 2].map((i) => (
          <MotiView
            key={i}
            from={{ opacity: 0.15, translateY: 4 }}
            animate={{ opacity: reduceMotion ? 0.6 : 1, translateY: reduceMotion ? 0 : -2 }}
            transition={
              reduceMotion
                ? REDUCED
                : {
                    type: 'timing',
                    duration: 520,
                    delay: (2 - i) * 140,
                    loop: true,
                    repeatReverse: true,
                    easing: EASE_IN_OUT,
                  }
            }
            style={{ marginTop: -8 }}
          >
            <Icon name="chevronUp" size={20} color={colors.fgTertiary} stroke={2.2} />
          </MotiView>
        ))}
      </Animated.View>
    </MotiView>
  );
}

const WAVEFORM_BARS = 30;
const WAVE_SAMPLE_MS = 80;

/** Live timer and waveform while recording, then the result after release. */
function RecordingCard({
  transcript,
  levelNow,
  startedAt,
  level,
  cancelling,
  tail,
  threadTitle,
  reduceMotion,
}: {
  transcript: string;
  /** Latest microphone level (0..1), written by the speech hook. */
  levelNow: React.MutableRefObject<number>;
  startedAt: number;
  level: SharedValue<number>;
  cancelling: boolean;
  tail: Tail;
  threadTitle?: string;
  reduceMotion: boolean;
}) {
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const isLive = tail === null;

  // Samples the mic level into a rolling waveform, and ticks the timer,
  // only while this card is live.
  const [levels, setLevels] = useState<number[]>(() => Array(WAVEFORM_BARS).fill(0));
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!isLive) return;
    const timer = setInterval(() => {
      const sample = levelNow.current;
      setLevels((prev) => [...prev.slice(1), sample]);
      level.value = withTiming(sample, { duration: 90 });
      setElapsed(Date.now() - startedAt);
    }, WAVE_SAMPLE_MS);
    return () => clearInterval(timer);
  }, [isLive, level, levelNow, startedAt]);

  const tint = cancelling ? colors.error : colors.fg;
  const destination = threadTitle ? `to ${threadTitle}` : 'as a new thread';

  const motionProps = reduceMotion
    ? { from: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: REDUCED }
    : {
        from: { opacity: 0, translateY: 14, scale: 0.96 },
        animate: { opacity: 1, translateY: 0, scale: 1 },
        exit: { opacity: 0, translateY: 8, scale: 0.97 },
        transition: SPRING_NAV,
        exitTransition: EXIT_QUICK,
      };

  return (
    <MotiView
      {...motionProps}
      pointerEvents="none"
      style={[
        styles.card,
        {
          width: Math.min(width - 48, 340),
          bottom: FAB_CENTER + CANCEL_DISTANCE + BIN_SIZE / 2 + 22,
          backgroundColor: colors.surfaceRaised,
          borderColor: cancelling ? colors.error : colors.border,
        },
      ]}
    >
      {isLive ? (
        <>
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <MotiView
                from={{ opacity: 0.3 }}
                animate={{ opacity: 1 }}
                transition={
                  reduceMotion
                    ? REDUCED
                    : { type: 'timing', duration: 700, loop: true, repeatReverse: true, easing: EASE_IN_OUT }
                }
                style={[styles.recDot, { backgroundColor: colors.error }]}
              />
              <Text className="font-sans-semi text-body" style={{ color: tint }}>
                {cancelling ? 'Release to discard' : 'Recording'}
              </Text>
            </View>
            <Text
              className="font-sans-semi"
              style={{ color: tint, fontSize: 22, fontVariant: ['tabular-nums'] }}
            >
              {formatDuration(elapsed)}
            </Text>
          </View>

          <View style={styles.wave}>
            {levels.map((sample, i) => (
              <MotiView
                key={i}
                animate={{ scaleY: Math.max(0.1, sample) }}
                transition={{ type: 'timing', duration: 80, easing: Easing.linear }}
                style={[
                  styles.bar,
                  {
                    backgroundColor: cancelling ? colors.error : colors.accent,
                    // Older samples fade out toward the left.
                    opacity: 0.35 + (0.65 * i) / (WAVEFORM_BARS - 1),
                  },
                ]}
              />
            ))}
          </View>

          {/* The words as they're heard: the note is what you see here. */}
          <Text
            className="font-sans text-body mb-2"
            style={{ color: transcript ? colors.fg : colors.fgTertiary }}
            numberOfLines={3}
            ellipsizeMode="head"
          >
            {transcript || 'Listening…'}
          </Text>

          <Text className="font-sans text-sm" style={{ color: cancelling ? colors.error : colors.fgTertiary }}>
            {cancelling ? 'This note will be thrown away' : `Let go to save ${destination}`}
          </Text>
        </>
      ) : (
        <TailContent tail={tail} reduceMotion={reduceMotion} />
      )}
    </MotiView>
  );
}

function TailContent({ tail, reduceMotion }: { tail: NonNullable<Tail>; reduceMotion: boolean }) {
  const colors = useThemeColors();
  const view: { icon: IconName; bg: string; ink: string; title: string; detail: string } =
    tail.kind === 'saved'
      ? {
          icon: 'check',
          bg: colors.accent,
          ink: colors.accentInk,
          title: 'Saved',
          detail: tail.where
            ? `${aiEnabled() ? 'Tidying up in' : 'Added to'} ${tail.where}`
            : aiEnabled()
              ? 'Tidying it up in a new thread'
              : 'Saved as a new thread',
        }
      : tail.kind === 'tooShort'
        ? {
            icon: 'mic',
            bg: colors.surfaceHigh,
            ink: colors.fg,
            title: "Didn't catch that",
            detail: 'Hold the button, speak, then let go',
          }
        : tail.kind === 'discarded'
          ? {
              icon: 'trash',
              bg: colors.errorSoft,
              ink: colors.error,
              title: 'Discarded',
              detail: 'Nothing was saved',
            }
          : { icon: 'mic', bg: colors.surfaceHigh, ink: colors.fgSecondary, title: 'Saving…', detail: ' ' };

  return (
    <View className="flex-row items-center">
      <MotiView
        key={tail.kind}
        from={{ scale: reduceMotion ? 1 : 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={reduceMotion ? REDUCED : { type: 'spring', damping: 12, stiffness: 260, mass: 0.6 }}
        style={[styles.tailIcon, { backgroundColor: view.bg }]}
      >
        <Icon name={view.icon} size={20} color={view.ink} stroke={2.4} />
      </MotiView>
      <View className="flex-1 ml-3">
        <Text className="font-sans-semi text-body" style={{ color: colors.fg }}>
          {view.title}
        </Text>
        <Text className="font-sans text-sm mt-0.5" style={{ color: colors.fgTertiary }} numberOfLines={1}>
          {view.detail}
        </Text>
      </View>
    </View>
  );
}


const OPTION_W = 120;
const OPTION_LABEL_H = 48;

const styles = StyleSheet.create({
  scrimLayer: {
    zIndex: 40,
  },
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
  },
  stage: {
    height: STAGE_HEIGHT,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  fabSlot: {
    width: ORBIT_SIZE,
    height: FAB_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabSlotInner: {
    width: ORBIT_SIZE,
    height: ORBIT_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbit: {
    position: 'absolute',
    width: ORBIT_SIZE,
    height: ORBIT_SIZE,
  },
  halo: {
    position: 'absolute',
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
  },
  fabTouch: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    shadowOpacity: 0.22,
    elevation: 8,
  },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hintColumn: {
    alignItems: 'center',
  },
  hintBubble: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    shadowOpacity: 0.18,
    elevation: 6,
  },
  hintArrow: {
    width: 12,
    height: 12,
    marginTop: -6,
    transform: [{ rotate: '45deg' }],
    borderRadius: 2,
  },
  menuHint: {
    position: 'absolute',
    left: 32,
    right: 32,
    alignItems: 'center',
  },
  option: {
    position: 'absolute',
    left: '50%',
    width: OPTION_W,
  },
  optionPress: {
    alignItems: 'center',
  },
  optionCircle: {
    width: OPTION_CIRCLE,
    height: OPTION_CIRCLE,
    borderRadius: OPTION_CIRCLE / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 8,
    shadowOpacity: 0.14,
    elevation: 4,
  },
  lane: {
    position: 'absolute',
    bottom: FAB_CENTER + 18,
    height: CANCEL_DISTANCE - 18 + BIN_SIZE / 2,
    width: BIN_SIZE + 24,
    alignItems: 'center',
  },
  binWrap: {
    width: BIN_SIZE,
    height: BIN_SIZE,
  },
  bin: {
    width: BIN_SIZE,
    height: BIN_SIZE,
    borderRadius: BIN_SIZE / 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevrons: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
  },
  card: {
    position: 'absolute',
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 20,
    shadowOpacity: 0.12,
    elevation: 6,
  },
  recDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  wave: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 40,
    marginTop: 12,
    marginBottom: 10,
  },
  bar: {
    width: 4,
    height: 36,
    borderRadius: 2,
  },
  tailIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
