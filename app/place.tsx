import React from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { haptic } from '@/utils/haptics';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MapPicker } from '@/components/map/MapPicker';
import { WarningList } from '@/components/PlaceWarnings';
import { Button, IconButton } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { Text } from '@/components/ui/Text';
import { TextInput } from '@/components/ui/TextInput';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import { locateHere } from '@/lib/geofence';
import { removePlace, savePlace, usePlaces } from '@/lib/place-store';
import {
  circleChanged,
  fixText,
  formatMeters,
  isArmed,
  nameProblem,
  overlaps,
  overlapText,
  RADIUS_CHOICES,
  watchedRadius,
} from '@/lib/places';
import { confirmAction } from '@/utils/confirm';
import { noFocusRing } from '@/utils/web';
import type { Place } from '@/types/mnemo';

/** Where a new map starts with no position to go on: the whole world. */
const WORLD = { lat: 20, lng: 0, zoom: 2 };
const STREET_ZOOM = 16;
/** Zoomed out further than this, a dropped pin could be anywhere in a neighbourhood. */
const PIN_ZOOM = 15;

/**
 * Add or change a place: drag the map under the pin (or "Center on me"),
 * name it, pick its size. The circle on the map is exactly what counts as
 * being there, and other saved places are drawn too, so an overlap is
 * visible before it's a problem.
 */
