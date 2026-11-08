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
import { isArmed, MAX_WATCHED, occurrenceOf, overlaps, overlapText, pickWatched, placeLabel } from '@/lib/places';
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
  // Set where the phone already is: it can't ring until the next crossing, which looked like "not working".
  if (r.on === 'arrive' && r.insideAtSet) {
    lines.push({ text: `You're at ${place.name} now, so this goes off the next time you arrive, after leaving.` });
  } else if (r.on === 'leave' && r.insideAtSet === false) {
    lines.push({ text: `You're not at ${place.name} now, so this goes off after you get there and then leave.` });
  }
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
          // Only how often changed: it keeps where the phone is and when it last rang.
          if (waiting && next.placeId === waiting.placeId && next.on === waiting.on) {
            return onChange({ ...waiting, repeat: next.repeat, days: next.days });
          }
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
      {waiting?.repeat && waiting.lastFiredAt ? (
        <Text className="font-sans text-sm" style={{ color: colors.fgTertiary }}>
          Last went off {formatReminder(waiting.lastFiredAt)}
          {waiting.caughtLate ? ', late' : ''}.
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
  // A finished or archived thread's reminder no longer rings: not shown as if it would.
  if (!on || !r || !isArmed(thread)) return null;
  const shaky = warnings.length > 0;
  const tone = shaky ? colors.accentWarm : colors.accent;
  // A repeating one: today's ring, so it's plain that Done finished today and not the reminder.
  const today = r.repeat ? occurrenceOf(r) : null;
  const todayText = today?.state === 'done' ? 'Done for today' : today?.state === 'due' ? `Went off ${formatReminder(today.at).toLowerCase()}` : null;
  return (
    <View className="mt-2 gap-1.5">
      <View className="flex-row items-center" style={{ gap: 6 }}>
        <Icon name="mapPin" size={14} color={tone} stroke={2} />
        <Text className="font-sans-medium text-sm shrink" style={{ color: tone }}>
          {placeLabel(r, places.find((p) => p.id === r.placeId))}
          {todayText ? <Text className="font-sans text-sm" style={{ color: colors.fgTertiary }}>{`  ·  ${todayText}`}</Text> : null}
        </Text>
      </View>
      {shaky ? <WarningList lines={warnings.slice(0, 2)} /> : null}
    </View>
  );
}
