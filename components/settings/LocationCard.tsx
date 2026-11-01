import React from 'react';
import { AppState, Platform, Pressable, Switch, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { usePlaceProblems, WarningList } from '@/components/PlaceWarnings';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import { usePlaces } from '@/lib/place-store';
import { formatMeters, isArmed, overlaps, overlapText, watchedRadius } from '@/lib/places';
import { setPreferences, usePreferences } from '@/lib/preferences';
import { confirmAction } from '@/utils/confirm';

/**
 * Settings → Location. Place reminders are optional and off until turned
 * on here: until then nothing about location is asked for, watched or
 * shown anywhere else. On: the saved places, and what the phone needs.
 */
export function LocationCard() {
  const colors = useThemeColors();
  const { places: on } = usePreferences();
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

  const toggle = (next: boolean) => {
    if (next || waiting.length === 0) {
      Haptics.selectionAsync();
      setPreferences({ places: next });
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

      <Text className="font-sans text-sm text-fg-secondary leading-relaxed">
        {on
          ? 'A place is a circle on the map; anywhere inside it counts as being there. Your location stays on your phone.'
          : 'Get reminded when you arrive somewhere or leave. Optional: nothing about your location is used until you turn it on.'}
      </Text>

      {on ? (
        <>
          {problems && problems.length > 0 ? <WarningList lines={problems} tone={colors.error} /> : null}

          {places.map((p) => {
            const uses = waiting.filter((t) => t.place?.placeId === p.id).length;
            const overlap = overlapText(overlaps(p, places));
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
                {overlap ? <WarningList lines={[{ text: overlap }]} /> : null}
              </Pressable>
            );
          })}

          <Button variant="quiet" size="sm" icon="plus" onPress={() => router.push('/place')}>
            Add a place
          </Button>
        </>
      ) : null}
    </View>
  );
}
