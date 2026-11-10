import React from 'react';
import { Pressable, View } from 'react-native';

import { useSurfaceStyle } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useThemeColors } from '@/hooks/use-theme';
import { haptic } from '@/lib/haptics';

export function LinkRow({
  icon,
  title,
  detail,
  onPress,
  silent = false,
  chevron = true,
  className = 'px-5 py-4',
}: {
  icon: IconName;
  title: string;
  detail?: string;
  onPress: () => void;
  silent?: boolean;
  chevron?: boolean;
  className?: string;
}) {
  const colors = useThemeColors();
  const surface = useSurfaceStyle('soft');
  return (
    <Pressable
      onPress={() => {
        if (!silent) haptic.select();
        onPress();
      }}
      accessibilityRole="button"
      className={`rounded-lg flex-row items-center active:opacity-80 ${className}`}
      style={surface}
    >
      <Icon name={icon} size={15} color={colors.accent} />
      <View className="ml-2 flex-1">
        <Text className="font-sans-semi text-sm text-fg">{title}</Text>
        {detail ? <Text className="font-sans text-sm text-fg-tertiary mt-0.5">{detail}</Text> : null}
      </View>
      {chevron ? <Icon name="chevronRight" size={16} color={colors.fgTertiary} /> : null}
    </Pressable>
  );
}
