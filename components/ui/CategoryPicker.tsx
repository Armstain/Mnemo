import React from 'react';
import { ScrollView } from 'react-native';

import { Pill } from '@/components/ui/Pill';
import { useThemeColors } from '@/hooks/use-theme';
import { useCategories } from '@/hooks/use-categories';
import { CATEGORIES, type Category } from '@/types/mnemo';

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
  const categories = useCategories();
  const colors = useThemeColors();
  const options = (includeAll ? ['all', ...CATEGORIES] : [...CATEGORIES]) as T[];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -inset }}
      contentContainerStyle={{ gap: 8, paddingHorizontal: inset }}
    >
      {options.map((option) => {
        const selected = value === option;
        return (
          <Pill
            key={option}
            size="lg"
            tone={selected ? colors.fg : colors.fgSecondary}
            dot={option !== 'all'}
            dotColor={option === 'all' ? undefined : categories[option as Category].color}
            selected={selected}
            onPress={() => onChange(option)}
          >
            {option === 'all' ? 'All' : categories[option as Category].label}
          </Pill>
        );
      })}
    </ScrollView>
  );
}
