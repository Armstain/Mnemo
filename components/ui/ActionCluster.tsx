import React, { useRef, useState } from 'react';
import { View, Pressable, StyleSheet, Text } from 'react-native';
import { Mic, SquarePen, X } from 'lucide-react-native';
import { MotiView, AnimatePresence } from 'moti';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { useThemeColors } from '@/hooks/use-theme';
import { useReduceMotion } from '@/hooks/use-accessibility-motion';
import { EASE_OUT } from '@/utils/motion';
import { NAV_BAR_HEIGHT } from '@/components/ui/FloatingTabBar';

// How long a hold must be sustained before it commits to recording. Long
// enough that a normal tap never triggers it, short enough that intent
// reads as instant once it does.
const LONG_PRESS_MS = 380;

const SPRING = { type: 'spring' as const, damping: 20, stiffness: 260, mass: 0.6 };

/**
 * ActionCluster — one floating action button for capture, not two.
 *
 * Tap reveals a small menu (Record / Note); holding skips the menu
 * entirely and jumps straight into recording — the fast path for the
 * app's single most common action. This mirrors the hold-to-record
 * convention from WhatsApp/Telegram voice messages, adapted to Mnemo's
 * full-screen recording flow (dump.tsx) rather than an inline bubble.
 */
export function ActionCluster() {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const reduceMotion = useReduceMotion();

  const [expanded, setExpanded] = useState(false);
  const [charging, setCharging] = useState(false);
  // Pressable doesn't reliably suppress onPress after onLongPress fires,
  // so we track it ourselves to avoid also toggling the menu on release.
  const longPressFired = useRef(false);

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

  const goRecord = (autoStart: boolean) => {
    Haptics.impactAsync(
      autoStart ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
    );
    setExpanded(false);
    router.push((autoStart ? '/dump?autoStart=1' : '/dump') as any);
  };

  const goNote = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpanded(false);
    router.push('/capture' as any);
  };

  return (
    <>
      {/* Backdrop — only present (and hit-testable) while the menu is
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
            {expanded && (
              <MiniAction
                key="record"
                label="Record"
                icon={<Mic size={20} color={colors.onPrimaryContainer} strokeWidth={2.2} />}
                bg={colors.primaryContainer}
                delay={60}
                reduceMotion={reduceMotion}
                onPress={() => goRecord(false)}
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

          {/* Main FAB — tap to open the menu, hold to record instantly. */}
          <View style={styles.mainWrap}>
            {/* Charging ring — grows continuously while held, so the hold
                itself reads as "in progress" before it commits at the
                long-press threshold. */}
            {charging && !reduceMotion && (
              <MotiView
                from={{ scale: 1, opacity: 0.35 }}
                animate={{ scale: 1.5, opacity: 0 }}
                transition={{ type: 'timing', duration: LONG_PRESS_MS, easing: EASE_OUT }}
                style={[styles.chargingRing, { borderColor: colors.accent }]}
                pointerEvents="none"
              />
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                expanded ? 'Close quick actions' : 'Capture — tap for options, hold to record'
              }
              accessibilityActions={[{ name: 'longpress', label: 'Start recording immediately' }]}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === 'longpress') goRecord(true);
              }}
              android_ripple={{ color: 'rgba(255,255,255,0.18)', borderless: false, radius: 30 }}
              delayLongPress={LONG_PRESS_MS}
              onPressIn={() => {
                longPressFired.current = false;
                setCharging(true);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              onPressOut={() => setCharging(false)}
              onLongPress={() => {
                longPressFired.current = true;
                goRecord(true);
              }}
              onPress={() => {
                if (longPressFired.current) {
                  longPressFired.current = false;
                  return;
                }
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setExpanded((e) => !e);
              }}
              style={[styles.mainFab, { backgroundColor: colors.accent }]}
            >
              <MotiView
                animate={{ opacity: expanded ? 0 : 1, scale: expanded ? 0.5 : 1 }}
                transition={reduceMotion ? { type: 'timing', duration: 150 } : SPRING}
                style={StyleSheet.absoluteFillObject}
              >
                <View style={styles.iconCenter}>
                  <Mic size={26} color={colors.accentInk} strokeWidth={2.2} />
                </View>
              </MotiView>
              <MotiView
                animate={{ opacity: expanded ? 1 : 0, scale: expanded ? 1 : 0.5 }}
                transition={reduceMotion ? { type: 'timing', duration: 150 } : SPRING}
                style={StyleSheet.absoluteFillObject}
              >
                <View style={styles.iconCenter}>
                  <X size={26} color={colors.accentInk} strokeWidth={2.4} />
                </View>
              </MotiView>
            </Pressable>
          </View>
        </MotiView>
      </View>
    </>
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
  mainFab: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    // M3 elevation level 3.
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    shadowOpacity: 0.22,
    elevation: 8,
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
});
