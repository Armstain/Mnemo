import React from 'react';
import { PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { AnimatePresence, MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import { Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Animated, usePressScale } from '@/hooks/use-press-scale';
import { Icon } from '@/components/ui/Icon';

import { ThreadRing } from '@/components/ui/ThreadRing';
import { useThemeColors } from '@/hooks/use-theme';
import { useCategories, useStatusConfig } from '@/utils/categories';
import { formatCompactDistance, freshness } from '@/utils/time';
import { sameWords, withoutLead } from '@/utils/text';
import { EASE_OUT, useEnter } from '@/utils/motion';
import type { MnemoItem } from '@/types/mnemo';

/**
 * One line of preview: the next step, else the note text, else checklist
 * progress. Never the title again: a next step that only repeats it is
 * skipped, and the note loses a leading copy of it.
 */
export function threadPreview(item: MnemoItem): string {
  if (item.nextStep && !sameWords(item.nextStep, item.title)) return item.nextStep;
  // Notes are markdown; a one-line preview shows the words, not the markup.
  const text = item.content
    ?.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-*+]|\d+\.|#{1,6}|>)\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const body = text && withoutLead(text, item.title);
  if (body) return body;
  const checklist = item.checklistItems ?? [];
  if (checklist.length > 0) {
    const done = checklist.filter((c) => c.checked).length;
    return `${done} of ${checklist.length} done`;
  }
  return item.pending ? 'Being read…' : '';
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
  /**
   * In a long, virtualized list (Library) each row draws its own share of
   * the grouped surface, since there's no ThreadList around them, and rows
   * scrolled into view don't play the entrance.
   */
  cell?: { first: boolean; animate: boolean };
  /** Swipe left to delete. Leave unset for rows that can't be deleted. */
  onSwipeDelete?: () => void;
}

/** Share of the row's width a swipe must pass before letting go deletes. */
const SWIPE_ARM = 0.4;
const SWIPE_OUT_MS = 180;
const SWIPE_BACK = { damping: 20, stiffness: 260, mass: 0.6 };

/**
 * Swipe-left-to-delete: the row follows the finger over a red bin, ticks
 * as it crosses the line (and back), and thuds as it goes.
 */
function useSwipeDelete(onDelete?: () => void) {
  const x = useSharedValue(0);
  const width = useSharedValue(0);
  const armed = React.useRef(false);
  const onDeleteRef = React.useRef(onDelete);
  onDeleteRef.current = onDelete;

  const responder = React.useMemo(
    () =>
      PanResponder.create({
        // Capture, so a sideways drag is taken from the row's Pressable;
        // mostly-vertical moves are left to the list's scroll.
        onMoveShouldSetPanResponderCapture: (_, g) =>
          !!onDeleteRef.current && g.dx < -10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, g) => {
          x.value = Math.min(0, g.dx);
          const nowArmed = -g.dx > width.value * SWIPE_ARM;
          if (nowArmed !== armed.current) {
            armed.current = nowArmed;
            if (nowArmed) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            else Haptics.selectionAsync();
          }
        },
        onPanResponderRelease: (_, g) => {
          const flung = g.vx < -1 && -g.dx > width.value * 0.15;
          const commit = armed.current || flung;
          armed.current = false;
          if (!commit) {
            x.value = withSpring(0, SWIPE_BACK);
            return;
          }
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          x.value = withTiming(-width.value, { duration: SWIPE_OUT_MS, easing: EASE_OUT });
          setTimeout(() => onDeleteRef.current?.(), SWIPE_OUT_MS);
        },
        onPanResponderTerminate: () => {
          armed.current = false;
          x.value = withSpring(0, SWIPE_BACK);
        },
      }),
    [x, width],
  );

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const binStyle = useAnimatedStyle(() => ({ opacity: x.value < 0 ? 1 : 0 }));
  const iconStyle = useAnimatedStyle(() => {
    const line = width.value * SWIPE_ARM || 1;
    return {
      transform: [{ scale: interpolate(-x.value, [0, line, line + 1], [0.6, 1, 1.25], Extrapolation.CLAMP) }],
    };
  });

  return { x, width, responder, rowStyle, binStyle, iconStyle };
}

