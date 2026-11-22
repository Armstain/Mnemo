import { useEffect, useRef } from 'react';
import { router } from 'expo-router';
import { haptic } from '@/lib/haptics';

import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useUndoToast } from '@/hooks/use-undo-toast';
import { useViewingThreadId } from '@/hooks/use-viewing-thread';
import { Platform } from 'react-native';
import { onFiling, onReminderSet } from '@/lib/filing';
import { hasNotificationPermission } from '@/lib/notifications';
import { requestNudgePermission } from '@/lib/nudges';
import { formatReminder } from '@/lib/when';
import { dismissSavedNotice, postSavedNotice, undoFor } from '@/lib/saved-notice';
import { threadHref } from '@/lib/routes';

const FILED_TOAST_MS = 6000;

/** Mounted at the app root: says where a filed capture went, with an Undo, and follows it if its old thread is on screen. */
export function FilingNotifier() {
  const store = useMnemoStore();
  const { showToast } = useUndoToast();
  const viewingId = useViewingThreadId();

  // Read inside the listener, which outlives renders.
  const storeRef = useRef(store);
  storeRef.current = store;
  const viewingRef = useRef(viewingId);
  viewingRef.current = viewingId;

  useEffect(() => {
    const viewing = (threadId: string) => viewingRef.current === threadId;
    const open = (threadId: string) => router.replace(threadHref(threadId));
    const move = (entryId: string, toThreadId: string): boolean => {
      const filed = storeRef.current.fileEntry(entryId, toThreadId, { by: 'user' });
      if (!filed.moved && filed.reason) showToast({ message: filed.reason });
      return filed.moved;
    };

    // A note that set a reminder says when, so there's no guessing; and if
    // notifications are off, that it can't arrive yet. It's said in the tray
    // too, with Undo / Change / Add note there (lib/saved-notice.ts), for
    // when the phone went back in a pocket before the time was read.
    const stopReminders = onReminderSet(async (event) => {
      const s = storeRef.current;
      const allowed = Platform.OS === 'web' || (await hasNotificationPermission());
      const thread = s.getThread(event.threadId);
      const when = formatReminder(event.at);
      if (!allowed) {
        showToast({
          message: `Reminder set for ${when}, but notifications are off`,
          actionLabel: 'Allow',
          durationMs: FILED_TOAST_MS,
          onAction: () => requestNudgePermission(),
        });
        return;
      }
      if (thread) postSavedNotice(thread, event.at, event.before);
      showToast({
        message: `Reminder set · ${when}`,
        actionLabel: 'Undo',
        durationMs: FILED_TOAST_MS,
        onAction: () => {
          const now = s.getThread(event.threadId);
          const undo = now && undoFor(now, { at: event.at, before: event.before });
          if (undo) s.updateItem(event.threadId, undo);
          dismissSavedNotice(event.threadId);
        },
      });
    });

    const stopFiling = onFiling((event) => {
      const s = storeRef.current;
      if (event.type === 'attached') {
        haptic.success();
        if (viewing(event.fromThreadId)) open(event.toThreadId);
        showToast({
          message: `Added to ${event.toTitle}`,
          durationMs: FILED_TOAST_MS,
          onAction: () => {
            const created = s.moveEntryToNewThread(event.entryId, {
              title: event.ownTitle,
              category: event.ownCategory,
              tags: [],
            });
            if (created && viewing(event.toThreadId)) open(created.id);
          },
        });
      } else if (event.type === 'suggested') {
        showToast({
          message: `Part of ${event.toTitle}?`,
          actionLabel: 'Move',
          durationMs: FILED_TOAST_MS,
          onAction: () => {
            if (move(event.entryId, event.toThreadId) && viewing(event.threadId)) open(event.toThreadId);
          },
        });
      } else {
        showToast({
          message: `Kept apart from ${event.fromTitle}`,
          durationMs: FILED_TOAST_MS,
          onAction: () => {
            if (move(event.entryId, event.fromThreadId) && viewing(event.toThreadId)) open(event.fromThreadId);
          },
        });
      }
    });
    return () => {
      stopReminders();
      stopFiling();
    };
  }, [showToast]);

  return null;
}
