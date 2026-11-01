import React from 'react';
import { router, useFocusEffect } from 'expo-router';

import { HomeBanner } from '@/components/ui/HomeBanner';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import { placeHealth, placeProblems, type PlaceProblem } from '@/lib/geofence';
import { usePlaces } from '@/lib/place-store';
import { isArmed, overlaps } from '@/lib/places';
import { usePreferences } from '@/lib/preferences';

/**
 * On Home, while a place reminder is waiting and something may stop it:
 * the phone won't let Mnemo watch, its place overlaps another, or one
 * already went off late. Never shown with place reminders off.
 */
export function PlaceReminderPrompt() {
  const colors = useThemeColors();
  const { items } = useMnemoStore();
  const places = usePlaces();
  const { places: on } = usePreferences();
  const armed = on ? items.filter(isArmed) : [];
  const [problems, setProblems] = React.useState<PlaceProblem[]>([]);
  const [hidden, setHidden] = React.useState(false);
  const relies = armed.length > 0;

  useFocusEffect(
    React.useCallback(() => {
      if (!relies) return;
      let live = true;
      placeHealth().then((h) => live && setProblems(placeProblems(h)));
      return () => {
        live = false;
      };
    }, [relies]),
  );

  if (!relies || hidden) return null;
  const used = new Set(armed.map((t) => t.place!.placeId));
  const tangled = places.find((p) => used.has(p.id) && overlaps(p, places).length > 0);
  const first = problems[0];
  if (!first && !tangled) return null;

  const n = armed.length;
  const title = first?.key === 'late' ? 'A place reminder went off late' : `${n === 1 ? 'A place reminder' : `${n} place reminders`} may not go off as expected`;
  const body = first ? first.text : `${tangled!.name}'s circle overlaps another place.`;
  return (
    <HomeBanner
      icon="mapPin"
      iconColor={colors.accentWarm}
      title={title}
      body={body}
      onPress={() => (first?.fix && first.key !== 'late' ? first.fix() : tangled ? router.push(`/place?id=${tangled.id}`) : router.push('/modal'))}
      // A real problem stays until it's fixed; this only hides it until the app opens again.
      onDismiss={() => setHidden(true)}
    />
  );
}
