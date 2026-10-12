import React from 'react';
import { AppState, Platform, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton } from '@/components/ui/Button';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import { Notifications } from '@/lib/notifications';
import {
  allClear,
  allowNotifications,
  answerTest,
  loadTest,
  markTestArrived,
  markTestSeenWhileOpen,
  openSettings,
  reminderHealth,
  sendTestReminder,
  TEST_GRACE_MS,
  TEST_ID,
  testInTray,
  type CheckState,
  type ReminderHealth,
  type TestState,
} from '@/lib/reliability';
import { rearmReminders } from '@/lib/reminders';
import { useEnter } from '@/utils/motion';

/** Makers whose recent-apps screen can lock an app open. */
const LOCKS_IN_RECENTS = new Set(['xiaomi', 'oppo', 'realme', 'oneplus', 'vivo', 'iqoo', 'huawei', 'honor', 'infinix', 'tecno', 'itel']);

interface Step {
  key: string;
  state: CheckState;
  title: string;
  detail: string;
  action?: string;
  onPress?: () => void;
}

function steps(h: ReminderHealth): Step[] {
  const xiaomi = h.maker === 'xiaomi';
  const list: Step[] = [
    {
      key: 'notifications',
      state: h.notifications.state,
      title: 'Notifications allowed',
      detail: 'A reminder is a notification. Without this, none can arrive.',
      action: h.notifications.canAsk ? 'Allow' : 'Open settings',
      onPress: () => allowNotifications(h.notifications.canAsk),
    },
  ];
  if (h.exactAlarms) {
    list.push({
      key: 'exact',
      state: h.exactAlarms,
      title: 'On time, to the minute',
      detail: 'Turn on "Alarms & reminders". Without it, Android can hold a reminder back to save battery.',
      action: 'Allow',
      onPress: openSettings.exactAlarms,
    });
  }
  if (h.battery) {
    list.push({
      key: 'battery',
      state: h.battery,
      title: xiaomi ? 'Battery saver: No restrictions' : 'Battery use: Unrestricted',
      detail: xiaomi
        ? 'Otherwise the phone stops Mnemo soon after you leave it, and reminders wait until you open it again.'
        : "So the phone doesn't stop Mnemo in the background to save battery.",
      action: 'Open',
      onPress: openSettings.battery,
    });
  }
  if (h.autostart) {
    list.push({
      key: 'autostart',
      state: h.autostart,
      title: 'Autostart: on',
      detail: 'So reminders come back after the phone restarts, without opening Mnemo first.',
      action: 'Open',
      onPress: openSettings.autostart,
    });
  }
  if (h.popups) {
    list.push({
      key: 'popups',
      state: h.popups,
      title: 'Pop-up and lock screen',
      detail: xiaomi
        ? 'Turn on "Floating notifications" and "Lock screen notifications", so a reminder shows instead of waiting quietly in the shade.'
        : 'Turn on banners and lock screen notifications, so a reminder shows instead of waiting quietly in the shade.',
      action: 'Open',
      onPress: openSettings.notifications,
    });
  }
  return list;
}

/**
 * "Make sure reminders reach you": what this phone does to reminders, a
 * shortcut to each setting that matters, and a real test reminder to prove
 * it. Phones like Xiaomi's stop apps in the background to save battery, and
 * none of that is visible until a reminder doesn't come.
 */
