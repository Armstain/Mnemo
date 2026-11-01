import React from 'react';
import { ActivityIndicator, AppState, Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { Text } from '@/components/ui/Text';
import { TextInput } from '@/components/ui/TextInput';
import { usePlaceProblems, WarningList } from '@/components/PlaceWarnings';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import { locateHere, type Fix } from '@/lib/geofence';
import { removePlace, savePlace, usePlaces } from '@/lib/place-store';
import { fixQuality, fixText, formatMeters, isArmed, nearbyPlaces, nearbyText, RADIUS_CHOICES, watchedRadius } from '@/lib/places';
import { confirmAction } from '@/utils/confirm';
import { noFocusRing } from '@/utils/web';
import type { Place } from '@/types/mnemo';

type Adding = { step: 'locating' } | { step: 'naming'; fix: Fix } | { step: 'failed'; message: string };

/**
 * Settings → Places: save where you are as "Home" or "Market", see how sure
 * the phone was, and be told plainly when two places are too close for it
 * to tell apart. Also what the phone needs for place reminders to go off.
 */
export function PlacesCard() {
  const colors = useThemeColors();
  const places = usePlaces();
  const { items, updateItem } = useMnemoStore();
  const [adding, setAdding] = React.useState<Adding | null>(null);
  const [name, setName] = React.useState('');
  const [radius, setRadius] = React.useState(RADIUS_CHOICES[0]);
  // Rechecked on return from the phone's settings.
  const [returns, setReturns] = React.useState(0);
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && setReturns((n) => n + 1));
    return () => sub.remove();
  }, []);
  const problems = usePlaceProblems(returns);
  const waiting = items.filter(isArmed);

  const start = async () => {
    setAdding({ step: 'locating' });
    try {
      const fix = await locateHere();
      setAdding({ step: 'naming', fix });
    } catch (e) {
      setAdding({ step: 'failed', message: e instanceof Error ? e.message : "Couldn't find where you are." });
    }
  };

  const draft: Place | null =
    adding?.step === 'naming'
      ? { id: 'draft', name: name.trim() || 'This place', ...adding.fix, radius, savedAt: Date.now() }
      : null;

  const save = async () => {
    if (!draft || !name.trim()) return;
    await savePlace({ ...draft, id: `place-${Date.now().toString(36)}`, name: name.trim().slice(0, 40) });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setAdding(null);
    setName('');
    setRadius(RADIUS_CHOICES[0]);
  };

  const remove = (p: Place) => {
    const using = waiting.filter((t) => t.place?.placeId === p.id);
    confirmAction({
      title: `Remove ${p.name}?`,
      message: using.length
        ? `${using.length === 1 ? 'One reminder waits' : `${using.length} reminders wait`} for ${p.name}. ${using.length === 1 ? 'It' : 'They'} will be removed too.`
        : 'Reminders can no longer use it.',
      confirmLabel: 'Remove',
      onConfirm: () => {
        for (const t of using) updateItem(t.id, { place: undefined });
        removePlace(p.id);
      },
    });
  };

  return (
    <View className="bg-surface rounded-lg p-5 border border-border/50 gap-4">
      <View className="flex-row items-center">
        <Icon name="mapPin" size={15} color={colors.accent} stroke={2} />
        <Text className="font-sans-semi text-sm text-fg ml-2">Saved places</Text>
      </View>
      <Text className="font-sans text-sm text-fg-secondary leading-relaxed">
        Save places like Home or the market, then say “remind me when I get to the market”. Your phone only knows roughly
        where it is, so Mnemo tells you when two places are too close to tell apart instead of guessing.
      </Text>

      {/* What place reminders need, only once someone has places to use. */}
      {places.length > 0 && problems && problems.length > 0 ? <WarningList lines={problems} tone={colors.error} /> : null}

      {places.map((p) => {
        const near = nearbyPlaces(p, places);
        const uses = waiting.filter((t) => t.place?.placeId === p.id).length;
        return (
          <View key={p.id} className="pt-4 border-t border-border/50 gap-2">
            <View className="flex-row items-center" style={{ gap: 10 }}>
              <View className="flex-1">
                <Text className="font-sans-semi text-body" style={{ color: colors.fg }}>
                  {p.name}
                </Text>
                <Text className="font-sans text-sm mt-0.5" style={{ color: colors.fgTertiary }}>
                  {formatMeters(watchedRadius(p))} circle · saved within {formatMeters(p.accuracy)}
                  {uses ? ` · ${uses} waiting` : ''}
                </Text>
              </View>
              <Pressable onPress={() => remove(p)} accessibilityRole="button" accessibilityLabel={`Remove ${p.name}`} hitSlop={8} className="p-2 active:opacity-70">
                <Icon name="trash" size={17} color={colors.fgTertiary} />
              </Pressable>
            </View>
            <WarningList lines={near.map((n) => ({ text: nearbyText(p.name, n) }))} tone={near.some((n) => n.verdict === 'overlap') ? colors.error : undefined} />
          </View>
        );
      })}

      {adding?.step === 'naming' && draft ? (
        <View className="pt-4 border-t border-border/50 gap-3">
          <TextInput
            value={name}
            onChangeText={setName}
            autoFocus
            placeholder="Name it: Home, Market, Office…"
            placeholderTextColor={colors.fgTertiary}
            selectionColor={colors.accent}
            className="font-sans text-body text-fg pb-2"
            style={[{ borderBottomWidth: 1, borderBottomColor: colors.border }, noFocusRing]}
          />
          <View className="flex-row flex-wrap gap-2">
            {RADIUS_CHOICES.map((r) => (
              <Pill key={r} tone={colors.accent} size="md" dot={false} outline={radius !== r} selected={radius === r} onPress={() => setRadius(r)}>
                {formatMeters(r)}
              </Pill>
            ))}
          </View>
          <Text className="font-sans text-sm" style={{ color: colors.fgTertiary }}>
            Located within {formatMeters(adding.fix.accuracy)}. Watched as a {formatMeters(watchedRadius(draft))} circle.
          </Text>
          <WarningList
            lines={[
              ...(fixQuality(adding.fix.accuracy) === 'poor' ? [{ text: fixText(adding.fix.accuracy)!, action: 'Retry', fix: start }] : []),
              ...nearbyPlaces(draft, places).map((n) => ({ text: nearbyText(draft.name, n) })),
            ]}
            tone={nearbyPlaces(draft, places).some((n) => n.verdict === 'overlap') ? colors.error : undefined}
          />
          <View className="flex-row gap-2">
            <Button variant="quiet" size="sm" className="flex-1" onPress={() => setAdding(null)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" className="flex-1" onPress={save} disabled={!name.trim()}>
              Save place
            </Button>
          </View>
        </View>
      ) : adding?.step === 'locating' ? (
        <View className="flex-row items-center pt-4 border-t border-border/50" style={{ gap: 10 }}>
          <ActivityIndicator color={colors.accent} />
          <Text className="font-sans text-sm" style={{ color: colors.fgSecondary }}>
            Finding where you are…
          </Text>
        </View>
      ) : (
        <View className="gap-2">
          {adding?.step === 'failed' ? <WarningList lines={[{ text: adding.message }]} tone={colors.error} /> : null}
          <Button variant="quiet" size="sm" icon="locate" onPress={start}>
            Save where I am
          </Button>
        </View>
      )}
    </View>
  );
}
