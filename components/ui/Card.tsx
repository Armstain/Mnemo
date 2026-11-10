import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { MotiView } from 'moti';

import { useReduceMotion } from '@/hooks/use-accessibility-motion';
import { useThemeColors, useThemeName } from '@/hooks/use-theme';
import { DUR_BASE, EASE_OUT, motion } from '@/utils/motion';

export type SurfaceTone = 'default' | 'soft' | 'lowest';

export type SurfaceStyle = {
  backgroundColor: string;
  borderWidth: number;
  borderColor: string;
};

/** The bordered surface every card, row group and field box sits on; spread it into any `style`. `soft` has a fainter border (settings), `lowest` the lightest fill. */
export function useSurfaceStyle(tone: SurfaceTone = 'default'): SurfaceStyle {
  const colors = useThemeColors();
  return {
    backgroundColor: tone === 'lowest' ? colors.surfaceLowest : colors.surface,
    borderWidth: 1,
    borderColor: tone === 'soft' ? `${colors.border}80` : colors.border,
  };
}

/** A plain bordered surface box. Size, padding and radius come from `className`. */
export function Surface({
  children,
  className = '',
  style,
  tone,
}: {
  children?: React.ReactNode;
  className?: string;
  style?: StyleProp<ViewStyle>;
  tone?: SurfaceTone;
}) {
  const surface = useSurfaceStyle(tone);
  return (
    <View className={className} style={[surface, style]}>
      {children}
    </View>
  );
}

interface CardProps {
  children: React.ReactNode;
  variant?: 'surface' | 'raised';
  pad?: 'none' | 'sm' | 'md' | 'lg';
  className?: string;
  animated?: boolean;
}

const PAD_CLASSES: Record<NonNullable<CardProps['pad']>, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
};

export function Card({ children, variant = 'surface', pad = 'md', className = '', animated = true }: CardProps) {
  const colors = useThemeColors();
  const themeName = useThemeName();
  const reduceMotion = useReduceMotion();
  const surface = useSurfaceStyle();

  // Variant color/border is conditional at runtime: uniwind's className
  // pipeline only resolves *static* class strings (see useThemeColors), so
  // it has to go through inline `style`, like the other surfaces.
  const variantStyle =
    variant === 'raised'
      ? {
          backgroundColor: colors.surfaceRaised,
          ...(themeName === 'dark' ? styles.raisedShadowDark : styles.raisedShadowLight),
        }
      : surface;

  const cardContent = (
    <View className={`rounded-lg ${PAD_CLASSES[pad]} ${className}`} style={variantStyle}>
      {children}
    </View>
  );

  if (!animated) return cardContent;

  // Reduce Motion: fade only, no travel.
  const from = reduceMotion ? { opacity: 0 } : { opacity: 0, translateY: 12 };
  const animateTo = reduceMotion ? { opacity: 1 } : { opacity: 1, translateY: 0 };
  const transition = motion({ type: 'timing' as const, duration: DUR_BASE, easing: EASE_OUT }, reduceMotion);

  return (
    <MotiView from={from} animate={animateTo} transition={transition}>
      {cardContent}
    </MotiView>
  );
}

const styles = StyleSheet.create({
  raisedShadowLight: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 8,
  },
  raisedShadowDark: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 8,
  },
});
