import React from 'react';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useThemeColors } from '@/hooks/use-theme';

export function FocusPill({
  children,
  onStop,
  stopLabel,
  onPress,
  label,
  className = '',
}: {
  children: React.ReactNode;
  onStop: () => void;
  stopLabel: string;
  onPress?: () => void;
  label?: string;
  className?: string;
}) {
  const colors = useThemeColors();
  const content = (
    <>
      <Icon name="pin" size={15} color={colors.accent} stroke={2.2} />
      <Text className="font-sans-medium text-sm ml-2 mr-2 shrink" style={{ color: colors.fg }} numberOfLines={1}>
        {children}
      </Text>
    </>
  );
  return (
    <View
      className={`flex-row items-center self-start rounded-full pl-3 pr-1.5 h-10 ${className}`}
      style={{ backgroundColor: colors.accentSoft, maxWidth: '100%' }}
    >
      {onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={label}
          className="flex-row items-center shrink h-10 active:opacity-70"
        >
          {content}
        </Pressable>
      ) : (
        content
      )}
      <Pressable
        onPress={onStop}
        accessibilityRole="button"
        accessibilityLabel={stopLabel}
        className="w-7 h-7 rounded-full items-center justify-center active:opacity-60"
        hitSlop={8}
      >
        <Icon name="x" size={14} color={colors.fgTertiary} stroke={2} />
      </Pressable>
    </View>
  );
}

