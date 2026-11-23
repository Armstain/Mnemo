import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Location from 'expo-location';
import Constants from 'expo-constants';

import { Button, IconButton } from '@/components/ui/Button';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Text } from '@/components/ui/Text';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors, useThemeName } from '@/hooks/use-theme';
import { aiEnabled } from '@/lib/ai-mode';
import { isStructuring, retryEntryNow, retryWaitingNow, waitingProblem } from '@/lib/capture';
import { timeline, type DebugSource } from '@/lib/debug';
import { clearErrors, problemReport, readErrors } from '@/lib/errors';
import { geofenceOutcome } from '@/lib/geofence';
import { outcomeLine, outcomeProblem } from '@/lib/geofence-outcome';
import { clearPlaceLog, readPlaceLog, reminderLines, shortId, stamp } from '@/lib/place-log';
import { usePlaces } from '@/lib/place-store';
import { distance, formatMeters, isArmed, onFix, watchedRadius } from '@/lib/places';
import { setPreferences, usePreferences } from '@/lib/preferences';
import { clearVoiceLog, readVoiceLog } from '@/lib/voice-log';
import { haptic } from '@/lib/haptics';
import { LEVEL_COLOR } from '@/components/DebugOverlay';
import { useRunningClock, useTrace } from '@/hooks/use-trace';
import { clearTrace, took } from '@/lib/trace';

const LIVE_SHOWN = 60;

/** What Mnemo is doing right now and just did: the live trace (lib/trace.ts), newest first. */
function LiveFeed() {
  const colors = useThemeColors();
  const { debugOverlay } = usePreferences();
  const { events, active } = useTrace();
  const now = useRunningClock(active.length > 0, 200);
  return (
    <View className="mb-6">
      <View className="flex-row items-center justify-between mb-2">
        <Eyebrow>Live: what's happening now</Eyebrow>
        <Pressable onPress={clearTrace} accessibilityRole="button" hitSlop={8} className="h-9 justify-center active:opacity-70">
          <Text className="font-sans-semi text-sm" style={{ color: colors.accent }}>
            Clear
          </Text>
        </Pressable>
      </View>
      <View className="flex-row items-center bg-surface rounded-lg px-4 py-2.5 border border-border/50 mb-2">
        <Text className="font-sans-medium text-sm text-fg flex-1">Floating overlay on every screen</Text>
        <Switch
          value={!!debugOverlay}
          onValueChange={(v) => setPreferences({ debugOverlay: v })}
          trackColor={{ true: colors.accent, false: colors.surfaceHigh }}
          accessibilityLabel="Floating overlay on every screen"
        />
      </View>
      <View className="bg-surface rounded-lg px-4 py-3 border border-border/50 gap-1.5">
        {active.map((a) => (
          <Line key={a.id} tone={LEVEL_COLOR.busy}>
            ▶ {a.topic} {a.text} · {took(now - a.since)}
          </Line>
        ))}
        {events.length === 0 && active.length === 0 ? <Line>Nothing yet. Take a note and watch it here.</Line> : null}
        {events
          .slice(-LIVE_SHOWN)
          .reverse()
          .map((e) => (
            <Line key={e.id}>
              <Text style={{ color: LEVEL_COLOR[e.level], fontWeight: '600' }}>●</Text> {stamp(e.at).slice(11, 19)} {e.topic} {e.text}
              {e.ms !== undefined ? ` (${took(e.ms)})` : ''}
            </Line>
          ))}
      </View>
      <Text className="font-sans text-xs mt-1.5" style={{ color: colors.fgTertiary }}>
        Kept only while the app is open, and never in the problem report.
      </Text>
    </View>
  );
}

// Live debug: hidden (Settings → About, tap the version 7 times). What the problem report says,
// but live: the logs as they're written, notes waiting for Gemini, and where the phone is against
// each watched place, so a place reminder or a voice note can be watched while it happens.

const REFRESH_MS = 2000;
const FILTERS: { key: DebugSource | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'place', label: 'Places' },
  { key: 'voice', label: 'Voice' },
  { key: 'error', label: 'Errors' },
];

type Logs = Parameters<typeof timeline>[0];
type Here = { latitude: number; longitude: number; accuracy: number; at: number };

