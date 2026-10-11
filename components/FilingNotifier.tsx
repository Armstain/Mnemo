import { useEffect, useRef } from 'react';
import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useUndoToast } from '@/hooks/use-undo-toast';
import { onFiling } from '@/lib/filing';

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
    const open = (threadId: string) => router.replace(`/(tabs)/context?id=${threadId}` as any);
    /** Drops a thread an entry just left, if that left it empty. */
    const dropIfEmpty = (threadId: string) => {
      const s = storeRef.current;
      if (!s.snapshot().entries.some((e) => e.threadId === threadId)) s.removeThreadNow(threadId);
    };

    return onFiling((event) => {
      const s = storeRef.current;
      if (event.type === 'attached') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
            s.moveEntry(event.entryId, event.toThreadId, { by: 'user' });
            dropIfEmpty(event.threadId);
            if (viewing(event.threadId)) open(event.toThreadId);
          },
        });
      } else {
        showToast({
          message: `Kept apart from ${event.fromTitle}`,
          durationMs: FILED_TOAST_MS,
          onAction: () => {
            s.moveEntry(event.entryId, event.fromThreadId, { by: 'user' });
            dropIfEmpty(event.toThreadId);
            if (viewing(event.toThreadId)) open(event.fromThreadId);
          },
        });
      }
    });
  }, [showToast]);

  return null;
}
