import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MotiView } from 'moti';

import { useReduceMotion } from '@/hooks/use-accessibility-motion';
import { useThemeColors, useThemeName } from '@/hooks/use-theme';
import { DUR_BASE, EASE_OUT, motion } from '@/utils/motion';

interface CardProps {
  children: React.ReactNode;
  variant?: 'surface' | 'raised' | 'flat' | 'tinted' | 'dashed';
  pad?: 'sm' | 'md' | 'lg';
  interactive?: boolean;
  onPress?: () => void;
  className?: string;
  animated?: boolean;
  delay?: number;
}

const PAD_CLASSES: Record<NonNullable<CardProps['pad']>, string> = {
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
};

export function Card({
  children,
  variant = 'surface',
  pad = 'md',
  interactive = false,
  onPress,
  className = '',
  animated = true,
  delay = 0,
}: CardProps) {
  const colors = useThemeColors();
  const themeName = useThemeName();
  const reduceMotion = useReduceMotion();

  // Variant color/border is conditional at runtime — uniwind's className
  // pipeline only resolves *static* class strings (see useThemeColors), so
  // it has to go through inline `style`, matching ZenCard/NoteRow.
  const variantStyle = (() => {
    switch (variant) {
      case 'raised':
        return {
          backgroundColor: colors.surfaceRaised,
          ...(themeName === 'dark' ? styles.raisedShadowDark : styles.raisedShadowLight),
        };
      case 'flat':
        return {
          backgroundColor: 'transparent',
          borderWidth: 1,
          borderColor: colors.border,
        };
      case 'tinted':
        return {
          backgroundColor: colors.accentSoft,
        };
      case 'dashed':
        return {
          backgroundColor: 'transparent',
          borderWidth: 1,
          borderStyle: 'dashed' as const,
          borderColor: colors.outline,
        };
      case 'surface':
      default:
        return {
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
        };
    }
  })();

  const isInteractive = interactive || !!onPress;
  const cardClassName = `rounded-lg ${PAD_CLASSES[pad]} ${isInteractive ? 'active:opacity-90' : ''} ${className}`;

  const cardContent = isInteractive ? (
    <Pressable onPress={onPress} className={cardClassName} style={variantStyle}>
      {children}
    </Pressable>
  ) : (
    <View className={cardClassName} style={variantStyle}>
      {children}
    </View>
  );

  if (!animated) return cardContent;

  // Reduce Motion: fade only, no travel — matches Glass.tsx's accessibility
  // gating (opacity-only entrance, shorter duration via the REDUCED preset).
  const from = reduceMotion ? { opacity: 0 } : { opacity: 0, translateY: 12 };
  const animateTo = reduceMotion ? { opacity: 1 } : { opacity: 1, translateY: 0 };
  const transition = {
    ...motion({ type: 'timing' as const, duration: DUR_BASE, easing: EASE_OUT }, reduceMotion),
    delay,
  };

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