/** The logs, read again every couple of seconds while the screen is open. */
function useLogs(): [Logs, () => void] {
  const [logs, setLogs] = useState<Logs>({ place: [], voice: [], errors: [] });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const read = async () => {
      const [place, voice, errors] = await Promise.all([readPlaceLog(), readVoiceLog(), readErrors()]);
      if (alive) setLogs({ place, voice, errors });
    };
    read();
    const timer = setInterval(read, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [tick]);
  return [logs, () => setTick((t) => t + 1)];
}

/** The phone's position while the screen is open (only with location already allowed: never asks). */
function useHere(): Here | null {
  const [here, setHere] = useState<Here | null>(null);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let sub: Location.LocationSubscription | null = null;
    let alive = true;
    (async () => {
      const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (!perm?.granted || !alive) return;
      sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 5000 }, (p) =>
        setHere({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: Math.round(p.coords.accuracy ?? 999), at: p.timestamp }),
      );
      if (!alive) sub.remove();
    })().catch(() => {});
    return () => {
      alive = false;
      sub?.remove();
    };
  }, []);
  return here;
}

/** Re-renders every couple of seconds: back-offs and "in flight" aren't in the store. */
function useTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), REFRESH_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mb-6">
      <Eyebrow className="mb-2">{title}</Eyebrow>
      <View className="bg-surface rounded-lg px-4 py-3 border border-border/50 gap-1.5">{children}</View>
    </View>
  );
}

