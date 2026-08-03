import React from 'react';
import { StyleSheet, View, ViewProps } from 'react-native';
import { MotiView } from 'moti';

import { useReduceMotion } from '@/hooks/use-accessibility-motion';
import { useThemeColors } from '@/hooks/use-theme';
import { EASE_OUT } from '@/utils/motion';

interface GlassProps extends ViewProps {
  /** Corner radius of the surface (Material uses generous rounding). */
  radius?: number;
  /** Ignored — retained so existing call sites keep type-checking. */
  intensity?: number;
  /** Ignored — Material press feedback is a ripple on the child, not here. */
  interactive?: boolean;
  /**
   * 'regular' is an elevated card (surface-container-high + level-2
   * shadow). 'subtle' is a flat filled surface (surface-container, no
   * shadow) for quieter chrome.
   */
  variant?: 'regular' | 'subtle';
}

/**
 * Surface — the app's Material 3 tonal surface primitive, theme-aware.
 *
 * Depth comes from tonal elevation (a lighter surface-container tone)
 * plus a soft shadow. The component is named `Glass` for backwards
 * compatibility with existing surface call sites.
 */
export function Glass({
  radius = 24,
  interactive: _interactive,
  intensity: _intensity,
  variant = 'regular',
  style,
  children,
  ...rest
}: GlassProps) {
  const subtle = variant === 'subtle';
  const colors = useThemeColors();
  const reduceMotion = useReduceMotion();

  const surfaceStyle = {
    borderRadius: radius,
    backgroundColor: subtle ? colors.surface : colors.surfaceHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  };

  const shadowStyle = subtle ? styles.subtleShadow : styles.regularShadow;

  const transitionProps = reduceMotion
    ? {
        from: { opacity: 0 },
        animate: { opacity: 1 },
        transition: { type: 'timing' as const, duration: 180, easing: EASE_OUT },
      }
    : {
        // M3: surfaces enter with a fade, not a scale pop.
        from: { opacity: 0 },
        animate: { opacity: 1 },
        transition: { type: 'timing' as const, duration: 240, easing: EASE_OUT },
      };

  return (
    <MotiView style={[shadowStyle, style]} {...transitionProps}>
      <View style={[styles.clip, surfaceStyle]} {...rest}>
        {children}
      </View>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
  },
  // Material 3 elevation level 2 — resting elevated card / bar.
  regularShadow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 8,
    shadowOpacity: 0.16,
    elevation: 3,
  },
  // Level 1 — quiet filled surface.
  subtleShadow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    shadowOpacity: 0.12,
    elevation: 1,
  },
});