/**
 * The one list row for a thread, used by Home, Library and related
 * threads: its ring (how warm it still is), title, one line of detail and
 * a timestamp. Rows sit inside a ThreadList so every list reads the same.
 */
function ThreadRowImpl({ item, onPress, detail, trailing, trailingTone, last = false, index = 0, cell, onSwipeDelete }: ThreadRowProps) {
  const colors = useThemeColors();
  const enter = useEnter();
  const categories = useCategories();
  const statusConfig = useStatusConfig();
  const category = categories[item.category];
  const CategoryIcon = category.icon;

  const statusPrefix = item.status === 'active' ? '' : `${statusConfig[item.status].label} · `;
  const press = usePressScale(0.985);
  const secondLine = detail ?? `${statusPrefix}${threadPreview(item)}`.replace(/ · $/, '');
  const swipe = useSwipeDelete(onSwipeDelete);

  return (
    <MotiView
      {...(cell && !cell.animate ? {} : enter.row(index))}
      {...enter.rowExit()}
      // Virtualized rows (cell) are placed by their list, not animated.
      {...(cell ? {} : enter.reflow())}
      style={
        cell
          ? {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderLeftWidth: 1,
              borderRightWidth: 1,
              borderTopWidth: cell.first ? 1 : 0,
              borderBottomWidth: last ? 1 : 0,
              borderTopLeftRadius: cell.first ? 26 : 0,
              borderTopRightRadius: cell.first ? 26 : 0,
              borderBottomLeftRadius: last ? 26 : 0,
              borderBottomRightRadius: last ? 26 : 0,
              overflow: 'hidden',
            }
          : undefined
      }
    >
      {onSwipeDelete ? (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.bin, { backgroundColor: colors.error }, swipe.binStyle]}
        >
          <Animated.View style={swipe.iconStyle}>
            <Icon name="trash" size={20} color={colors.errorInk} stroke={2.2} />
          </Animated.View>
        </Animated.View>
      ) : null}
      <Animated.View
        {...(onSwipeDelete ? swipe.responder.panHandlers : {})}
        onLayout={(e) => (swipe.width.value = e.nativeEvent.layout.width)}
        // Opaque while sliding, so the bin shows only where the row has left.
        style={[{ backgroundColor: cell ? colors.surface : undefined }, swipe.rowStyle]}
      >
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}. ${secondLine}`}
        style={({ pressed }) => ({ backgroundColor: pressed ? colors.surfaceHigh : 'transparent' })}
      >
        <Animated.View style={[{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 }, press.style]}>
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
        </Animated.View>
        {!last && <View style={{ marginLeft: 70, marginRight: 16, height: 1, backgroundColor: colors.border }} />}
      </Pressable>
      </Animated.View>
    </MotiView>
  );
}

/**
 * Rows only change when their thread does. `onPress` and `onSwipeDelete`
 * are left out of the comparison: lists make new ones each render, and they
 * always act on this row's thread.
 */
export const ThreadRow = React.memo(
  ThreadRowImpl,
  (a, b) =>
    a.item === b.item &&
    a.detail === b.detail &&
    a.trailing === b.trailing &&
    a.trailingTone === b.trailingTone &&
    a.last === b.last &&
    a.index === b.index &&
    a.cell?.first === b.cell?.first &&
    a.cell?.animate === b.cell?.animate,
);

const styles = StyleSheet.create({
  bin: { alignItems: 'flex-end', justifyContent: 'center', paddingRight: 28 },
});

/**
 * The grouped surface every list of ThreadRows sits in. A row that leaves
 * plays its exit, and the rest slide up to close the gap.
 */
export function ThreadList({ children }: { children: React.ReactNode }) {
  const colors = useThemeColors();
  const enter = useEnter();
  return (
    <MotiView
      {...enter.reflow()}
      className="rounded-lg overflow-hidden"
      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
    >
      <AnimatePresence>{children}</AnimatePresence>
    </MotiView>
  );
}
