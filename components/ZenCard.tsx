import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { MotiView } from 'moti';

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
  const getVariantStyles = () => {
    switch (variant) {
      case 'warm':
        return 'bg-surface-warm';
      case 'accent':
        return 'bg-accent/10';
      case 'surface':
      default:
        return 'bg-surface';
    }
  };

  const CardContent = (
    <View
      className={`
        rounded-[18px] shadow-soft border border-border/40
        ${compact ? 'p-4' : 'p-6'}
        ${getVariantStyles()}
        ${className}
      `}
    >
      {label && (
        <Text className="font-sans-medium text-[10px] text-fg-muted mb-1.5 tracking-wider uppercase">
          {label}
        </Text>
      )}
      {title && (
        <Text 
          className={`
            font-serif text-fg leading-tight mb-1
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
