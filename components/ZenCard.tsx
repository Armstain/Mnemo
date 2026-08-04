import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { MotiView } from 'moti';

import { useThemeColors } from '@/hooks/use-theme';

interface ZenCardProps {
  children: React.ReactNode;
  title?: string;
  label?: string;
  onPress?: () => void;
  variant?: 'surface' | 'warm' | 'accent';
  className?: string;
  animated?: boolean;
  delay?: number;
  compact?: boolean;
}

export const ZenCard = ({
  children,
  title,
  label,
  onPress,
  variant = 'surface',
  className = '',
  animated = true,
  delay = 0,
  compact = false,
}: ZenCardProps) => {
  const colors = useThemeColors();

  // Variant color is conditional at runtime — uniwind's className pipeline
  // only resolves *static* class strings (see the doc comment on
  // useThemeColors), so the background has to go through inline `style`,
  // matching every other themed component in the app (CategoryPill, NoteRow).
  const backgroundColor = (() => {
    switch (variant) {
      case 'warm':
        return colors.surfaceWarm;
      case 'accent':
        return `${colors.accent}1A`; // ~10% alpha, matches bg-accent/10
      case 'surface':
      default:
        return colors.surface;
    }
  })();

  const CardContent = (
    <View
      className={`
        rounded-[18px] shadow-soft border border-border/40
        ${compact ? 'p-4' : 'p-6'}
        ${className}
      `}
      style={{ backgroundColor }}
    >
      {label && (
        <Text className="font-sans-medium text-[10px] text-fg-muted mb-1.5 tracking-wider uppercase">
          {label}
        </Text>
      )}
      {title && (
        <Text 
          className={`
            font-sans-medium text-fg leading-tight mb-1
            ${compact ? 'text-lg' : 'text-xl'}
          `}
        >
          {title}
        </Text>
      )}
      {children}
    </View>
  );

  const wrappedContent = animated ? (
    <MotiView
      from={{ opacity: 0, translateY: 12 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 500, delay }}
    >
      {CardContent}
    </MotiView>
  ) : (
    CardContent
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        className="active:opacity-80 active:scale-[0.98] mb-3"
      >
        {wrappedContent}
      </Pressable>
    );
  }

  return <View className="mb-3">{wrappedContent}</View>;
};
