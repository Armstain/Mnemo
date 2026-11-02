import React from 'react';
import { AppState, View } from 'react-native';
import { router } from 'expo-router';

import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { usePlaceProblems, WarningList } from '@/components/PlaceWarnings';
import { PlaceChoice } from '@/components/PlaceChoice';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import { allowBackground } from '@/lib/geofence';
import { usePlaces } from '@/lib/place-store';
import { MAX_WATCHED, overlaps, overlapText, pickWatched, placeLabel } from '@/lib/places';
import { usePreferences } from '@/lib/preferences';
import { formatReminder } from '@/lib/when';
import type { MnemoItem, PlaceReminder } from '@/types/mnemo';

/** Bumps whenever the app comes back (from the phone's settings), so checks run again. */
function useReturns(): number {
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && setN((x) => x + 1));
    return () => sub.remove();
  }, []);
  return n;
}

type Line = { text: string; action?: string; fix?: () => void };

/** Everything that may stop this thread's reminder going off. */
function useWarnings(thread: MnemoItem): Line[] {
  const places = usePlaces();
  const { items } = useMnemoStore();
  const problems = usePlaceProblems(useReturns());
  const r = thread.place;
  if (!r || r.firedAt) return [];
  const place = places.find((p) => p.id === r.placeId);
  if (!place) return [{ text: "That place was removed, so this can't go off.", action: 'Places', fix: () => router.push('/modal') }];
  const lines: Line[] = [];
  const overlap = overlapText(overlaps(place, places));
  if (overlap) lines.push({ text: overlap, action: 'Change', fix: () => router.push(`/place?id=${place.id}`) });
  if (pickWatched(items, places).overflow.has(place.id)) {
    lines.push({ text: `A phone watches at most ${MAX_WATCHED} places at once; this one waits until others are done.` });
  }
  return [...lines, ...(problems ?? [])];
}

/**
 * The thread's edit view: remind on arriving at, or leaving, a saved place.
 * Only there when place reminders are on (Settings → Location).
 */
export function PlaceReminderField({ thread, onChange }: { thread: MnemoItem; onChange: (place: PlaceReminder | undefined) => void }) {
  const colors = useThemeColors();
  const places = usePlaces();
  const problems = usePlaceProblems(useReturns());
  const { items } = useMnemoStore();
  const r = thread.place;
  const waiting = r && !r.firedAt ? r : undefined;
  const overflow = waiting && pickWatched(items, places).overflow.has(waiting.placeId);

  return (
    <View className="gap-3">
      <PlaceChoice
        value={waiting}
        onChange={(next) => {
          if (!next) return onChange(undefined);
          // A new place or direction starts over: where the phone is gets read again.
          onChange({ ...next, step: r?.step, setAt: Date.now() });
          // Without "all the time", nothing goes off while Mnemo is closed.
          allowBackground();
        }}
        more={[
          ...(overflow ? [{ text: `A phone watches at most ${MAX_WATCHED} places at once; this one waits until others are done.` }] : []),
          ...(problems ?? []),
        ]}
      />
      {r?.firedAt ? (
        <Text className="font-sans text-sm" style={{ color: colors.fgTertiary }}>
          {placeLabel(r, places.find((p) => p.id === r.placeId))}: went off {formatReminder(r.firedAt)}
          {r.caughtLate ? ', late' : ''}. Pick a place to set another.
        </Text>
      ) : null}
    </View>
  );
}

/** Under the thread's title: the place reminder, and what may stop it. */
export function PlaceReminderLabel({ thread }: { thread: MnemoItem }) {
  const colors = useThemeColors();
  const places = usePlaces();
  const { places: on } = usePreferences();
  const warnings = useWarnings(thread);
  const r = thread.place;
  if (!on || !r || r.firedAt) return null;
  const shaky = warnings.length > 0;
  const tone = shaky ? colors.accentWarm : colors.accent;
  return (
    <View className="mt-2 gap-1.5">
      <View className="flex-row items-center" style={{ gap: 6 }}>
        <Icon name="mapPin" size={14} color={tone} stroke={2} />
        <Text className="font-sans-medium text-sm" style={{ color: tone }}>
          {placeLabel(r, places.find((p) => p.id === r.placeId))}
        </Text>
      </View>
      {shaky ? <WarningList lines={warnings.slice(0, 2)} /> : null}
    </View>
  );
}
