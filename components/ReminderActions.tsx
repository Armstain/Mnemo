import { useEffect, useRef } from 'react';
import { router } from 'expo-router';

import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useUndoToast } from '@/hooks/use-undo-toast';
import { Notifications, notificationsAvailable } from '@/lib/notifications';
import { remindOnce } from '@/lib/reminders';
import { afterReminder, formatReminder, queueSteps, rescheduled } from '@/lib/when';
import { saveTextNote } from '@/lib/capture';
import { markTestArrived, TEST_ROUTE } from '@/lib/reliability';
import { PLACE_NOTIFICATION } from '@/lib/places';

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
      // Handled once: a later remount (or relaunch) mustn't replay it, which
      // for a reply would add the same note twice.
      Notifications.clearLastNotificationResponseAsync?.().catch(() => {});

      // The test reminder came and was tapped: the check passed.
      if (content.data?.test) {
        markTestArrived().finally(() => router.navigate(TEST_ROUTE));
        return;
      }

      // The weekly review notification opens the review (once, if it's already open).
      if (content.data?.route === '/review') {
        router.navigate('/review');
        return;
      }

      const itemId = typeof content.data?.itemId === 'string' ? content.data.itemId : identifier;
      const s = storeRef.current;
      const item = s.getThread(itemId);
      const text = response.actionIdentifier === 'reply' ? response.userText?.trim() : undefined;
      Notifications.dismissNotificationAsync(identifier).catch(() => {});
      if (!item) {
        // The thread was deleted after the notification went out. Whatever
        // was typed is still kept, as a note of its own.
        if (text) {
          const saved = saveTextNote({ text, category: 'general', store: s });
          showToast({ message: "That thread is gone, so it's saved as a new note" });
          router.push(`/(tabs)/context?id=${saved.threadId}`);
        }
        return;
      }

      // A place reminder's buttons act on that reminder only, never on the thread's time reminder
      // or its next step (lib/geofence.ts tags them).
      if (content.data?.kind === PLACE_NOTIFICATION && response.actionIdentifier !== 'reply') {
        if (response.actionIdentifier === 'done') {
          const undo = s.completePlaceOccurrence(item.id);
          if (undo) showToast({ message: item.place?.repeat ? `Done for today: ${item.title}` : `Done: ${item.title}`, actionLabel: 'Undo', onAction: undo });
        } else if (response.actionIdentifier === 'hour') {
          // One more nudge on top; the thread's own time reminder (if any) is left as it is.
          const at = Date.now() + 60 * 60 * 1000;
          remindOnce(item, at);
          showToast({ message: `Reminding you ${formatReminder(at).toLowerCase()}` });
        }
        router.push(`/(tabs)/context?id=${item.id}`);
        return;
      }

      const stepAt = typeof content.data?.at === 'number' ? content.data.at : undefined;
      const later = stepAt === undefined ? undefined : item.laterSteps?.find((l) => l.at === stepAt);
      const otherSteps = item.laterSteps?.filter((l) => l !== later) ?? [];

      if (response.actionIdentifier === 'reply') {
        // What was typed into the notification goes into the thread; with
        // nothing typed, it just opens it.
        if (text) {
          saveTextNote({ text, category: item.category, threadId: item.id, filing: { by: 'user' }, store: s });
          showToast({ message: `Added to ${item.title}` });
        }
      } else if (response.actionIdentifier === 'done') {
        if (item.repeat && !later) {
          // One occurrence of a repeating reminder: the notification is gone, and the schedule and
          // the step it reminds of stay for the next one (ticking the step would erase it for good).
          showToast({ message: `Done for now: ${item.title}` });
        } else if (later) {
          const before = item.laterSteps;
          s.updateItem(item.id, { laterSteps: otherSteps.length > 0 ? otherSteps : undefined });
          showToast({ message: `Done: ${later.step ?? item.title}`, actionLabel: 'Undo', onAction: () => s.updateItem(item.id, { laterSteps: before }) });
        } else if (item.nextStep) {
          const step = item.nextStep;
          const undo = s.completeNextStep(item.id);
          showToast({ message: `Done: ${step}`, actionLabel: 'Undo', onAction: undo });
        } else if (!item.repeat) {
          s.updateItem(item.id, afterReminder(item));
        }
      } else if (response.actionIdentifier === 'hour' || response.actionIdentifier === 'tomorrow') {
        const at = response.actionIdentifier === 'hour' ? Date.now() + 60 * 60 * 1000 : tomorrowMorning();
        if (later) s.updateItem(item.id, { laterSteps: queueSteps(otherSteps, [{ ...later, at }]) });
        // A repeating reminder keeps its schedule; this is one more on top.
        else if (item.repeat) remindOnce(item, at);
        else s.updateItem(item.id, rescheduled(item, at));
        showToast({ message: `Reminding you ${formatReminder(at).toLowerCase()}` });
      }
      router.push(`/(tabs)/context?id=${item.id}`);
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
