import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { WarningList } from '@/components/PlaceWarnings';
import { Pill } from '@/components/ui/Pill';
import { useThemeColors } from '@/hooks/use-theme';
import { usePlaces } from '@/lib/place-store';
import { overlaps, overlapText } from '@/lib/places';
import type { PlaceReminder } from '@/types/mnemo';

export type PlacePick = Pick<PlaceReminder, 'placeId' | 'on'>;
type Line = { text: string; action?: string; fix?: () => void };

/**
 * Pick a saved place (or add one), then "when I get there" or "when I
 * leave". The same chips wherever a place reminder is set: the Write
 * screen and a thread's edit view. Says at once if the place's circle
 * overlaps another.
 */
export function PlaceChoice({
  value,
  onChange,
  more = [],
}: {
  value: PlacePick | undefined;
  onChange: (next: PlacePick | undefined) => void;
  /** Further warnings to show under the choice (the phone's set-up, limits). */
  more?: Line[];
}) {
  const colors = useThemeColors();
  const places = usePlaces();
  const chosen = value ? places.find((p) => p.id === value.placeId) : undefined;
  const overlap = chosen ? overlapText(overlaps(chosen, places)) : null;
  const lines: Line[] = [
    ...(value && !chosen ? [{ text: "That place was removed, so this can't go off." }] : []),
    ...(overlap && chosen ? [{ text: overlap, action: 'Change', fix: () => router.push(`/place?id=${chosen.id}`) }] : []),
    ...(value ? more : []),
  ];

  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap gap-2">
        {places.map((p) => {
          const selected = value?.placeId === p.id;
          return (
            <Pill
              key={p.id}
              tone={colors.accent}
              size="md"
              dot={false}
              outline={!selected}
              selected={selected}
              onPress={() => onChange(selected ? undefined : { placeId: p.id, on: value?.on ?? 'arrive' })}
            >
              {p.name}
            </Pill>
          );
        })}
        <Pill tone={colors.fgSecondary} size="md" dot={false} outline onPress={() => router.push('/place')}>
          + Add a place
        </Pill>
      </View>
      {value ? (
        <View className="flex-row gap-2">
          {(['arrive', 'leave'] as const).map((on) => (
            <Pill
              key={on}
              tone={colors.fgSecondary}
              size="md"
              dot={false}
              outline={value.on !== on}
              selected={value.on === on}
              onPress={() => value.on !== on && onChange({ ...value, on })}
            >
              {on === 'arrive' ? 'When I get there' : 'When I leave'}
            </Pill>
          ))}
        </View>
      ) : null}
      <WarningList lines={lines} />
    </View>
  );
}
