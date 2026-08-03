import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Trash2 } from 'lucide-react-native';
import { MotiView } from 'moti';

import { useCategories, useStatusConfig } from '@/utils/categories';
import { useThemeColors } from '@/hooks/use-theme';
import { formatCompactDistance } from '@/utils/time';
import { enterUp } from '@/utils/motion';
import type { MnemoItem } from '@/types/mnemo';

interface NoteRowProps {
  item: MnemoItem;
  index: number;
  onPress: () => void;
  /** When provided, shows a delete affordance (used by Library). */
  onDelete?: () => void;
  /** Show the item's status next to the category (used by Library). */
  showStatus?: boolean;
}

/**
 * NoteRow — the shared flat list row for Search and Library.
 *
 * Deliberately NOT a glass card: glass is reserved for hero surfaces
 * (resume card, mic, tab bar). Rows sit flat on the ambient field with a
 * hairline separator, which keeps long lists calm and makes the few
 * glass surfaces read as special.
 */
export function NoteRow({ item, index, onPress, onDelete, showStatus = false }: NoteRowProps) {
  const categories = useCategories();
  const statusConfig = useStatusConfig();
  const colors = useThemeColors();
  const config = categories[item.category];
  const status = statusConfig[item.status];

  return (
    <MotiView {...enterUp(index)}>
      <Pressable
        onPress={onPress}
        className="py-3.5 border-b border-border/60 active:bg-surface rounded-md"
      >
        {/* Top line: category + optional status, timestamp right */}
        <View className="flex-row items-center justify-between mb-1.5">
          <View className="flex-row items-center gap-2">
            <View
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: config.color }}
            />
            <Text
              className="font-sans-medium text-[10px] uppercase tracking-wider"
              style={{ color: config.color }}
            >
              {config.label}
            </Text>
            {showStatus && (
              <Text
                className="font-sans-medium text-[10px] uppercase tracking-wider"
                style={{ color: status.color }}
              >
                · {status.label}
              </Text>
            )}
          </View>
          <Text className="font-sans text-[11px] text-fg-tertiary">
            {formatCompactDistance(item.updatedAt)}
          </Text>
        </View>

        {/* Title */}
        <Text className="font-sans-medium text-[15px] text-fg mb-0.5" numberOfLines={1}>
          {item.title}
        </Text>

        {/* Preview + optional delete */}
        <View className="flex-row items-center">
          <Text
            className="flex-1 font-sans text-[13px] leading-snug text-fg-secondary"
            numberOfLines={1}
          >
            {item.content?.trim() || 'No content.'}
          </Text>
          {onDelete && (
            <Pressable
              onPress={onDelete}
              accessibilityLabel="Delete item"
              className="w-11 h-11 ml-2 items-center justify-center rounded-full active:bg-surface-warm"
              hitSlop={4}
            >
              <Trash2 size={15} color={colors.error} />
            </Pressable>
          )}
        </View>
      </Pressable>
    </MotiView>
  );
}
