import React from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui/Text';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useThemeColors } from '@/hooks/use-theme';
import type { ThreadOverview } from '@/types/mnemo';

/** Offered above the timeline once a thread has enough loose notes to group. */
export function OrganiseOffer({
  count,
  spanDays,
  busy,
  onOrganise,
}: {
  count: number;
  /** Days between the first note and the last. */
  spanDays: number;
  busy: boolean;
  onOrganise: () => void;
}) {
  const colors = useThemeColors();
  return (
    <View className="rounded-lg px-5 py-4 gap-3.5" style={{ backgroundColor: colors.surfaceLowest, borderWidth: 1, borderColor: colors.border }}>
      <View className="flex-row items-start">
        <View className="w-9 h-9 rounded-full items-center justify-center" style={{ backgroundColor: colors.accentSoft }}>
          <Icon name="sparkles" size={17} color={colors.accent} />
        </View>
        <View className="flex-1 ml-3">
          <Text className="font-sans-semi text-body" style={{ color: colors.fg }}>
            {count} notes{spanDays > 1 ? ` jotted over ${spanDays} days` : ' so far'}
          </Text>
          <Text className="font-sans text-sm leading-snug mt-0.5" style={{ color: colors.fgSecondary }}>
            Group them by theme, merge the repeats and pull out what's still open.
          </Text>
        </View>
      </View>
      <Button variant="primary" size="sm" className="self-start" disabled={busy} onPress={onOrganise}>
        {busy ? 'Organising…' : 'Organise these notes'}
      </Button>
    </View>
  );
}

/** The organised notes, first in the timeline: themes, then what's still open. */
export function OverviewCard({
  overview,
  newNotes,
  busy,
  onRedo,
}: {
  overview: ThreadOverview;
  /** Notes added since it was made. */
  newNotes: number;
  busy: boolean;
  /** Organise again; left out when AI is off. */
  onRedo?: () => void;
}) {
  const colors = useThemeColors();
  return (
    <View className="rounded-lg px-5 py-4 gap-4" style={{ backgroundColor: colors.surfaceLowest, borderWidth: 1, borderColor: colors.border }}>
      {newNotes > 0 && onRedo ? (
        <View className="flex-row items-center justify-between rounded-md pl-3.5 pr-2 py-2" style={{ backgroundColor: colors.accentSoft }}>
          <Text className="font-sans-medium text-sm flex-1" style={{ color: colors.onPrimaryContainer }}>
            {newNotes === 1 ? '1 new note' : `${newNotes} new notes`} since this
          </Text>
          <Button variant="primary" size="sm" disabled={busy} onPress={onRedo}>
            {busy ? 'Updating…' : 'Update'}
          </Button>
        </View>
      ) : null}

      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center flex-1 mr-3">
          <Icon name="sparkles" size={14} color={colors.accent} />
          <Text className="font-sans-medium text-sm ml-1.5 shrink" style={{ color: colors.fgTertiary }} numberOfLines={1}>
            <Text className="font-sans-semi" style={{ color: colors.accent }}>
              Overview
            </Text>
            {` · from ${overview.notes} notes`}
          </Text>
        </View>
        {newNotes === 0 && onRedo ? (
          <Pressable onPress={onRedo} disabled={busy} hitSlop={10} accessibilityRole="button" accessibilityLabel="Organise the notes again" className="active:opacity-60">
            <Text className="font-sans-semi text-sm" style={{ color: colors.accent }}>
              {busy ? 'Organising…' : 'Redo'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {overview.themes.map((theme, i) => (
        <View key={i}>
          <View className="flex-row items-baseline" style={{ gap: 8 }}>
            <Text className="font-display shrink" style={{ color: colors.fg, fontSize: 17 }}>
              {theme.title}
            </Text>
            <Text className="font-sans text-xs" style={{ color: colors.fgTertiary }}>
              {theme.notes === 1 ? '1 note' : `${theme.notes} notes`}
            </Text>
          </View>
          <View className="mt-1.5 gap-1">
            {theme.points.map((point, j) => (
              <View key={j} className="flex-row items-start">
                <View className="w-1.5 h-1.5 rounded-full mr-2.5 mt-2.5" style={{ backgroundColor: colors.outline }} />
                <Text className="flex-1 font-sans text-body leading-relaxed" style={{ color: colors.fgSecondary }}>
                  {point}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ))}

      {overview.open.length > 0 ? (
        <View className="rounded-md px-3.5 py-3" style={{ backgroundColor: colors.surface }}>
          <Text className="font-sans-semi text-xs uppercase tracking-caps mb-1" style={{ color: colors.fgTertiary }}>
            Still open
          </Text>
          <View className="gap-1">
            {overview.open.map((question, i) => (
              <Text key={i} className="font-sans text-body leading-snug" style={{ color: colors.fg }}>
                {question}
              </Text>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}
