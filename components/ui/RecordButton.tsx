import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MotiView } from 'moti';
import { Easing } from 'react-native-reanimated';

import { useThemeColors } from '@/hooks/use-theme';
import { useReduceMotion } from '@/hooks/use-accessibility-motion';
import { EASE_IN_OUT, RECORD_HALO_ACTIVE_MS, RECORD_HALO_IDLE_MS } from '@/utils/motion';
import { Icon } from '@/components/ui/Icon';
import { OpenRing } from '@/components/ui/ThreadRing';

interface RecordButtonProps {
  /** Diameter of the circular button, in px. Default 68. */
  size?: number;
  /** Actively recording — speeds up the halo's breathing cadence. */
  recording?: boolean;
  /** Caption shown below the button, and the a11y label fallback. */
  label?: string;
  /**
   * Draw the brand's open ring orbiting the button — slow while idle,
   * quicker while recording. For hero placements (recorder, onboarding),
   * not the small FAB.
   */
  orbit?: boolean;
  /** Plain tap passthrough — callers driving their own gesture (hold-to-record, drag-to-cancel) should leave this unset. */
  onPress?: () => void;
}

// 14px halo inset on every side, matching the CSS spec's `inset:-14px`.
const HALO_INSET = 14;

/**
 * RecordButton — the circular "hold to record" affordance: a breathing
 * halo behind a solid mic button. Purely presentational — gesture handling
 * (long-press, slide-to-cancel, …) lives in the caller (ActionCluster,
 * app/dump.tsx); this component only renders the look, plus an optional
 * plain `onPress` for callers that just want a tap target.
 */
export function RecordButton({ size = 68, recording = false, label, orbit = false, onPress }: RecordButtonProps) {
  const colors = useThemeColors();
  const reduceMotion = useReduceMotion();
  const haloSize = size + HALO_INSET * 2;

  const cycleMs = recording ? RECORD_HALO_ACTIVE_MS : RECORD_HALO_IDLE_MS;

  const halo = reduceMotion ? (
    <View
      style={[
        styles.halo,
        { width: haloSize, height: haloSize, backgroundColor: colors.accentSoft, opacity: 0.35 },
      ]}
    />
  ) : (
    <MotiView
      from={{ scale: 1, opacity: 0.75 }}
      animate={{ scale: 1.16, opacity: 0.35 }}
      transition={{
        type: 'timing',
        duration: cycleMs / 2,
        loop: true,
        repeatReverse: true,
        easing: EASE_IN_OUT,
      }}
      style={[styles.halo, { width: haloSize, height: haloSize, backgroundColor: colors.accentSoft }]}
    />
  );

  const orbitSize = haloSize + 44;
  const orbitRing = (
    <OpenRing size={orbitSize} color={colors.accent} weight={0.012} core={false} />
  );
  const orbitLayer = !orbit ? null : reduceMotion ? (
    <View style={[styles.halo, { width: orbitSize, height: orbitSize, opacity: 0.5 }]}>{orbitRing}</View>
  ) : (
    <MotiView
      from={{ rotate: '0deg' }}
      animate={{ rotate: '360deg' }}
      transition={{ type: 'timing', duration: recording ? 4000 : 14000, easing: Easing.linear, loop: true, repeatReverse: false }}
      style={[styles.halo, { width: orbitSize, height: orbitSize, opacity: recording ? 0.8 : 0.5 }]}
    >
      {orbitRing}
    </MotiView>
  );

  const buttonStyle = [
    styles.button,
    {
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: colors.accent,
    },
  ];

  const button = onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label || 'Hold to record'}
      style={buttonStyle}
    >
      <Icon name="mic" size={Math.round(size * 0.4)} stroke={1.9} color={colors.accentInk} />
    </Pressable>
  ) : (
    <View accessibilityLabel={label || 'Hold to record'} style={buttonStyle}>
      <Icon name="mic" size={Math.round(size * 0.4)} stroke={1.9} color={colors.accentInk} />
    </View>
  );

  return (
    <View style={styles.wrap}>
      <View
        style={{
          width: orbit ? orbitSize : haloSize,
          height: orbit ? orbitSize : haloSize,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {orbitLayer}
        {halo}
        {button}
      </View>
      {label ? (
        <Text className="text-xs" style={{ color: colors.fgTertiary }}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
  },
  halo: {
    position: 'absolute',
    borderRadius: 9999,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
});
