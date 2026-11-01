import React from 'react';
import { ScrollView } from 'react-native';
import * as Haptics from 'expo-haptics';

import { Chip } from '@/components/ui/CategoryPicker';
import { KINDS, KIND_LABEL } from '@/lib/kind';
import type { ThreadKind } from '@/types/mnemo';

/**
 * Project · Task · Idea, in the same chips as categories. Tapping the chosen
 * one again lets it go: no kind when setting a thread, no filter in a list.
 */
export function KindPicker({
  value,
  onChange,
  plural = false,
  inset = 24,
}: {
  value: ThreadKind | undefined;
  onChange: (value: ThreadKind | undefined) => void;
  /** "Projects" rather than "Project": when filtering a list. */
  plural?: boolean;
  /** Horizontal page padding, so chips scroll edge to edge but start aligned. */
  inset?: number;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -inset }}
      contentContainerStyle={{ gap: 8, paddingHorizontal: inset }}
    >
      {KINDS.map((kind) => (
        <Chip
          key={kind}
          label={plural ? KIND_LABEL[kind].many : KIND_LABEL[kind].one}
          dot={null}
          selected={value === kind}
          onPress={() => {
            Haptics.selectionAsync();
            onChange(value === kind ? undefined : kind);
          }}
        />
      ))}
    </ScrollView>
  );
}
