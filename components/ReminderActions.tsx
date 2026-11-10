import { useEffect, useRef } from 'react';
import { router } from 'expo-router';

import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useUndoToast } from '@/hooks/use-undo-toast';
import { ACTIONS, notificationData, Notifications, notificationsAvailable } from '@/lib/notifications';
import { HOUR_MS, remindOnce } from '@/lib/reminders';
import { afterReminder, formatReminder, queueSteps, rescheduled } from '@/lib/when';
import { saveNote } from '@/lib/capture';
import { markTestArrived } from '@/lib/reliability';
import { PLACE_NOTIFICATION } from '@/lib/places';
import { finishModel } from '@/lib/done';
import { useCompleteThread } from '@/hooks/use-complete-thread';
import { remindersCheckHref, reviewHref, threadHref } from '@/lib/routes';

type Response = import('expo-notifications').NotificationResponse;

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
  // Done on a notification follows the thread's rule like every other Done (lib/done.ts finishModel).
  const completeThread = useCompleteThread();
  const completeRef = useRef(completeThread);
  useEffect(() => {
    completeRef.current = completeThread;
  }, [completeThread]);

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

      const data = notificationData(content.data);
      if (data.test) {
        markTestArrived().finally(() => router.navigate(remindersCheckHref));
        return;
      }

      if (data.route === reviewHref) {
        router.navigate(reviewHref);
        return;
      }

      const s = storeRef.current;
      const item = s.getThread(data.itemId ?? identifier);
      const text = response.actionIdentifier === ACTIONS.reply ? response.userText?.trim() : undefined;
      Notifications.dismissNotificationAsync(identifier).catch(() => {});
      if (!item) {
        // The thread was deleted after the notification went out. Whatever
        // was typed is still kept, as a note of its own.
        if (text) {
          const saved = saveNote('text', { text, category: 'general', store: s });
          showToast({ message: "That thread is gone, so it's saved as a new note" });
          router.push(threadHref(saved.threadId));
        }
        return;
      }

      // A place reminder's buttons act on that reminder only, never on the thread's time reminder
      // or its next step (lib/geofence.ts tags them).
      if (data.kind === PLACE_NOTIFICATION && response.actionIdentifier !== ACTIONS.reply) {
        if (response.actionIdentifier === ACTIONS.done && !item.place?.repeat && finishModel(item, s.getEntries(item.id)) === 'single') {
          completeRef.current(item.id);
        } else if (response.actionIdentifier === ACTIONS.done) {
          const undo = s.completePlaceOccurrence(item.id);
          if (undo) showToast({ message: item.place?.repeat ? `Done for today: ${item.title}` : `Done: ${item.title}`, actionLabel: 'Undo', onAction: undo });
        } else if (response.actionIdentifier === ACTIONS.hour) {
          // One more nudge on top; the thread's own time reminder (if any) is left as it is.
          const at = Date.now() + HOUR_MS;
          remindOnce(item, at);
          showToast({ message: `Reminding you ${formatReminder(at).toLowerCase()}` });
        }
        router.push(threadHref(item.id));
        return;
      }

      const later = data.at === undefined ? undefined : item.laterSteps?.find((l) => l.at === data.at);
      const otherSteps = item.laterSteps?.filter((l) => l !== later) ?? [];

      if (response.actionIdentifier === ACTIONS.reply) {
        if (text) {
          saveNote('text', { text, category: item.category, threadId: item.id, filing: { by: 'user' }, store: s });
          showToast({ message: `Added to ${item.title}` });
        }
      } else if (response.actionIdentifier === ACTIONS.done) {
        const model = finishModel(item, s.getEntries(item.id));
        if (item.repeat && !later) {
          // One occurrence of a repeating reminder: the notification is gone, and the schedule and
          // the step it reminds of stay for the next one (ticking the step would erase it for good).
          showToast({ message: `Done for now: ${item.title}` });
        } else if (later) {
          const before = item.laterSteps;
          s.updateItem(item.id, { laterSteps: otherSteps.length > 0 ? otherSteps : undefined });
          showToast({ message: `Done: ${later.step ?? item.title}`, actionLabel: 'Undo', onAction: () => s.updateItem(item.id, { laterSteps: before }) });
        } else if (model === 'single') {
          completeRef.current(item.id);
        } else if (item.nextStep) {
          const step = item.nextStep;
          const undo = s.completeNextStep(item.id);
          showToast({ message: `Done: ${step}`, actionLabel: 'Undo', onAction: undo });
        } else if (!item.repeat) {
          s.updateItem(item.id, afterReminder(item));
        }
      } else if (response.actionIdentifier === ACTIONS.hour) {
        const at = Date.now() + HOUR_MS;
        if (later) s.updateItem(item.id, { laterSteps: queueSteps(otherSteps, [{ ...later, at }]) });
        // A repeating reminder keeps its schedule; this is one more on top.
        else if (item.repeat) remindOnce(item, at);
        else s.updateItem(item.id, rescheduled(item, at));
        showToast({ message: `Reminding you ${formatReminder(at).toLowerCase()}` });
      }
      router.push(threadHref(item.id));
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
