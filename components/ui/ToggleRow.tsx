import React from 'react';
import { Platform, Switch, View } from 'react-native';

import { Surface } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useThemeColors } from '@/hooks/use-theme';

/** The app's one on/off switch, themed. */
export function ToggleSwitch({
  value,
  onValueChange,
  label,
}: {
  value: boolean;
  onValueChange: (on: boolean) => void;
  label: string;
}) {
  const colors = useThemeColors();
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      accessibilityLabel={label}
      trackColor={{ false: colors.border, true: colors.accent }}
      thumbColor={Platform.OS === 'android' ? colors.surfaceLowest : undefined}
      ios_backgroundColor={colors.border}
    />
  );
}

/** A settings row: optional icon, a title with an optional line under it, and the switch. */
export function ToggleRow({
  title,
  body,
  icon,
  value,
  onValueChange,
  className = 'px-5 py-4',
  align = 'items-center',
}: {
  title: string;
  body?: string;
  icon?: IconName;
  value: boolean;
  onValueChange: (on: boolean) => void;
  className?: string;
  align?: 'items-center' | 'items-start';
}) {
  const colors = useThemeColors();
  return (
    <Surface tone="soft" className={`rounded-lg flex-row ${align} ${className}`} style={{ gap: 12 }}>
      {icon ? <Icon name={icon} size={15} color={colors.accent} stroke={2} /> : null}
      <View className="flex-1">
        <Text className="font-sans-semi text-sm text-fg">{title}</Text>
        {body ? <Text className="font-sans text-sm text-fg-secondary leading-relaxed mt-1">{body}</Text> : null}
      </View>
      <ToggleSwitch value={value} onValueChange={onValueChange} label={title} />
    </Surface>
  );
}
