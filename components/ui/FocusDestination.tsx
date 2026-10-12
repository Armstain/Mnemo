import React from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import * as Haptics from 'expo-haptics';

import { Icon } from '@/components/ui/Icon';
import { useThemeColors } from '@/hooks/use-theme';
import type { MnemoItem } from '@/types/mnemo';

/**
 * On the Write and Record screens while a focus thread is set: says this
 * capture goes there, with a one-tap way to keep just this one separate.
 */
export function FocusDestination({
  focusThread,
  separate,
  onToggle,
}: {
  focusThread: MnemoItem;
  separate: boolean;
  onToggle: (separate: boolean) => void;
}) {
  const colors = useThemeColors();
  return (
    <View
      className="flex-row items-center rounded-md px-4 py-3"
      style={{ backgroundColor: separate ? colors.surface : colors.accentSoft }}
    >
      <Icon name="pin" size={16} color={separate ? colors.fgTertiary : colors.accent} stroke={2} />
      <Text
        className="flex-1 font-sans-medium text-sm ml-2.5 mr-3"
        style={{ color: separate ? colors.fgSecondary : colors.fg }}
        numberOfLines={1}
      >
        {separate ? 'Saving as a new thread' : `Going to ${focusThread.title}`}
      </Text>
      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          onToggle(!separate);
        }}
        hitSlop={10}
        accessibilityRole="button"
      >
        <Text className="font-sans-semi text-sm" style={{ color: colors.accent }}>
          {separate ? 'Undo' : 'Keep separate'}
        </Text>
      </Pressable>
    </View>
  );
}
