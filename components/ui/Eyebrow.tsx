import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { useThemeColors } from '@/hooks/use-theme';

interface EyebrowProps {
  children: string;
  /** Text colour; defaults to the tertiary ink. */
  tone?: string;
  /** Optional text action on the right ("All 5", "Library"). */
  action?: string;
  onAction?: () => void;
  className?: string;
}

/**
 * The one section label used across the app: small caps, wide tracking,
 * tertiary ink, with an optional text action on the right. Every screen
 * uses this instead of its own variant so section headings read the same
 * everywhere.
 */
export function Eyebrow({ children, tone, action, onAction, className = 'mb-3' }: EyebrowProps) {
  const colors = useThemeColors();
  return (
    <View className={`flex-row items-center justify-between ${className}`}>
      <Text
        className="font-sans-semi text-xs uppercase tracking-caps"
        style={{ color: tone ?? colors.fgTertiary }}
        accessibilityRole="header"
      >
        {children}
      </Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={12} accessibilityRole="button">
          <Text className="font-sans-semi text-sm" style={{ color: colors.accent }}>
            {action}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
