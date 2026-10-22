import React from 'react';
import { Pressable, View } from 'react-native';
import { MotiView } from 'moti';

import { Icon, type IconName } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useThemeColors } from '@/hooks/use-theme';
import { useEnter } from '@/utils/motion';

/**
 * A one-line notice on Home that leads somewhere (Settings, a check):
 * an icon, what it's about, a line of why, and an optional "Not now".
 */
export function HomeBanner({
  icon,
  iconColor,
  title,
  body,
  onPress,
  accessibilityLabel,
  onDismiss,
}: {
  icon: IconName;
  iconColor?: string;
  title: string;
  body: string;
  onPress: () => void;
  accessibilityLabel?: string;
  /** Without it there's no "Not now": the notice stays until it's dealt with. */
  onDismiss?: () => void;
}) {
  const colors = useThemeColors();
  const enter = useEnter();
  return (
    <MotiView {...enter.fade(1)} className="flex-row items-center rounded-lg mt-4" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        className="flex-1 flex-row items-center pl-4 py-3 active:opacity-80"
      >
        <View className="w-8 h-8 rounded-full items-center justify-center mr-3" style={{ backgroundColor: colors.accentSoft }}>
          <Icon name={icon} size={16} color={iconColor ?? colors.accent} stroke={2} />
        </View>
        <View className="flex-1">
          <Text className="font-sans-semi text-sm" style={{ color: colors.fg }}>
            {title}
          </Text>
          <Text className="font-sans text-sm" style={{ color: colors.fgSecondary }}>
            {body}
          </Text>
        </View>
      </Pressable>
      {onDismiss ? (
        <Pressable
          onPress={onDismiss}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Not now"
          className="w-11 h-11 items-center justify-center mr-1 active:opacity-60"
        >
          <Icon name="x" size={16} color={colors.fgTertiary} />
        </Pressable>
      ) : (
        <View className="w-3" />
      )}
    </MotiView>
  );
}
