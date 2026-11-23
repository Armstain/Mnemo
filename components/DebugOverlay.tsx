import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { Text } from '@/components/ui/Text';
import { useRunningClock, useTrace } from '@/hooks/use-trace';
import { setPreferences, usePreferences } from '@/lib/preferences';
import { took, type TraceLevel } from '@/lib/trace';

// Live debug's floating overlay: one line over every screen saying what Mnemo is doing right
// now (a note being sent to Gemini, with a running clock), or what it just did. Tap to see the
// last few steps. Turned on from Live debug (app/debug.tsx); a debugging aid, so it's always dark.

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
/** The last step stays on the line this long, then it settles to "idle". */
const RECENT_MS = 8000;
const SHOWN = 12;

const HUD = {
  bg: 'rgba(18, 19, 16, 0.94)',
  border: 'rgba(255, 255, 255, 0.12)',
  fg: '#ECE9E0',
  dim: '#9A978D',
};
export const LEVEL_COLOR: Record<TraceLevel | 'busy', string> = {
  info: '#9AA9E8',
  ok: '#5DDBA0',
  warn: '#D7B263',
  error: '#FF9D92',
  busy: '#77C3C9',
};

function Dot({ color }: { color: string }) {
  return <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color, marginTop: 4 }} />;
}

export function DebugOverlay() {
  const { debugOverlay } = usePreferences();
  if (!debugOverlay || Platform.OS === 'web') return null;
  return <Overlay />;
}

function Overlay() {
  const insets = useSafeAreaInsets();
  const { events, active } = useTrace();
  const [open, setOpen] = useState(false);
  const last = events[events.length - 1];
  const now = useRunningClock(active.length > 0, 250);
  // The last step stays on the line for a while, then the line settles to "idle".
  const [settledId, setSettledId] = useState<number | null>(null);
  useEffect(() => {
    if (!last) return;
    const timer = setTimeout(() => setSettledId(last.id), Math.max(0, last.at + RECENT_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [last]);
  const current = active[active.length - 1];
  const recent = last && settledId !== last.id ? last : undefined;

  const line = current
    ? { color: LEVEL_COLOR.busy, text: `${current.topic} ${current.text} · ${took(now - current.since)}${active.length > 1 ? `  +${active.length - 1}` : ''}` }
    : recent
      ? { color: LEVEL_COLOR[recent.level], text: `${recent.topic} ${recent.text}${recent.ms !== undefined ? ` (${took(recent.ms)})` : ''}` }
      : { color: HUD.dim, text: 'idle' };

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 4, left: 8, right: 8, zIndex: 9999, elevation: 9999 }}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={`Live debug: ${line.text}. ${open ? 'Close' : 'Show the last steps'}.`}
        style={{ backgroundColor: HUD.bg, borderColor: HUD.border, borderWidth: 1, borderRadius: open ? 16 : 999, paddingHorizontal: 12, paddingVertical: 7 }}
      >
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Dot color={line.color} />
          <Text numberOfLines={open ? 3 : 1} style={{ flex: 1, color: HUD.fg, fontSize: 11, lineHeight: 15, fontFamily: MONO }}>
            {line.text}
          </Text>
        </View>

        {open ? (
          <View style={{ marginTop: 8, gap: 6 }}>
            {active.length > 1
              ? active.slice(0, -1).map((a) => (
                  <View key={a.id} style={{ flexDirection: 'row', gap: 8 }}>
                    <Dot color={LEVEL_COLOR.busy} />
                    <Text style={{ flex: 1, color: HUD.fg, fontSize: 11, lineHeight: 15, fontFamily: MONO }}>
                      {a.topic} {a.text} · {took(now - a.since)}
                    </Text>
                  </View>
                ))
              : null}
            <ScrollView style={{ maxHeight: 260 }}>
              {events
                .slice(-SHOWN)
                .reverse()
                .map((e) => (
                  <View key={e.id} style={{ flexDirection: 'row', gap: 8, marginBottom: 5 }}>
                    <Dot color={LEVEL_COLOR[e.level]} />
                    <Text style={{ flex: 1, color: HUD.fg, fontSize: 11, lineHeight: 15, fontFamily: MONO }}>
                      <Text style={{ color: HUD.dim }}>{new Date(e.at).toLocaleTimeString([], { hour12: false })} </Text>
                      {e.topic} {e.text}
                      {e.ms !== undefined ? <Text style={{ color: HUD.dim }}> ({took(e.ms)})</Text> : null}
                    </Text>
                  </View>
                ))}
              {events.length === 0 ? <Text style={{ color: HUD.dim, fontSize: 11, fontFamily: MONO }}>Nothing yet. Take a note.</Text> : null}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
              <Pressable
                onPress={() => {
                  setOpen(false);
                  router.push('/debug');
                }}
                accessibilityRole="button"
                style={{ flex: 1, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' }}
              >
                <Text style={{ color: HUD.fg, fontSize: 12, fontWeight: '600' }}>Open Live debug</Text>
              </Pressable>
              <Pressable
                onPress={() => setPreferences({ debugOverlay: false })}
                accessibilityRole="button"
                style={{ flex: 1, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' }}
              >
                <Text style={{ color: HUD.fg, fontSize: 12, fontWeight: '600' }}>Hide overlay</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}
