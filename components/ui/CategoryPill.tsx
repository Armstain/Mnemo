import React from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Category } from '@/types/mnemo';
import { useCategories } from '@/utils/categories';
import { useThemeColors } from '@/hooks/use-theme';

interface CategoryPillProps {
  category: Category;
  selected?: boolean;
  size?: 'sm' | 'md';
  onPress?: () => void;
  showIcon?: boolean;
}

export function CategoryPill({
  category,
  selected = false,
  size = 'sm',
  onPress,
  showIcon = true,
}: CategoryPillProps) {
  const categories = useCategories();
  const colors = useThemeColors();
  const config = categories[category];
  const Icon = config.icon;

  const isSmall = size === 'sm';
  // Ink on a selected (color-filled) pill: the theme bg reads as "ink"
  // against both the bright dark-theme colors and deep light-theme ones.
  const selectedInk = colors.bg;

  const content = (
    <View
      className={`flex-row items-center rounded-full ${
        isSmall ? 'px-2.5 py-1' : 'px-3.5 py-1.5'
      }`}
      style={{
        backgroundColor: selected ? config.color : config.bgTint,
        borderWidth: selected ? 0 : 1,
        borderColor: selected ? 'transparent' : `${config.color}20`,
      }}
    >
      {showIcon && (
        <Icon
          size={isSmall ? 11 : 14}
          color={selected ? selectedInk : config.color}
          strokeWidth={1.8}
        />
      )}
      <Text
        className={`font-sans-medium ${
          isSmall ? 'text-[10px] ml-1' : 'text-xs ml-1.5'
        }`}
        style={{ color: selected ? selectedInk : config.color }}
      >
        {config.label}
      </Text>
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} className="active:opacity-70 active:scale-95">
        {content}
      </Pressable>
    );
  }

  return content;
}