/** One monospaced line: the logs are for reading closely, and for screenshots. */
function Line({ children, tone }: { children: React.ReactNode; tone?: string }) {
  const colors = useThemeColors();
  return (
    <Text selectable className="text-xs leading-snug" style={{ color: tone ?? colors.fgSecondary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
      {children}
    </Text>
  );
}

export default function DebugScreen() {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const theme = useThemeName();
  const store = useMnemoStore();
  const { items, entries } = store;
  const savedPlaces = usePlaces();
  const prefs = usePreferences();
  const [logs, reread] = useLogs();
  const here = useHere();
  const now = useTick();
  const [filter, setFilter] = useState<DebugSource | 'all'>('all');
  const [note, setNote] = useState('');

  const outcome = geofenceOutcome();
  const waiting = entries.filter((e) => e.pending);
  const stuckThreads = items.filter((i) => i.pending && !waiting.some((e) => e.threadId === i.id));
  const armed = items.filter(isArmed);
  const lines = timeline(logs, filter === 'all' ? undefined : filter);
  const toneOf = (source: DebugSource) => (source === 'error' ? colors.error : source === 'voice' ? colors.accentWarm : colors.accent);

  const say = (text: string) => {
    setNote(text);
    setTimeout(() => setNote(''), 2500);
  };

  const retryAll = async () => {
    haptic.select();
    retryWaitingNow();
    let failed = 0;
    for (const entry of waiting) {
      try {
        await retryEntryNow(entry, store);
      } catch {
        failed += 1;
      }
    }
    say(failed ? `${failed} of ${waiting.length} still failing (see Errors / Voice)` : 'Sent');
    reread();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View className="flex-row items-center px-4" style={{ paddingTop: Math.max(insets.top, 16), paddingBottom: 8 }}>
        <IconButton icon="chevronLeft" label="Back" variant="bare" onPress={() => router.back()} />
        <Text className="font-display text-title text-fg ml-1 flex-1">Live debug</Text>
        {note ? (
          <Text className="font-sans-medium text-sm" style={{ color: colors.accent }}>
            {note}
          </Text>
        ) : null}
      </View>

      <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 24) + 24 }}>
        <LiveFeed />

        <Section title="This phone">
          <Line>
            Mnemo {Constants.expoConfig?.version ?? '?'} · {Platform.OS} {String(Platform.Version)}
          </Line>
          <Line>
            Notes: {aiEnabled() ? 'Gemini' : 'offline'} · voice {aiEnabled() ? 'recorded' : `heard by phone (${prefs.speechLang})`} · places{' '}
            {prefs.places ? 'on' : 'off'}
          </Line>
          <Line>Now: {stamp(now)}</Line>
        </Section>

        <Section title={`Waiting for Gemini (${waiting.length})`}>
          {waiting.length === 0 ? <Line>Nothing waiting.</Line> : null}
          {waiting.map((e) => {
            const problem = waitingProblem(e.id);
            return (
              <Line key={e.id} tone={problem ? colors.error : undefined}>
                e:{shortId(e.id)} in t:{shortId(e.threadId)} · {e.source} · {e.pendingAudioUri ? 'recording' : 'text'} · since {stamp(e.createdAt)}
                {isStructuring(e.id) ? ' · SENDING NOW' : ''}
                {problem ? ` · ${problem.tries} tries: ${problem.text}` : ''}
              </Line>
            );
          })}
          {stuckThreads.map((t) => (
            <Line key={t.id} tone={colors.error}>
              t:{shortId(t.id)} says “Being read…” with nothing waiting (released on the next sweep)
            </Line>
          ))}
          {waiting.length > 0 ? (
            <View className="mt-2">
              <Button variant="tonal" size="sm" icon="repeat" onPress={retryAll}>
                Send all now
              </Button>
            </View>
          ) : null}
        </Section>

        <Section title="Places">
          <Line tone={outcomeProblem(outcome) ? colors.error : undefined}>
            Android: {outcomeLine(outcome) ?? outcomeProblem(outcome)?.text ?? (outcome ? `${outcome.state}${outcome.count !== undefined ? ` · ${outcome.count} places` : ''}` : 'no answer recorded')}
          </Line>
          <Line>
            Here:{' '}
            {here
              ? `±${here.accuracy} m · ${Math.round((now - here.at) / 1000)} s ago`
              : prefs.places
                ? 'waiting for a position (location allowed?)'
                : 'place reminders are off'}
          </Line>
          {armed.map((t) => {
            const r = t.place!;
            const place = savedPlaces.find((p) => p.id === r.placeId);
            const where = place && here ? onFix(r, place, here) : null;
            const away = place && here ? distance(place, here) : null;
            return (
              <Line key={t.id} tone={where === 'fire' ? colors.accent : undefined}>
                r:{shortId(t.id)} {r.on} {place?.name ?? 'missing place'} ({place ? formatMeters(watchedRadius(place)) : '?'}) · counted{' '}
                {r.insideAtSet === undefined ? 'unknown' : r.insideAtSet ? 'inside' : 'outside'}
                {away !== null ? ` · ${formatMeters(away)} from centre` : ''}
                {where === 'fire' ? ' · WOULD RING NOW' : where ? ` · fix says ${where}` : here ? ' · fix too rough to say' : ''}
              </Line>
            );
          })}
          {armed.length === 0 ? <Line>No place reminder set.</Line> : null}
          {reminderLines(items)
            .filter((l) => !armed.some((t) => l.startsWith(`r:${shortId(t.id)} `)))
            .map((l) => (
              <Line key={l}>{l}</Line>
            ))}
        </Section>

        <Eyebrow className="mb-2">Log, newest first</Eyebrow>
        <View className="flex-row gap-2 mb-3">
          {FILTERS.map((f) => {
            const on = filter === f.key;
            return (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                className="rounded-full px-3.5 h-9 items-center justify-center active:opacity-70"
                style={{ backgroundColor: on ? colors.accent : colors.surface, borderWidth: 1, borderColor: on ? colors.accent : colors.border }}
              >
                <Text className="font-sans-semi text-sm" style={{ color: on ? colors.accentInk : colors.fg }}>
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View className="bg-surface rounded-lg px-4 py-3 border border-border/50 gap-2 mb-6">
          {lines.length === 0 ? <Line>Nothing logged yet.</Line> : null}
          {lines.map((l, i) => (
            <Line key={`${l.at}:${i}`}>
              <Text style={{ color: toneOf(l.source), fontWeight: '600' }}>{l.source.padEnd(5)}</Text> {stamp(l.at).slice(11, 19)} {l.text}
            </Line>
          ))}
        </View>

        <View className="gap-3">
          <Button
            variant="quiet"
            icon="copy"
            onPress={async () => {
              await Clipboard.setStringAsync(await problemReport());
              haptic.success();
              say('Report copied');
            }}
          >
            Copy problem report
          </Button>
          <Button
            variant="quiet"
            icon="trash"
            onPress={async () => {
              await Promise.all([clearPlaceLog(), clearVoiceLog(), clearErrors()]);
              haptic.success();
              say('Logs cleared');
              reread();
            }}
          >
            Clear all logs
          </Button>
          <Button
            variant="ghost"
            icon="x"
            onPress={() => {
              setPreferences({ debugTools: false });
              router.back();
            }}
          >
            Hide Live debug
          </Button>
        </View>
      </ScrollView>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
    </View>
  );
}
