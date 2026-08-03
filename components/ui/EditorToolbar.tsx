import React from 'react';
import { View, Pressable, Text, StyleSheet } from 'react-native';
import { Bold, ListChecks, Type } from 'lucide-react-native';
import { MotiView } from 'moti';

import { useThemeColors } from '@/hooks/use-theme';
import { EASE_OUT } from '@/utils/motion';

export interface TextSelection {
  start: number;
  end: number;
}

/**
 * Wraps the selected substring in `**`. With text selected the wrapped span
 * stays selected, so tapping Bold again unwraps it; with no selection the
 * cursor lands between the markers so typing starts out bold.
 */
export function toggleBold(value: string, selection: TextSelection) {
  const { start, end } = selection;
  const marker = '**';
  const selected = value.slice(start, end);

  // Already wrapped? Unwrap instead of nesting.
  const before = value.slice(Math.max(0, start - marker.length), start);
  const after = value.slice(end, end + marker.length);
  if (before === marker && after === marker) {
    const next =
      value.slice(0, start - marker.length) + selected + value.slice(end + marker.length);
    return {
      next,
      nextSelection: { start: start - marker.length, end: end - marker.length },
    };
  }

  const next = value.slice(0, start) + marker + selected + marker + value.slice(end);
  const nextSelection =
    selected.length > 0
      ? { start: start + marker.length, end: start + marker.length + selected.length }
      : { start: start + marker.length, end: start + marker.length };
  return { next, nextSelection };
}

/**
 * Sets the heading level on the line the cursor sits in. Switching levels
 * replaces the existing `#` prefix rather than stacking onto it, and tapping
 * the level a line already has removes it (back to body text).
 */
export function toggleHeading(value: string, selection: TextSelection, level: 1 | 2 | 3) {
  const { start, end } = selection;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const lineEndSearch = value.indexOf('\n', end);
  const lineEnd = lineEndSearch === -1 ? value.length : lineEndSearch;

  const line = value.slice(lineStart, lineEnd);
  const existing = /^(#{1,6})\s+/.exec(line);
  const stripped = existing ? line.slice(existing[0].length) : line;

  const targetPrefix = '#'.repeat(level) + ' ';
  const alreadyThisLevel = existing?.[1].length === level;
  const nextLine = alreadyThisLevel ? stripped : targetPrefix + stripped;

  const next = value.slice(0, lineStart) + nextLine + value.slice(lineEnd);
  const delta = nextLine.length - line.length;
  return {
    next,
    nextSelection: {
      start: Math.max(lineStart, start + delta),
      end: Math.max(lineStart, end + delta),
    },
  };
}

interface EditorToolbarProps {
  value: string;
  selection: TextSelection;
  /** Receives the edited text and where the selection should land next. */
  onApply: (nextValue: string, nextSelection: TextSelection) => void;
  checklistVisible: boolean;
  onToggleChecklist: () => void;
}

const HEADINGS: { level: 1 | 2 | 3; label: string }[] = [
  { level: 1, label: 'H1' },
  { level: 2, label: 'H2' },
  { level: 3, label: 'H3' },
];

/**
 * EditorToolbar — the note editor's bottom action bar.
 *
 * Two persistent actions (checklist toggle, text-format toggle); tapping
 * the `T` reveals the formatting row, keeping the resting bar minimal so
 * the writing area stays as tall as possible. Formatting works on the
 * current selection: select a word, tap Bold, it wraps in `**`.
 */
export function EditorToolbar({
  value,
  selection,
  onApply,
  checklistVisible,
  onToggleChecklist,
}: EditorToolbarProps) {
  const colors = useThemeColors();
  const [showFormat, setShowFormat] = React.useState(false);

  const activeBg = colors.primaryContainer;
  const activeFg = colors.onPrimaryContainer;

  return (
    <View>
      {showFormat && (
        <MotiView
          from={{ opacity: 0, translateY: 6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 180, easing: EASE_OUT }}
          style={styles.formatRow}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Bold"
            android_ripple={{ color: colors.border, borderless: true, radius: 22 }}
            onPress={() => {
              const { next, nextSelection } = toggleBold(value, selection);
              onApply(next, nextSelection);
            }}
            style={[styles.formatButton, { backgroundColor: colors.surfaceHigh }]}
          >
            <Bold size={17} color={colors.fg} strokeWidth={2.4} />
          </Pressable>

          {HEADINGS.map(({ level, label }) => (
            <Pressable
              key={label}
              accessibilityRole="button"
              accessibilityLabel={`Heading ${level}`}
              android_ripple={{ color: colors.border, borderless: true, radius: 22 }}
              onPress={() => {
                const { next, nextSelection } = toggleHeading(value, selection, level);
                onApply(next, nextSelection);
              }}
              style={[styles.formatButton, { backgroundColor: colors.surfaceHigh }]}
            >
              <Text className="font-sans-semi text-[13px]" style={{ color: colors.fg }}>
                {label}
              </Text>
            </Pressable>
          ))}
        </MotiView>
      )}

      <View style={[styles.bar, { borderTopColor: colors.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Toggle checklist"
          accessibilityState={{ selected: checklistVisible }}
          android_ripple={{ color: colors.border, borderless: true, radius: 24 }}
          onPress={onToggleChecklist}
          style={[
            styles.barButton,
            { backgroundColor: checklistVisible ? activeBg : 'transparent' },
          ]}
        >
          <ListChecks
            size={21}
            color={checklistVisible ? activeFg : colors.fgSecondary}
            strokeWidth={1.9}
          />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Text formatting"
          accessibilityState={{ selected: showFormat }}
          android_ripple={{ color: colors.border, borderless: true, radius: 24 }}
          onPress={() => setShowFormat((v) => !v)}
          style={[
            styles.barButton,
            { backgroundColor: showFormat ? activeBg : 'transparent' },
          ]}
        >
          <Type
            size={21}
            color={showFormat ? activeFg : colors.fgSecondary}
            strokeWidth={1.9}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  barButton: {
    width: 44,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  formatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 10,
  },
  formatButton: {
    minWidth: 42,
    height: 36,
    paddingHorizontal: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
