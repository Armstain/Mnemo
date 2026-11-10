import React, { useState } from 'react';
import { Pressable } from 'react-native';
import { TextInput } from '@/components/ui/TextInput';
import { MotiView } from 'moti';

import { Icon } from '@/components/ui/Icon';
import { useThemeColors } from '@/hooks/use-theme';
import { useReduceMotion } from '@/hooks/use-accessibility-motion';
import { DUR_TOGGLE, EASE_OUT, motion } from '@/utils/motion';
import { noFocusRing } from '@/utils/web';

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
}

export const SearchBar = ({ value, onChangeText, placeholder = 'Search your thoughts...' }: SearchBarProps) => {
  const colors = useThemeColors();
  const reduceMotion = useReduceMotion();
  const [isFocused, setIsFocused] = useState(false);

  return (
    // Colour only — no travel, no scale — so this stays honest under Reduce
    // Motion, where a colour change is exactly the kind of feedback the
    // guidance says to keep. The field reads as waking up rather than
    // snapping to a different set of colours between frames.
    <MotiView
      animate={{
        backgroundColor: isFocused ? colors.surfaceLowest : colors.surface,
        borderColor: isFocused ? colors.accent : colors.border,
      }}
      transition={motion(
        { type: 'timing' as const, duration: DUR_TOGGLE, easing: EASE_OUT },
        reduceMotion,
      )}
      className="flex-row items-center rounded-full"
      style={{
        gap: 10,
        height: 48,
        paddingHorizontal: 16,
        borderWidth: 1,
      }}
    >
      <Icon name="search" size={18} stroke={2} color={colors.fgTertiary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={colors.fgTertiary}
        className="flex-1 font-sans text-body"
        style={[{ color: colors.fg }, noFocusRing]}
        selectionColor={colors.accent}
      />
      {value.length > 0 && (
        <Pressable onPress={() => onChangeText('')} hitSlop={8}>
          <Icon name="x" size={16} color={colors.fgSecondary} />
        </Pressable>
      )}
    </MotiView>
  );
};
