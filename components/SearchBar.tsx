import React, { useState } from 'react';
import { TextInput, Pressable } from 'react-native';
import { MotiView } from 'moti';

import { Icon } from '@/components/ui/Icon';
import { useThemeColors } from '@/hooks/use-theme';
import { useReduceMotion } from '@/hooks/use-accessibility-motion';
import { DUR_TOGGLE, EASE_OUT, motion } from '@/utils/motion';
import { noFocusRing } from '@/utils/web';

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  onClear?: () => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

/** Theme-aware solid pill search input. */
export const SearchBar = ({
  value,
  onChangeText,
  onClear,
  placeholder = 'Search your thoughts...',
  className = '',
  autoFocus = false,
}: SearchBarProps) => {
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
      className={`flex-row items-center rounded-full ${className}`}
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
        autoFocus={autoFocus}
      />
      {value.length > 0 && (
        <Pressable onPress={onClear || (() => onChangeText(''))} hitSlop={8}>
          <Icon name="x" size={16} color={colors.fgSecondary} />
        </Pressable>
      )}
    </MotiView>
  );
};
