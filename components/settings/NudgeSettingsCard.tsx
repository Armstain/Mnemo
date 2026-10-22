import { View, Pressable, Platform, Switch, Linking } from 'react-native';
import { Text } from '@/components/ui/Text';
import { router } from 'expo-router';
import { Bell } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Button } from '@/components/ui/Button';
import { Pill } from '@/components/ui/Pill';
import { Icon } from '@/components/ui/Icon';
import { useThemeColors } from '@/hooks/use-theme';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import {
  NUDGE_TIMES,
  hasNudgePermission,
  loadNudgePrefs,
  requestNudgePermission,
  saveNudgePrefs,
  scheduleNudges,
  sendTestNudge,
  type NudgePrefs,
  type NudgeTime,
} from '@/lib/nudges';
import { reviewTimeLabel, scheduleWeeklyReview } from '@/lib/review-notice';
import { loadSetup, strictPhone } from '@/lib/reliability';

const NUDGE_TIME_KEYS = Object.keys(NUDGE_TIMES) as NudgeTime[];

export function NudgeSettingsCard() {
  const colors = useThemeColors();
  const { items, entries } = useMnemoStore();
  const [prefs, setPrefs] = useState<NudgePrefs | null>(null);
  const [granted, setGranted] = useState(false);
  // Set once a turn-on attempt comes back refused — at that point only
  // the OS Settings app can change it, so say so instead of silently
  // leaving the switch off.
  const [blocked, setBlocked] = useState(false);
  const [verified, setVerified] = useState(false);
  const strict = strictPhone();
  const [pickingTime, setPickingTime] = useState(false);
  const [testSent, setTestSent] = useState(false);

  useEffect(() => {
    loadNudgePrefs().then(setPrefs);
    hasNudgePermission().then(setGranted);
    loadSetup().then((s) => setVerified(!!s.verifiedAt));
  }, []);

  const apply = async (next: NudgePrefs) => {
    setPrefs(next);
    await saveNudgePrefs(next);
    scheduleNudges(items);
    scheduleWeeklyReview(items, entries);
  };

  const handleToggle = async (on: boolean) => {
    if (!prefs) return;
    if (!on) {
      await apply({ ...prefs, enabled: false });
      return;
    }
    const ok = await requestNudgePermission();
    setGranted(ok);
    setBlocked(!ok);
    if (ok) {
      Haptics.selectionAsync();
      await apply({ ...prefs, enabled: true });
    }
  };

  const handleTest = async () => {
    const ok = await sendTestNudge();
    setGranted(ok);
    setBlocked(!ok);
    setTestSent(ok);
  };

  const pickCustom = (date?: Date) => {
    if (!prefs || !date) return;
    apply({ ...prefs, time: 'custom', custom: { hour: date.getHours(), minute: date.getMinutes() } });
  };

  if (!prefs) return null;
  const isOn = prefs.enabled && granted;
  const customAt = prefs.custom ? new Date(0, 0, 1, prefs.custom.hour, prefs.custom.minute) : new Date(0, 0, 1, 9, 0);

  return (
    <View className="bg-surface rounded-lg p-5 border border-border/50 gap-4">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center flex-1 mr-3">
          <Bell size={15} color={colors.accent} strokeWidth={2} />
          <Text className="font-sans-semi text-sm text-fg ml-2">Gentle nudges</Text>
        </View>
        <Switch
          value={isOn}
          onValueChange={handleToggle}
          accessibilityLabel="Gentle nudges"
          trackColor={{ false: colors.border, true: colors.accent }}
          thumbColor={Platform.OS === 'android' ? colors.surfaceLowest : undefined}
          ios_backgroundColor={colors.border}
        />
      </View>

      <Text className="font-sans text-sm text-fg-secondary leading-relaxed">
        When a thread sits untouched for a couple of days, Mnemo reminds you of it once, with
        its next step. Never more than one a day.
      </Text>

      {isOn && (
        <View className="flex-row flex-wrap gap-2">
          {NUDGE_TIME_KEYS.map((key) => (
            <Pill
              key={key}
              tone={colors.accent}
              size="md"
              dot={false}
              outline={prefs.time !== key}
              selected={prefs.time === key}
              onPress={() => apply({ ...prefs, time: key })}
            >
              {NUDGE_TIMES[key].label}
            </Pill>
          ))}
          <Pill
            tone={colors.accent}
            size="md"
            dot={false}
            outline={prefs.time !== 'custom'}
            selected={prefs.time === 'custom'}
            onPress={() => setPickingTime(true)}
          >
            {prefs.custom
              ? `Custom · ${prefs.custom.hour}:${String(prefs.custom.minute).padStart(2, '0')}`
              : 'Custom…'}
          </Pill>
        </View>
      )}

      {pickingTime &&
        (Platform.OS === 'ios' ? (
          <View>
            <DateTimePicker value={customAt} mode="time" display="spinner" onChange={(_, d) => pickCustom(d)} />
            <Button size="sm" variant="quiet" fullWidth onPress={() => setPickingTime(false)}>
              Done
            </Button>
          </View>
        ) : (
          <DateTimePicker
            value={customAt}
            mode="time"
            onChange={(e, d) => {
              setPickingTime(false);
              if (e.type === 'set') pickCustom(d);
            }}
          />
        ))}

      {isOn && (
        <View className="flex-row items-center justify-between gap-3">
          <Text className="font-sans text-sm text-fg-tertiary flex-1">
            {testSent ? 'Sent. It shows up in about 5 seconds, even with the app closed.' : 'Check that nudges reach you.'}
          </Text>
          <Button variant="quiet" size="sm" onPress={handleTest}>
            Send a test
          </Button>
        </View>
      )}

      {isOn && (
        <View className="flex-row items-center justify-between pt-4 border-t border-border/50">
          <View className="flex-1 mr-3">
            <Text className="font-sans-semi text-sm text-fg">Weekly review</Text>
            <Text className="font-sans text-sm text-fg-secondary mt-0.5">
              {reviewTimeLabel()}: your week, what's due and what went quiet.
            </Text>
          </View>
          <Switch
            value={prefs.weekly}
            onValueChange={(weekly) => apply({ ...prefs, weekly })}
            accessibilityLabel="Weekly review"
            trackColor={{ false: colors.border, true: colors.accent }}
            thumbColor={Platform.OS === 'android' ? colors.surfaceLowest : undefined}
            ios_backgroundColor={colors.border}
          />
        </View>
      )}

      {blocked && (
        <View className="flex-row items-center justify-between gap-3">
          <Text className="font-sans text-sm text-fg-tertiary flex-1">
            Notifications are off for Mnemo in your phone's settings.
          </Text>
          <Button variant="quiet" size="sm" onPress={() => Linking.openSettings()}>
            Open settings
          </Button>
        </View>
      )}

      {/* Reminders and nudges both depend on it, so it's here whether nudges are on or not. */}
      <Pressable
        onPress={() => router.push('/reminders-check')}
        accessibilityRole="button"
        className="flex-row items-center justify-between pt-4 border-t border-border/50 active:opacity-70"
      >
        <View className="flex-1 mr-3">
          <Text className="font-sans-semi text-sm text-fg">Make sure reminders arrive</Text>
          <Text className="font-sans text-sm text-fg-secondary mt-0.5">
            {verified
              ? 'Tested on this phone and working.'
              : strict
                ? `${strict} phones can hold reminders back. Check the settings and send a test.`
                : 'Check the settings and send a test reminder.'}
          </Text>
        </View>
        <Icon name="chevronRight" size={16} color={colors.fgTertiary} />
      </Pressable>
    </View>
  );
}
