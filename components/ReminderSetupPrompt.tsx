import React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { MotiView } from 'moti';

import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import { notificationsAvailable } from '@/lib/notifications';
import { hasNudgePermission, loadNudgePrefs } from '@/lib/nudges';
import { loadSetup, markSetup, strictPhone } from '@/lib/reliability';
import { useEnter } from '@/utils/motion';

/**
 * Once, on phones known to hold reminders back (Xiaomi, Oppo, Vivo…), and
 * only for someone relying on them: a reminder set, or nudges on. Gone for
 * good after a test reminder arrives or "Not now".
 */
export function ReminderSetupPrompt() {
  const colors = useThemeColors();
  const enter = useEnter();
  const { items } = useMnemoStore();
  const strict = Platform.OS === 'android' && notificationsAvailable ? strictPhone() : null;
  const [show, setShow] = React.useState(false);
  const hasReminder = items.some((t) => (t.status === 'active' || t.status === 'paused') && t.dueDate);

  useFocusEffect(
    React.useCallback(() => {
      if (!strict) return;
      let live = true;
      (async () => {
        const setup = await loadSetup();
        if (setup.verifiedAt || setup.dismissedAt) return live && setShow(false);
        const relies = hasReminder || ((await loadNudgePrefs()).enabled && (await hasNudgePermission()));
        if (live) setShow(relies);
      })();
      return () => {
        live = false;
      };
    }, [strict, hasReminder]),
  );

  if (!strict || !show) return null;
  return (
    <MotiView {...enter.fade(1)} className="flex-row items-center rounded-lg mt-4" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
      <Pressable
        onPress={() => router.push('/reminders-check' as any)}
        accessibilityRole="button"
        className="flex-1 flex-row items-center pl-4 py-3 active:opacity-80"
      >
        <View className="w-8 h-8 rounded-full items-center justify-center mr-3" style={{ backgroundColor: colors.accentSoft }}>
          <Icon name="clock" size={16} color={colors.accent} stroke={2} />
        </View>
        <View className="flex-1">
          <Text className="font-sans-semi text-sm" style={{ color: colors.fg }}>
            Make sure reminders reach you
          </Text>
          <Text className="font-sans text-sm" style={{ color: colors.fgSecondary }}>
            {strict} phones can hold them back. A minute to check.
          </Text>
        </View>
      </Pressable>
      <Pressable
        onPress={() => {
          setShow(false);
          markSetup({ dismissedAt: Date.now() });
        }}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Not now"
        className="w-11 h-11 items-center justify-center mr-1 active:opacity-60"
      >
        <Icon name="x" size={16} color={colors.fgTertiary} />
      </Pressable>
    </MotiView>
  );
}
