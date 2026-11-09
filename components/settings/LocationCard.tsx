import React from 'react';
import { AppState, Platform, Pressable, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { haptic } from '@/utils/haptics';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { usePlaceProblems } from '@/components/PlaceWarnings';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import { usePlaces } from '@/lib/place-store';
import { formatMeters, isArmed, watchedRadius } from '@/lib/places';
import { setPreferences, usePreferences } from '@/lib/preferences';
import { allowBackground, geofenceOutcome, onGeofenceOutcome } from '@/lib/geofence';
import { outcomeLine } from '@/lib/geofence-outcome';
import { allowPlaceNotifications, DEFAULT_PLACE_SOUND, PLACE_SOUNDS, ringPlaceReminder } from '@/lib/place-sound';
import { Pill } from '@/components/ui/Pill';
import { confirmAction } from '@/utils/confirm';

/**
 * Settings → Location. Place reminders are optional and off until turned
 * on here: until then nothing about location is asked for, watched or
 * shown anywhere else. On: the saved places, and what the phone needs.
 */
export function LocationCard() {
  const colors = useThemeColors();
  const { places: on, placeSound } = usePreferences();
  const sound = placeSound ?? DEFAULT_PLACE_SOUND;
  const [tested, setTested] = React.useState(false);
  const places = usePlaces();
  const { items } = useMnemoStore();
  const waiting = items.filter(isArmed);
  // Rechecked on return from the phone's settings.
  const [returns, setReturns] = React.useState(0);
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && setReturns((n) => n + 1));
    return () => sub.remove();
  }, []);
  const problems = usePlaceProblems(`${returns}:${on}`);
  // What Android answered when the places were last set: read on each return and each answer.
  const [answers, setAnswers] = React.useState(0);
  React.useEffect(() => onGeofenceOutcome(() => setAnswers((n) => n + 1)), []);
  const watching = React.useMemo(() => (on && waiting.length > 0 ? outcomeLine(geofenceOutcome()) : null), [on, waiting.length, returns, answers]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (next: boolean) => {
    if (next || waiting.length === 0) {
      haptic.toggle(next);
      setPreferences({ places: next });
      // Turning on asks right away: while in use, then "all the time",
      // without which nothing rings while Mnemo is closed.
      if (next) allowPlaceNotifications().then(allowBackground).then(() => setReturns((n) => n + 1));
      return;
    }
    confirmAction({
      title: 'Turn off place reminders?',
      message: `${waiting.length === 1 ? 'One reminder waits' : `${waiting.length} reminders wait`} for a place. ${waiting.length === 1 ? 'It stays' : 'They stay'} on ${waiting.length === 1 ? 'its thread' : 'their threads'} and ${waiting.length === 1 ? 'goes' : 'go'} back on when you turn this on again.`,
      confirmLabel: 'Turn off',
      cancelLabel: 'Keep on',
      onConfirm: () => setPreferences({ places: false }),
    });
  };

  return (
    <View className="bg-surface rounded-lg p-5 border border-border/50 gap-4">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center flex-1 mr-3">
          <Icon name="mapPin" size={15} color={colors.accent} stroke={2} />
          <Text className="font-sans-semi text-sm text-fg ml-2">Place reminders</Text>
        </View>
        <Switch
          value={!!on}
          onValueChange={toggle}
          accessibilityLabel="Place reminders"
          trackColor={{ false: colors.border, true: colors.accent }}
          thumbColor={Platform.OS === 'android' ? colors.surfaceLowest : undefined}
          ios_backgroundColor={colors.border}
        />
      </View>

      {!on ? <Text className="font-sans text-sm text-fg-secondary">Ring when you arrive somewhere or leave.</Text> : null}

      {on ? (
        <>
          {/* Android's own word that it's watching (Android builds with the native registration). */}
          {watching && !(problems && problems.length > 0) ? (
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <Icon name="check" size={14} color={colors.accent} />
              <Text className="font-sans text-sm flex-1" style={{ color: colors.fgSecondary }}>
                {watching}
              </Text>
            </View>
          ) : null}

          {/* What may stop it lives on the check page; here, just that there is something. */}
          {problems && problems.length > 0 ? (
            <Pressable
              onPress={() => router.push('/reminders-check')}
              accessibilityRole="button"
              className="flex-row items-center active:opacity-70"
              style={{ gap: 8 }}
            >
              <Icon name="alert" size={14} color={colors.error} />
              <Text className="font-sans-medium text-sm flex-1" style={{ color: colors.error }}>
                {problems.length === 1 ? 'One thing may stop these' : `${problems.length} things may stop these`}
              </Text>
              <Icon name="chevronRight" size={14} color={colors.error} />
            </Pressable>
          ) : null}

          {places.map((p) => {
            const uses = waiting.filter((t) => t.place?.placeId === p.id).length;
            return (
              <Pressable
                key={p.id}
                onPress={() => router.push(`/place?id=${p.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`${p.name}. Change or remove.`}
                className="pt-4 border-t border-border/50 gap-2 active:opacity-80"
              >
                <View className="flex-row items-center" style={{ gap: 10 }}>
                  <View className="flex-1">
                    <Text className="font-sans-semi text-body" style={{ color: colors.fg }}>
                      {p.name}
                    </Text>
                    <Text className="font-sans text-sm mt-0.5" style={{ color: colors.fgTertiary }}>
                      {formatMeters(watchedRadius(p))} circle{uses ? ` · ${uses} waiting` : ''}
                    </Text>
                  </View>
                  <Icon name="chevronRight" size={16} color={colors.fgTertiary} />
                </View>
              </Pressable>
            );
          })}

          <Button variant="quiet" size="sm" icon="plus" onPress={() => router.push('/place')}>
            Add a place
          </Button>

          {/* How it rings: its own sound, loud, and on the lock screen. */}
          {Platform.OS !== 'web' ? (
            <View className="pt-4 border-t border-border/50 gap-3">
              <Text className="font-sans-semi text-sm" style={{ color: colors.fg }}>
                Sound
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {PLACE_SOUNDS.map((p) => (
                  <Pill
                    key={p.key}
                    tone={colors.accent}
                    size="md"
                    dot={false}
                    outline={sound !== p.key}
                    selected={sound === p.key}
                    onPress={() => {
                      setPreferences({ placeSound: p.key });
                      setTested(false);
                      ringPlaceReminder({ title: p.label, body: 'This is how a place reminder will sound.' }, p.key);
                    }}
                  >
                    {p.label}
                  </Pill>
                ))}
              </View>
              <View className="flex-row items-center justify-between gap-3">
                <Text className="font-sans text-sm text-fg-tertiary flex-1">
                  {tested ? 'Sent.' : 'Hear it'}
                </Text>
                <Button
                  variant="quiet"
                  size="sm"
                  onPress={() => {
                    ringPlaceReminder({ title: 'Place reminder', body: 'When you get to a place you saved, it rings like this.' });
                    setTested(true);
                  }}
                >
                  Ring now
                </Button>
              </View>
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
