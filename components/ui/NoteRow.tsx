import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';

import { useCategories, useStatusConfig } from '@/utils/categories';
import { useThemeColors } from '@/hooks/use-theme';
import { formatCompactDistance } from '@/utils/time';
import { useEnter } from '@/utils/motion';
import { Icon } from '@/components/ui/Icon';
import type { MnemoItem } from '@/types/mnemo';

interface NoteRowProps {
  item: MnemoItem;
  index: number;
  onPress: () => void;
  /** When provided, shows a delete affordance (used by Library). */
  onDelete?: () => void;
  /** Show the item's status next to the category (used by Library). */
  showStatus?: boolean;
  /**
   * Stagger this row behind the ones above it. False for query-driven
   * results (Search), where the set changes on every keystroke and a
   * row arriving after the result count reads as lag, not polish.
   */
  stagger?: boolean;
}

/**
 * NoteRow — the shared flat list row for Search and Library.
 *
 * Deliberately NOT a glass card: glass is reserved for hero surfaces
 * (resume card, mic, tab bar). Rows sit flat on the ambient field with a
 * hairline separator and a left category-tick, which keeps long lists calm
 * and makes the few glass surfaces read as special.
 */
export function NoteRow({
  item,
  index,
  onPress,
  onDelete,
  showStatus = false,
  stagger = true,
}: NoteRowProps) {
  const enter = useEnter();
  const categories = useCategories();
  const statusConfig = useStatusConfig();
  const colors = useThemeColors();
  const config = categories[item.category];
  const status = statusConfig[item.status];

  return (
    <MotiView {...enter.row(index, { stagger })} {...enter.rowExit()}>
      <Pressable
        onPress={onPress}
        className="rounded-sm"
        style={({ pressed }) => [
          styles.row,
          {
            borderBottomColor: colors.border,
            backgroundColor: pressed ? colors.surfaceLow : 'transparent',
          },
        ]}
      >
        {/* Left category-color tick */}
        <View style={[styles.tick, { backgroundColor: config.color }]} />

        {/* Top line: category + optional status, timestamp right */}
        <View className="flex-row items-center justify-between gap-3 mb-1.25">
          <View className="flex-row items-center gap-2 shrink" style={{ minWidth: 0 }}>
            <Text
              className="font-sans-semi text-micro uppercase tracking-caps"
              style={{ color: config.color }}
              numberOfLines={1}
            >
              {config.label}
            </Text>
            {showStatus && (
              <Text
                className="font-sans-semi text-micro uppercase tracking-caps"
                style={{ color: colors.fgTertiary }}
                numberOfLines={1}
              >
                {status.label}
              </Text>
            )}
          </View>
          <Text className="font-sans text-xs" style={{ color: colors.fgTertiary }}>
            {formatCompactDistance(item.updatedAt)}
          </Text>
        </View>

        {/* Title */}
        <Text
          className="font-sans-medium text-body mb-0.5"
          style={{ color: colors.fg }}
          numberOfLines={1}
        >
          {item.title}
        </Text>

        {/* Preview + optional delete */}
        <View className="flex-row items-center gap-2">
          <Text
            className="flex-1 font-sans text-sm"
            style={{ color: colors.fgSecondary }}
            numberOfLines={1}
          >
            {item.content?.trim() || 'No content.'}
          </Text>
          {onDelete && (
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onDelete();
              }}
              accessibilityLabel="Delete item"
              className="items-center justify-center rounded-full"
              style={{ width: 32, height: 32 }}
              hitSlop={8}
            >
              <Icon name="trash" size={15} color={colors.fgTertiary} />
            </Pressable>
          )}
        </View>
      </Pressable>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  row: {
    position: 'relative',
    paddingVertical: 14,
    paddingRight: 12,
    paddingLeft: 14,
    borderBottomWidth: 1,
  },
  tick: {
    position: 'absolute',
    left: 0,
    top: 16,
    bottom: 16,
    width: 2,
    borderRadius: 9999,
  },
});
