import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { MotiView } from 'moti';

import { ThreadRing } from '@/components/ui/ThreadRing';
import { useThemeColors } from '@/hooks/use-theme';
import { useCategories, useStatusConfig } from '@/utils/categories';
import { formatCompactDistance, freshness } from '@/utils/time';
import { useEnter } from '@/utils/motion';
import type { MnemoItem } from '@/types/mnemo';

/** One line of preview: the next step, else the note text, else checklist progress. */
export function threadPreview(item: MnemoItem): string {
  if (item.nextStep) return item.nextStep;
  // Notes are markdown; a one-line preview shows the words, not the markup.
  const body = item.content
    ?.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-*+]|\d+\.|#{1,6}|>)\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (body) return body;
  const checklist = item.checklistItems ?? [];
  if (checklist.length > 0) {
    const done = checklist.filter((c) => c.checked).length;
    return `${done} of ${checklist.length} done`;
  }
  return item.pending ? 'Transcribing your recording…' : '';
}

interface ThreadRowProps {
  item: MnemoItem;
  onPress: () => void;
  /** Second line. Defaults to status (when not active) + preview. */
  detail?: string;
  /** Right-hand text. Defaults to how long since it was touched. */
  trailing?: string;
  trailingTone?: string;
  /** Last row in its list: no divider below. */
  last?: boolean;
  /** Position in the list, for the staggered entrance. */
  index?: number;
}

/**
 * The one list row for a thread, used by Home, Library and related
 * threads: its ring (how warm it still is), title, one line of detail and
 * a timestamp. Rows sit inside a ThreadList so every list reads the same.
 */
export function ThreadRow({ item, onPress, detail, trailing, trailingTone, last = false, index = 0 }: ThreadRowProps) {
  const colors = useThemeColors();
  const enter = useEnter();
  const categories = useCategories();
  const statusConfig = useStatusConfig();
  const category = categories[item.category];
  const CategoryIcon = category.icon;

  const statusPrefix = item.status === 'active' ? '' : `${statusConfig[item.status].label} · `;
  const secondLine = detail ?? `${statusPrefix}${threadPreview(item)}`.replace(/ · $/, '');

  return (
    <MotiView {...enter.row(index)} {...enter.rowExit()}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}. ${secondLine}`}
        style={({ pressed }) => ({ backgroundColor: pressed ? colors.surfaceHigh : 'transparent' })}
      >
        <View className="flex-row items-center px-4 py-3.5">
          <View className="mr-3.5">
            <ThreadRing size={40} progress={freshness(item.updatedAt)} color={category.color} trackColor={category.bgTint}>
              <CategoryIcon size={15} color={category.color} strokeWidth={2} />
            </ThreadRing>
          </View>
          <View className="flex-1 mr-3" style={{ minWidth: 0 }}>
            <Text className="font-sans-medium text-body" style={{ color: colors.fg }} numberOfLines={1}>
              {item.title}
            </Text>
            {secondLine ? (
              <Text className="font-sans text-sm mt-0.5" style={{ color: colors.fgTertiary }} numberOfLines={1}>
                {secondLine}
              </Text>
            ) : null}
          </View>
          <Text className="font-sans-medium text-sm" style={{ color: trailingTone ?? colors.fgTertiary }}>
            {trailing ?? formatCompactDistance(item.updatedAt)}
          </Text>
        </View>
        {!last && <View style={{ marginLeft: 70, marginRight: 16, height: 1, backgroundColor: colors.border }} />}
      </Pressable>
    </MotiView>
  );
}

/** The grouped surface every list of ThreadRows sits in. */
export function ThreadList({ children }: { children: React.ReactNode }) {
  const colors = useThemeColors();
  return (
    <View className="rounded-lg overflow-hidden" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
      {children}
    </View>
  );
}