export default function RemindersCheckScreen() {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const enter = useEnter();
  const { items } = useMnemoStore();
  const [health, setHealth] = React.useState<ReminderHealth | null>(null);
  const [test, setTest] = React.useState<TestState | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const itemsRef = React.useRef(items);
  itemsRef.current = items;

  const refresh = React.useCallback(async () => {
    const [h, t] = await Promise.all([reminderHealth(), loadTest()]);
    // Back from a test that's due: if it's sitting in the tray, it came.
    if (t && !t.arrivedAt && !t.answer && !t.seenOpen && Date.now() >= t.fireAt && (await testInTray())) {
      await markTestArrived();
      setTest(await loadTest());
    } else {
      setTest(t);
    }
    setHealth(h);
    // A setting just changed (exact alarms, say): set every reminder again under it.
    rearmReminders(itemsRef.current);
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      refresh();
    }, [refresh]),
  );

  // Coming back from the phone's settings.
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);

  // The test arriving while this screen is open.
  React.useEffect(() => {
    if (Platform.OS === 'web') return;
    try {
      const sub = Notifications.addNotificationReceivedListener((n) => {
        // Received with Mnemo on screen: shown, but not the real test.
        if (n.request.identifier === TEST_ID) markTestSeenWhileOpen().then(refresh);
      });
      return () => sub.remove();
    } catch {
      return undefined;
    }
  }, [refresh]);

  // A countdown while the test is on its way.
  const waiting = !!test && !test.arrivedAt && !test.answer && !test.seenOpen && now < test.fireAt + TEST_GRACE_MS;
  React.useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [waiting]);

  const send = async () => {
    Haptics.selectionAsync();
    const t = await sendTestReminder();
    setNow(Date.now());
    setTest(t);
  };

  const answer = async (a: 'yes' | 'no') => {
    Haptics.selectionAsync();
    await answerTest(a);
    setTest(await loadTest());
  };

  const list = health ? steps(health) : [];
  const toFix = list.filter((s) => s.state === 'fix').length;
  const secondsLeft = test ? Math.max(0, Math.ceil((test.fireAt - now) / 1000)) : 0;
  const arrived = !!test?.arrivedAt;
  const missed = test?.answer === 'no';
  const seenOpen = !!test?.seenOpen && !arrived;
  const askIfCame = !!test && !arrived && !test.answer && !seenOpen && now >= test.fireAt + TEST_GRACE_MS;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: Math.max(insets.top, 16), paddingBottom: Math.max(insets.bottom, 24) + 32 }}>
        <View className="px-6 flex-row items-center mb-3">
          <IconButton icon="x" label="Close" variant="bare" onPress={() => router.back()} />
        </View>

        <MotiView {...enter.rise(0)} className="px-6 mb-7">
          <Eyebrow>Reminders</Eyebrow>
          <Text className="font-display text-fg leading-tight" style={{ fontSize: 32, letterSpacing: -0.4 }}>
            Make sure they arrive
          </Text>
          <Text className="font-sans text-body leading-relaxed mt-2" style={{ color: colors.fgSecondary }}>
            {health?.strict
              ? `${health.strict} phones save battery by stopping apps in the background. That can hold a reminder back until you open Mnemo, which defeats the point. These settings stop it. It takes a minute.`
              : 'A reminder is a notification set for a time. Here is what lets it arrive on time.'}
          </Text>
        </MotiView>

        {health && !health.available ? (
          <View className="px-6">
            <Text className="font-sans text-body" style={{ color: colors.fgSecondary }}>
              Reminders need the installed app. They can't run in Expo Go or on the web.
            </Text>
          </View>
        ) : health ? (
          <>
            <MotiView {...enter.rise(1)} className="px-6 mb-8">
              <Eyebrow>{toFix > 0 ? `${toFix} to change` : allClear(health) ? 'Looks right' : 'On this phone'}</Eyebrow>
              <View className="rounded-lg overflow-hidden" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
                {list.map((s, i) => (
                  <View
                    key={s.key}
                    className="flex-row px-4 py-4"
                    style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}
                  >
                    <StateMark state={s.state} />
                    <View className="flex-1 ml-3">
                      <Text className="font-sans-semi text-body" style={{ color: colors.fg }}>
                        {s.title}
                      </Text>
                      <Text className="font-sans text-sm leading-relaxed mt-0.5" style={{ color: colors.fgSecondary }}>
                        {s.state === 'check' ? `${s.detail} The phone doesn't say, so check it once.` : s.detail}
                      </Text>
                      {s.state !== 'ok' && s.onPress ? (
                        <View className="flex-row mt-2.5">
                          <Button variant={s.state === 'fix' ? 'tonal' : 'quiet'} size="sm" onPress={s.onPress}>
                            {s.action ?? 'Open'}
                          </Button>
                        </View>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
              {health.strict && LOCKS_IN_RECENTS.has(health.maker) ? (
                <Text className="font-sans text-sm leading-relaxed mt-3" style={{ color: colors.fgTertiary }}>
                  Also: open recent apps, press and hold Mnemo, and tap the lock. Then clearing recent apps won't close it.
                </Text>
              ) : null}
              {!health.readable && Platform.OS === 'android' ? (
                <Text className="font-sans text-sm leading-relaxed mt-3" style={{ color: colors.fgTertiary }}>
                  This version of the app can't read these settings. The test below tells you for sure.
                </Text>
              ) : null}
            </MotiView>

            {/* The proof: a real reminder, with the app closed. */}
            <MotiView {...enter.rise(2)} className="px-6">
              <Eyebrow>Test it</Eyebrow>
              <View className="rounded-lg p-5" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
                {arrived ? (
                  <View className="flex-row items-start">
                    <StateMark state="ok" />
                    <View className="flex-1 ml-3">
                      <Text className="font-sans-semi text-body" style={{ color: colors.fg }}>
                        It arrived. Reminders work on this phone.
                      </Text>
                      <Text className="font-sans text-sm mt-0.5" style={{ color: colors.fgSecondary }}>
                        If one ever doesn't, come back here and test again.
                      </Text>
                    </View>
                  </View>
                ) : waiting ? (
                  <>
                    <Text className="font-sans-semi text-body" style={{ color: colors.fg }}>
                      {secondsLeft > 0 ? `On its way, in ${secondsLeft}s` : 'Any moment now'}
                    </Text>
                    <Text className="font-sans text-sm leading-relaxed mt-1" style={{ color: colors.fgSecondary }}>
                      Now close Mnemo (swipe it away from recent apps) and lock the phone. That's when a strict phone holds reminders back.
                    </Text>
                  </>
                ) : askIfCame ? (
                  <>
                    <Text className="font-sans-semi text-body" style={{ color: colors.fg }}>
                      Did the test reminder arrive?
                    </Text>
                    <Text className="font-sans text-sm mt-1" style={{ color: colors.fgSecondary }}>
                      It was due at {new Date(test!.fireAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.
                    </Text>
                    <View className="flex-row gap-2 mt-3">
                      <Button variant="tonal" size="sm" icon="check" onPress={() => answer('yes')}>
                        Yes, it came
                      </Button>
                      <Button variant="quiet" size="sm" onPress={() => answer('no')}>
                        No
                      </Button>
                    </View>
                  </>
                ) : (
                  <>
                    {missed || seenOpen ? (
                      <Text className="font-sans-semi text-body mb-1" style={{ color: colors.fg }}>
                        {missed ? 'The phone held it back.' : 'It came while Mnemo was open.'}
                      </Text>
                    ) : null}
                    <Text className="font-sans text-sm leading-relaxed" style={{ color: colors.fgSecondary }}>
                      {missed
                        ? 'Change the settings above that say Check or need changing, then test again.'
                        : seenOpen
                          ? "Strict phones only hold reminders back once the app is closed. Try once more, and close Mnemo after you tap."
                          : 'Mnemo sets a reminder for one minute from now. Close the app and lock the phone, and see if it arrives.'}
                    </Text>
                    <View className="flex-row mt-3">
                      <Button
                        variant="primary"
                        size="md"
                        icon="clock"
                        onPress={send}
                        disabled={health.notifications.state !== 'ok'}
                      >
                        {missed || seenOpen ? 'Test again' : 'Send a test reminder'}
                      </Button>
                    </View>
                    {health.notifications.state !== 'ok' ? (
                      <Text className="font-sans text-sm mt-2" style={{ color: colors.fgTertiary }}>
                        Allow notifications first.
                      </Text>
                    ) : null}
                  </>
                )}
              </View>
            </MotiView>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function StateMark({ state }: { state: CheckState }) {
  const colors = useThemeColors();
  const bg = state === 'ok' ? colors.accentSoft : state === 'fix' ? colors.errorSoft : colors.surfaceHigh;
  return (
    <View
      className="w-7 h-7 rounded-full items-center justify-center mt-0.5"
      style={{ backgroundColor: bg }}
      accessibilityLabel={state === 'ok' ? 'Set' : state === 'fix' ? 'Needs changing' : 'Check this'}
    >
      {state === 'ok' ? (
        <Icon name="check" size={15} stroke={2.4} color={colors.accent} />
      ) : (
        <Text className="font-sans-semi text-sm" style={{ color: state === 'fix' ? colors.error : colors.fgSecondary }}>
          {state === 'fix' ? '!' : '?'}
        </Text>
      )}
    </View>
  );
}
