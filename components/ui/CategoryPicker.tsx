import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import * as Haptics from 'expo-haptics';

import { useThemeColors } from '@/hooks/use-theme';
import { Animated, usePressScale } from '@/hooks/use-press-scale';
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
          <Chip
            key={option}
            label={option === 'all' ? 'All' : categories[option as Category].label}
            dot={dot}
            selected={selected}
            onPress={() => {
              Haptics.selectionAsync();
              onChange(option);
            }}
          />
        );
      })}
    </ScrollView>
  );
}

/** One chip: gives under the finger, and pops when it becomes the choice. */
function Chip({
  label,
  dot,
  selected,
  onPress,
}: {
  label: string;
  dot: string | null;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const press = usePressScale(0.94);
  const wasSelected = React.useRef(selected);
  React.useEffect(() => {
    if (selected && !wasSelected.current) press.pop();
    wasSelected.current = selected;
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Pressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Animated.View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            borderRadius: 999,
            paddingHorizontal: 14,
            height: 36,
            backgroundColor: selected ? colors.fg : 'transparent',
            borderWidth: 1,
            borderColor: selected ? colors.fg : colors.border,
          },
          press.style,
        ]}
      >
        {dot && <View className="w-2 h-2 rounded-full mr-2" style={{ backgroundColor: dot }} />}
        <Text className="font-sans-medium text-sm" style={{ color: selected ? colors.bg : colors.fgSecondary }}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}
