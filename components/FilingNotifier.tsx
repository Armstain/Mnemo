import { useEffect, useRef } from 'react';
import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import { haptic } from '@/utils/haptics';

import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useUndoToast } from '@/hooks/use-undo-toast';
import { Platform } from 'react-native';
import { onReminderSet } from '@/lib/capture';
import { onFiling } from '@/lib/filing';
import { hasNudgePermission, requestNudgePermission } from '@/lib/nudges';
import { formatReminder } from '@/lib/when';

const FILED_TOAST_MS = 6000;

/**
 * Invisible, mounted at the app root. When the background pipeline files a
 * capture (lib/filing.ts), says where it went with a toast that can undo
 * it, and follows the entry if its old thread was the one on screen.
 */
export function FilingNotifier() {
  const store = useMnemoStore();
  const { showToast } = useUndoToast();
  const pathname = usePathname();
  const { id } = useGlobalSearchParams<{ id?: string }>();

  // Read inside the listener, which outlives renders.
  const storeRef = useRef(store);
  storeRef.current = store;
  const routeRef = useRef({ pathname, id });
  routeRef.current = { pathname, id };

  useEffect(() => {
    const viewing = (threadId: string) =>
      routeRef.current.pathname.includes('context') && routeRef.current.id === threadId;
    const open = (threadId: string) => router.replace(`/(tabs)/context?id=${threadId}`);
    /** Moves a note back or on; says why when that would have cost a reminder (the store's fileEntry). */
    const move = (entryId: string, toThreadId: string): boolean => {
      const filed = storeRef.current.fileEntry(entryId, toThreadId, { by: 'user' });
      if (!filed.moved && filed.reason) showToast({ message: filed.reason });
      return filed.moved;
    };

    // A note that set a reminder says when, so there's no guessing; and if
    // notifications are off, that it can't arrive yet.
    const stopReminders = onReminderSet(async (event) => {
      const s = storeRef.current;
      const allowed = Platform.OS === 'web' || (await hasNudgePermission());
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
      showToast({
        message: `Reminder set · ${when}`,
        actionLabel: 'Undo',
        durationMs: FILED_TOAST_MS,
        onAction: () => s.updateItem(event.threadId, { dueDate: event.previous }),
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
