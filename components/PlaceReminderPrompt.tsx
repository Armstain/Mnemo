import React from 'react';
import { router, useFocusEffect } from 'expo-router';

import { HomeBanner } from '@/components/ui/HomeBanner';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import { placeHealth, placeProblems, type PlaceProblem } from '@/lib/geofence';
import { usePlaces } from '@/lib/place-store';
import { isArmed, nearbyPlaces } from '@/lib/places';

/**
 * On Home, while a place reminder is waiting: says so when it may not go
 * off (the phone won't let Mnemo watch places, places too close together,
 * or one already arrived late), instead of letting it fail silently.
 */
export function PlaceReminderPrompt() {
  const colors = useThemeColors();
  const { items } = useMnemoStore();
  const places = usePlaces();
  const armed = items.filter(isArmed);
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
  const tangled = places.filter((p) => used.has(p.id) && nearbyPlaces(p, places).some((n) => n.verdict === 'overlap'));
  const first = problems[0];
  if (!first && tangled.length === 0) return null;

  const n = armed.length;
  const title = first?.key === 'late' ? 'A place reminder went off late' : `${n === 1 ? 'A place reminder' : `${n} place reminders`} may not go off`;
  const body = first
    ? first.text
    : `${tangled[0].name} is too close to another saved place for your phone to tell them apart.`;
  return (
    <HomeBanner
      icon="mapPin"
      iconColor={colors.accentWarm}
      title={title}
      body={body}
      onPress={() => (first?.fix && first.key !== 'late' ? first.fix() : router.push('/modal'))}
      // A real problem stays until it's fixed; this only hides it until the app opens again.
      onDismiss={() => setHidden(true)}
    />
  );
}
