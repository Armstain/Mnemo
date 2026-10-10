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

/** One line of preview: the note body, else its next step, else checklist progress. */
function previewText(item: MnemoItem): string {
  // Notes are markdown; a one-line preview shows the words, not the markup.
  const body = item.content
    ?.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-*+]|\d+\.|#{1,6}|>)\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (body) return body;
  if (item.nextStep) return `Next: ${item.nextStep}`;
  const checklist = item.checklistItems ?? [];
  if (checklist.length > 0) {
    const done = checklist.filter((c) => c.checked).length;
    return `${done} of ${checklist.length} done`;
  }
  return item.pending ? 'Transcribing your recording…' : 'Empty note';
}

/**
 * NoteRow — the shared flat list row for Search and Library.
 *
 * Deliberately not a card: rows sit flat on the page with a hairline
 * separator and a left category tick, which keeps long lists calm and
 * leaves raised surfaces for the few things that should stand out.
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
            {previewText(item)}
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
