import { View, Platform, Linking } from 'react-native';
import { ToggleSwitch } from '@/components/ui/ToggleRow';
import { Surface } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { Bell } from 'lucide-react-native';
import { haptic } from '@/lib/haptics';
import { useEffect, useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Button } from '@/components/ui/Button';
import { Pill } from '@/components/ui/Pill';
import { useThemeColors } from '@/hooks/use-theme';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import {
  NUDGE_TIMES,
  loadNudgePrefs,
  requestNudgePermission,
  saveNudgePrefs,
  scheduleNudges,
  sendTestNudge,
  type NudgePrefs,
  type NudgeTime,
} from '@/lib/nudges';
import { hasNotificationPermission } from '@/lib/notifications';
import { reviewTimeLabel, scheduleWeeklyReview } from '@/lib/review-notice';

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
  const [pickingTime, setPickingTime] = useState(false);
  const [testSent, setTestSent] = useState(false);

  useEffect(() => {
    loadNudgePrefs().then(setPrefs);
    hasNotificationPermission().then(setGranted);
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
      haptic.select();
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
    <Surface tone="soft" className="rounded-lg p-5 gap-4">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center flex-1 mr-3">
          <Bell size={15} color={colors.accent} strokeWidth={2} />
          <Text className="font-sans-semi text-sm text-fg ml-2">Gentle nudges</Text>
        </View>
        <ToggleSwitch value={isOn} onValueChange={handleToggle} label="Gentle nudges" />
      </View>

      {isOn && (
        <View className="flex-row flex-wrap gap-2">
          {NUDGE_TIME_KEYS.map((key) => (
            <Pill
              key={key}
              tone={colors.accent}
              selected={prefs.time === key}
              onPress={() => apply({ ...prefs, time: key })}
            >
              {NUDGE_TIMES[key].label}
            </Pill>
          ))}
          <Pill
            tone={colors.accent}
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
            {testSent ? 'Sent. It arrives in about 5 seconds.' : 'Test a nudge'}
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
              {reviewTimeLabel()}
            </Text>
          </View>
          <ToggleSwitch value={prefs.weekly} onValueChange={(weekly) => apply({ ...prefs, weekly })} label="Weekly review" />
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

    </Surface>
  );
}
