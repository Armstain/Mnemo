import React from 'react';
import { View, TextInput, Pressable } from 'react-native';
import { Search, X } from 'lucide-react-native';

import { Glass } from '@/components/ui/Glass';
import { useThemeColors } from '@/hooks/use-theme';

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  onClear?: () => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

/** Theme-aware glass search input — one of the few glass chrome surfaces. */
export const SearchBar = ({
  value,
  onChangeText,
  onClear,
  placeholder = 'Search your thoughts...',
  className = '',
  autoFocus = false,
}: SearchBarProps) => {
  const colors = useThemeColors();

  return (
    <Glass radius={16} variant="subtle">
      <View className={`flex-row items-center px-4 py-3 ${className}`}>
        <Search size={18} color={colors.fgTertiary} strokeWidth={2} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.fgTertiary}
          className="flex-1 ml-3 font-sans text-[15px] pt-0.5 text-fg"
          selectionColor={colors.accent}
          autoFocus={autoFocus}
        />
        {value.length > 0 && (
          <Pressable
            onPress={onClear || (() => onChangeText(''))}
            className="p-1"
            hitSlop={8}
          >
            <X size={16} color={colors.fgSecondary} />
          </Pressable>
        )}
      </View>
    </Glass>
  );
};
