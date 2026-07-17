import React from 'react';
import { Platform, StyleSheet, View, ViewProps } from 'react-native';
import { BlurView } from 'expo-blur';
import { MotiView } from 'moti';

import { useReduceMotion, useReduceTransparency } from '@/hooks/use-accessibility-motion';
import { useThemeName } from '@/hooks/use-theme';
import { EASE_OUT } from '@/utils/motion';

/**
 * expo-glass-effect touches native code as soon as its module is
 * evaluated (not just when used) — on iOS, a static `import` crashes the
 * whole app the instant the native module isn't linked into the running
 * binary yet (plain Expo Go, or a dev client built before this
 * dependency was added). A guarded `require` degrades to the simulated
 * glass fallback instead of taking the app down.
 */
let GlassView: React.ComponentType<any> | null = null;
let hasLiquidGlass = false;
try {
  const ExpoGlassEffect = require('expo-glass-effect');
  GlassView = ExpoGlassEffect.GlassView;
  hasLiquidGlass = ExpoGlassEffect.isLiquidGlassAvailable();
} catch {
  // Native module not linked yet — fall through to the blur simulation.
}
export { hasLiquidGlass };

interface GlassProps extends ViewProps {
  /** Corner radius of the glass surface. */
  radius?: number;
  /** Blur intensity for the fallback material (ignored when native glass renders). */
  intensity?: number;
  /** Native glass reacts to touches (use on tappable surfaces). */
  interactive?: boolean;
  /**
   * 'regular' carries a visible tint + specular edge, and reads as the
   * thicker material (shadow, materialize-in) for hero surfaces. 'subtle'
   * is quieter and flatter, for secondary chrome like the search bar.
   */
  variant?: 'regular' | 'subtle';
}

// The material recipe per theme. Dark glass is a dim smoked surface with
// a bright rim; light glass is a milky frosted surface with a soft ink rim.
const MATERIAL = {
  dark: {
    blurTint: 'dark' as const,
    border: { regular: 'rgba(255,255,255,0.14)', subtle: 'rgba(255,255,255,0.09)' },
    tint: { regular: 'rgba(255,255,255,0.06)', subtle: 'rgba(255,255,255,0.04)' },
    specular: 'rgba(255,255,255,0.32)',
    specularSide: 'rgba(255,255,255,0.14)',
    solidFallback: { regular: 'rgba(20,20,26,0.96)', subtle: 'rgba(20,20,26,0.9)' },
    shadowOpacity: { regular: 0.35, subtle: 0.2 },
  },
  light: {
    blurTint: 'light' as const,
    border: { regular: 'rgba(10,15,20,0.10)', subtle: 'rgba(10,15,20,0.07)' },
    tint: { regular: 'rgba(255,255,255,0.45)', subtle: 'rgba(255,255,255,0.35)' },
    specular: 'rgba(255,255,255,0.9)',
    specularSide: 'rgba(255,255,255,0.5)',
    solidFallback: { regular: 'rgba(250,251,250,0.97)', subtle: 'rgba(250,251,250,0.92)' },
    shadowOpacity: { regular: 0.14, subtle: 0.08 },
  },
};

/**
 * Glass — the app's single translucent-surface primitive, theme-aware.
 *
 * iOS 26+: the system Liquid Glass material via expo-glass-effect (it
 * adapts to light/dark itself). Everywhere else: a layered simulation —
 * backdrop blur (with the Android experimental blur method, without
 * which BlurView renders no blur at all on Android), a per-theme tint,
 * and a specular top edge. When the user has Reduce Transparency on,
 * the fallback drops the blur for a near-solid surface instead.
 *
 * Glass is reserved for hero surfaces (resume card, mic, tab bar,
 * search bar) — list rows and secondary content are flat. It must sit
 * above AmbientGlow or other visible content, never on a flat opaque
 * background.
 */
export function Glass({
  radius = 24,
  intensity = 50,
  interactive = false,
  variant = 'regular',
  style,
  children,
  ...rest
}: GlassProps) {
  const subtle = variant === 'subtle';
  const theme = useThemeName();
  const material = MATERIAL[theme];
  const reduceMotion = useReduceMotion();
  const reduceTransparency = useReduceTransparency();

  const NativeGlassView = GlassView;
  const inner = hasLiquidGlass && NativeGlassView ? (
    <NativeGlassView
      glassEffectStyle={subtle ? 'clear' : 'regular'}
      isInteractive={interactive}
      style={{ borderRadius: radius, overflow: 'hidden' }}
      {...rest}
    >
      {children}
    </NativeGlassView>
  ) : (
    <View
      style={[
        styles.container,
        {
          borderRadius: radius,
          borderColor: subtle ? material.border.subtle : material.border.regular,
        },
      ]}
      {...rest}
    >
      {reduceTransparency ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: subtle
                ? material.solidFallback.subtle
                : material.solidFallback.regular,
            },
          ]}
        />
      ) : (
        <>
          <BlurView
            intensity={subtle ? Math.min(intensity, 30) : intensity}
            tint={material.blurTint}
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
          {/* Base tint — lifts the surface off the field */}
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: subtle
                  ? material.tint.subtle
                  : material.tint.regular,
              },
            ]}
          />
        </>
      )}
      {/* Specular top edge — the light catching the rim */}
      {!subtle && (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: radius,
              borderTopWidth: 1,
              borderTopColor: material.specular,
              borderLeftWidth: StyleSheet.hairlineWidth,
              borderLeftColor: material.specularSide,
            },
          ]}
        />
      )}
      {children}
    </View>
  );

  const shadowStyle = [
    subtle ? styles.subtleShadow : styles.regularShadow,
    {
      shadowOpacity: subtle
        ? material.shadowOpacity.subtle
        : material.shadowOpacity.regular,
    },
  ];

  // Reduced motion drops the scale/transform, but an element popping into
  // existence with zero transition is its own kind of jarring change —
  // keep a quick opacity crossfade even here.
  if (reduceMotion) {
    return (
      <MotiView
        style={[shadowStyle, style]}
        from={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ type: 'timing', duration: 180, easing: EASE_OUT }}
      >
        {inner}
      </MotiView>
    );
  }

  return (
    <MotiView
      style={[shadowStyle, style]}
      from={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', damping: 22, mass: 0.9 }}
    >
      {inner}
    </MotiView>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    // Android's hairline can drop out on translucent surfaces; a real
    // border keeps the rim visible there.
    ...(Platform.OS === 'android' ? { borderWidth: 1 } : null),
  },
  // Bigger surfaces read as thicker material — a deeper shadow than
  // small chips. Lives on this outer, non-clipped wrapper.
  regularShadow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 14 },
    shadowRadius: 24,
    elevation: 14,
  },
  subtleShadow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 6,
  },
});