export default function PlaceScreen() {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const places = usePlaces();
  const existing = places.find((p) => p.id === id);
  const { items, updateItem } = useMnemoStore();

  const [name, setName] = React.useState(existing?.name ?? '');
  const [radius, setRadius] = React.useState(existing?.radius ?? RADIUS_CHOICES[0]);
  // The pin: where the map is centred. `accuracy` is 0 for a dropped pin
  // (it's exactly where they put it), or the fix's when it came from GPS.
  const [pin, setPin] = React.useState<{ lat: number; lng: number; accuracy: number; zoom: number } | null>(
    existing ? { lat: existing.latitude, lng: existing.longitude, accuracy: existing.accuracy, zoom: STREET_ZOOM } : null,
  );
  const [start, setStart] = React.useState(existing ? { lat: existing.latitude, lng: existing.longitude, zoom: STREET_ZOOM } : null);
  const [goTo, setGoTo] = React.useState<{ lat: number; lng: number; zoom?: number } | undefined>();
  const [locating, setLocating] = React.useState(false);
  const [locateError, setLocateError] = React.useState<string | null>(null);
  const [offline, setOffline] = React.useState(false);
  const [tried, setTried] = React.useState(false);

  // A new place starts where the phone last was, if it may say; else the world.
  React.useEffect(() => {
    if (start) return;
    let live = true;
    (async () => {
      try {
        if ((await Location.getForegroundPermissionsAsync()).granted) {
          const p = await Location.getLastKnownPositionAsync({ maxAge: 30 * 60 * 1000 });
          if (p && live) {
            setStart({ lat: p.coords.latitude, lng: p.coords.longitude, zoom: STREET_ZOOM });
            return;
          }
        }
      } catch {
        // Fall through to the world.
      }
      if (live) setStart(WORLD);
    })();
    return () => {
      live = false;
    };
  }, [start]);

  const centerOnMe = async () => {
    setLocating(true);
    setLocateError(null);
    try {
      const fix = await locateHere();
      setPin({ lat: fix.latitude, lng: fix.longitude, accuracy: fix.accuracy, zoom: STREET_ZOOM });
      setGoTo({ lat: fix.latitude, lng: fix.longitude, zoom: STREET_ZOOM });
    } catch (e) {
      setLocateError(e instanceof Error ? e.message : "Couldn't find where you are.");
    } finally {
      setLocating(false);
    }
  };

  const draft: Place | null = pin
    ? { id: existing?.id ?? 'draft', name: name.trim() || 'This place', latitude: pin.lat, longitude: pin.lng, radius, accuracy: pin.accuracy, savedAt: existing?.savedAt ?? Date.now() }
    : null;
  const others = places.filter((p) => p.id !== existing?.id);
  const overlapping = draft ? overlaps(draft, places) : [];
  const problem = nameProblem(name, places, existing?.id);
  // Saved from GPS, the fix decides; dropped by hand, it needs a close-enough view.
  const zoomedOut = !pin || (pin.accuracy === 0 && pin.zoom < PIN_ZOOM);

  const save = async () => {
    setTried(true);
    if (!draft || problem) return;
    const place: Place = { ...draft, id: existing?.id ?? `place-${Date.now().toString(36)}`, name: name.trim().slice(0, 40) };
    await savePlace(place);
    // Moved or resized: its reminders read where the phone is all over again.
    if (existing && circleChanged(existing, place)) {
      for (const t of items) {
        if (isArmed(t) && t.place.placeId === place.id) updateItem(t.id, { place: { ...t.place, insideAtSet: undefined, setAt: Date.now() } }, { touch: false });
      }
    }
    haptic.success();
    router.back();
  };

  const remove = () => {
    if (!existing) return;
    const using = items.filter((t) => isArmed(t) && t.place.placeId === existing.id);
    confirmAction({
      title: `Remove ${existing.name}?`,
      message: using.length
        ? `${using.length === 1 ? 'A reminder is' : `${using.length} reminders are`} waiting for ${existing.name}. ${using.length === 1 ? 'It goes' : 'They go'} too.`
        : 'Reminders can no longer use it.',
      confirmLabel: 'Remove',
      onConfirm: () => {
        for (const t of using) updateItem(t.id, { place: undefined });
        removePlace(existing.id);
        router.back();
      },
    });
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* The map, with the pin fixed in the middle: the map moves under it. */}
      <View style={{ height: '48%', minHeight: 260 }}>
        {offline ? (
          <View className="flex-1 items-center justify-center px-8" style={{ backgroundColor: colors.surface }}>
            <Icon name="mapPin" size={22} color={colors.fgTertiary} />
            <Text className="font-sans text-sm text-center leading-relaxed mt-2" style={{ color: colors.fgSecondary }}>
              The map needs a connection. You can still use where you are now.
            </Text>
          </View>
        ) : start ? (
          <>
            <MapPicker
              initial={start}
              radius={draft ? watchedRadius(draft) : radius}
              others={others.map((p) => ({ name: p.name, lat: p.latitude, lng: p.longitude, radius: watchedRadius(p) }))}
              goTo={goTo}
              colors={{ accent: colors.accent, other: colors.fgTertiary, bg: colors.surface }}
              onCenter={(lat, lng, zoom, byUser) =>
                // Dragged by hand, it's exactly where they put it; moved by "Center on me", it's the fix.
                setPin((prev) => ({ lat, lng, zoom, accuracy: byUser || !prev ? 0 : prev.accuracy }))
              }
              onOffline={() => setOffline(true)}
            />
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
              {/* Lifted by its own height so the tip, not the middle, marks the spot. */}
              <View style={{ marginTop: -34 }}>
                <Icon name="mapPin" size={34} color={colors.accent} stroke={2.4} />
              </View>
            </View>
          </>
        ) : (
          <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.surface }}>
            <ActivityIndicator color={colors.accent} />
          </View>
        )}
        <View style={{ position: 'absolute', top: Math.max(insets.top, 12), left: 16 }}>
          <IconButton icon="x" label="Close" variant="default" onPress={() => router.back()} />
        </View>
        <View style={{ position: 'absolute', bottom: 12, right: 16 }}>
          <Button variant="tonal" size="sm" icon="locate" onPress={centerOnMe} disabled={locating}>
            {locating ? 'Finding you…' : 'Center on me'}
          </Button>
        </View>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, paddingBottom: Math.max(insets.bottom, 16) + 24, gap: 16 }}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name this place"
          placeholderTextColor={colors.fgTertiary}
          selectionColor={colors.accent}
          className="font-display text-fg pb-2"
          style={[{ fontSize: 26, borderBottomWidth: 1, borderBottomColor: tried && problem ? colors.error : colors.border }, noFocusRing]}
        />
        {tried && problem ? (
          <Text className="font-sans text-sm -mt-2" style={{ color: colors.error }}>
            {problem}
          </Text>
        ) : null}

        <View className="flex-row flex-wrap gap-2">
          {RADIUS_CHOICES.map((r) => (
            <Pill key={r} tone={colors.accent} size="md" dot={false} outline={radius !== r} selected={radius === r} onPress={() => setRadius(r)}>
              {formatMeters(r)} circle
            </Pill>
          ))}
        </View>

        <Text className="font-sans text-sm leading-relaxed" style={{ color: colors.fgSecondary }}>
          {!pin
            ? offline
              ? 'Tap “Center on me” to use where you are now.'
              : 'Drag the map until the pin is on the place, or center it on where you are.'
            : zoomedOut
              ? 'Zoom in to put the pin on the place itself.'
              : 'Anywhere inside the circle counts as being there.'}
        </Text>

        <WarningList
          lines={[
            ...(locateError ? [{ text: locateError }] : []),
            ...(pin && fixText(pin.accuracy) ? [{ text: fixText(pin.accuracy)! }] : []),
            ...(overlapText(overlapping) ? [{ text: overlapText(overlapping)! }] : []),
          ]}
          tone={overlapping.length > 0 || locateError ? colors.error : undefined}
        />

        <Button variant="primary" size="lg" icon="check" onPress={save} disabled={!pin || zoomedOut}>
          {existing ? 'Save changes' : 'Save place'}
        </Button>
        {existing ? (
          <Pressable onPress={remove} accessibilityRole="button" className="self-center py-2 active:opacity-70">
            <Text className="font-sans-semi text-sm" style={{ color: colors.error }}>
              Remove this place
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
