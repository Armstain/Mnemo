import { useCallback } from 'react';

import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useUndoToast } from '@/hooks/use-undo-toast';
import { celebrate, completionFeedback } from '@/lib/done';
import { haptic } from '@/utils/haptics';

/**
 * Finishing a thread: the one implementation behind every "Done" that finishes one (the thread
 * screen, Wrap-up). The store's `completeItem` changes the state once (a second tap returns null,
 * and nothing plays twice); the feedback is `completionFeedback`, plus one toast with Undo.
 * Returns whether it finished it now.
 */
export function useCompleteThread(): (threadId: string) => boolean {
  const { completeItem, restoreItem, getEntries, focusThreadId, setFocusThread } = useMnemoStore();
  const { showToast } = useUndoToast();
  return useCallback(
    (threadId: string) => {
      const wasFocus = focusThreadId === threadId;
      const before = completeItem(threadId);
      if (!before) return false;
      const feedback = completionFeedback(before, getEntries(threadId));
      // The celebration plays its own haptics.
      if (feedback.celebration) celebrate(feedback.celebration);
      else haptic.success();
      showToast({
        message: feedback.toast,
        actionLabel: 'Undo',
        onAction: () => {
          restoreItem(before);
          if (wasFocus) setFocusThread(before.id);
        },
      });
      return true;
    },
    [completeItem, restoreItem, getEntries, focusThreadId, setFocusThread, showToast],
  );
}
