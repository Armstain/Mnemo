import { useEffect, useRef } from 'react';
import { router } from 'expo-router';

import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useUndoToast } from '@/hooks/use-undo-toast';
import { Notifications, notificationsAvailable } from '@/lib/notifications';
import { remindOnce } from '@/lib/reminders';
import { formatReminder } from '@/lib/when';

type Response = import('expo-notifications').NotificationResponse;

function tomorrowMorning(): number {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

/**
 * What tapping a reminder (or one of its buttons) does. Mounted inside the
 * store, so "Done" and "Later" act on the thread; responses that launched
 * the app wait until the notes are loaded.
 */
export function ReminderActions() {
  const store = useMnemoStore();
  const { showToast } = useUndoToast();
  const storeRef = useRef(store);
  storeRef.current = store;
  const handled = useRef(new Set<string>());

  useEffect(() => {
    if (!notificationsAvailable || !store.isLoaded) return;

    const handle = (response: Response) => {
      const { identifier, content } = response.notification.request;
      const key = `${identifier}|${response.notification.date}|${response.actionIdentifier}`;
      if (handled.current.has(key)) return;
      handled.current.add(key);

      const itemId = typeof content.data?.itemId === 'string' ? content.data.itemId : identifier;
      const s = storeRef.current;
      const item = s.getThread(itemId);
      if (!item) return;
      Notifications.dismissNotificationAsync(response.notification.request.identifier).catch(() => {});

      if (response.actionIdentifier === 'done') {
        if (item.nextStep) {
          const step = item.nextStep;
          const undo = s.completeNextStep(item.id);
          showToast({ message: `Done: ${step}`, actionLabel: 'Undo', onAction: undo });
        } else if (!item.repeat) {
          s.updateItem(item.id, { dueDate: undefined });
        }
      } else if (response.actionIdentifier === 'hour' || response.actionIdentifier === 'tomorrow') {
        const at = response.actionIdentifier === 'hour' ? Date.now() + 60 * 60 * 1000 : tomorrowMorning();
        // A repeating reminder keeps its schedule; this is one more on top.
        if (item.repeat) remindOnce(item, at);
        else s.updateItem(item.id, { dueDate: at });
        showToast({ message: `Reminding you ${formatReminder(at).toLowerCase()}` });
      }
      router.push(`/(tabs)/context?id=${item.id}` as any);
    };

    // The tap that opened the app, then any while it's open.
    Notifications.getLastNotificationResponseAsync()
      .then((last) => last && handle(last))
      .catch(() => {});
    const subscription = Notifications.addNotificationResponseReceivedListener(handle);
    return () => subscription.remove();
  }, [store.isLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
