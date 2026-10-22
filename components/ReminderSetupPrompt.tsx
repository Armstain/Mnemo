import React from 'react';
import { Platform } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import { HomeBanner } from '@/components/ui/HomeBanner';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { notificationsAvailable } from '@/lib/notifications';
import { hasNudgePermission, loadNudgePrefs } from '@/lib/nudges';
import { loadSetup, markSetup, strictPhone } from '@/lib/reliability';

/**
 * Once, on phones known to hold reminders back (Xiaomi, Oppo, Vivo…), and
 * only for someone relying on them: a reminder set, or nudges on. Gone for
 * good after a test reminder arrives or "Not now".
 */
export function ReminderSetupPrompt() {
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
    <HomeBanner
      icon="clock"
      title="Make sure reminders reach you"
      body={`${strict} phones can hold them back. A minute to check.`}
      onPress={() => router.push('/reminders-check')}
      onDismiss={() => {
        setShow(false);
        markSetup({ dismissedAt: Date.now() });
      }}
    />
  );
}
