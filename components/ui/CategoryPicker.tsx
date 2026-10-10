import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { useThemeColors } from '@/hooks/use-theme';
import { CATEGORY_LIST, useCategories } from '@/utils/categories';
import type { Category } from '@/types/mnemo';

interface CategoryPickerProps<T extends Category | 'all'> {
  value: T;
  onChange: (value: T) => void;
  /** Offer an "All" chip first (filters). */
  includeAll?: boolean;
  /** Horizontal page padding, so chips scroll edge to edge but start aligned. */
  inset?: number;
}

/**
 * The one category chip row: neutral chips with a colour dot, the selected
 * one filled with ink. Used wherever a category is picked or filtered, so
 * the same choice always looks the same.
 */
export function CategoryPicker<T extends Category | 'all'>({
  value,
  onChange,
  includeAll = false,
  inset = 24,
}: CategoryPickerProps<T>) {
  const colors = useThemeColors();
  const categories = useCategories();
  const options = (includeAll ? ['all', ...CATEGORY_LIST] : CATEGORY_LIST) as T[];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -inset }}
      contentContainerStyle={{ gap: 8, paddingHorizontal: inset }}
    >
      {options.map((option) => {
        const selected = value === option;
        const dot = option === 'all' ? null : categories[option as Category].color;
        return (
          <Pressable
            key={option}
            onPress={() => {
              Haptics.selectionAsync();
              onChange(option);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            className="flex-row items-center rounded-full px-3.5 h-9 active:opacity-70"
            style={{
              backgroundColor: selected ? colors.fg : 'transparent',
              borderWidth: 1,
              borderColor: selected ? colors.fg : colors.border,
            }}
          >
            {dot && <View className="w-2 h-2 rounded-full mr-2" style={{ backgroundColor: dot }} />}
            <Text className="font-sans-medium text-sm" style={{ color: selected ? colors.bg : colors.fgSecondary }}>
              {option === 'all' ? 'All' : categories[option as Category].label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
