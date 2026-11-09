import { useCallback } from 'react';

import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useUndoToast } from '@/hooks/use-undo-toast';
import { celebrate, completionFeedback, finishModel } from '@/lib/done';
import { haptic } from '@/utils/haptics';

/**
 * Finishing a thread: the one implementation behind every "Done" that finishes one (the thread
 * screen, Wrap-up, a notification's Done on a single task). The store's `completeItem` changes
 * the state once (a second tap returns null, and nothing plays twice), ticking a single task's
 * step with it; the feedback is `completionFeedback`, plus one toast whose Undo restores it all.
 * Returns whether it finished it now.
 */
export function useCompleteThread(): (threadId: string) => boolean {
  const { completeItem, getEntries, focusThreadId, setFocusThread } = useMnemoStore();
  const { showToast } = useUndoToast();
  return useCallback(
    (threadId: string) => {
      const wasFocus = focusThreadId === threadId;
      const done = completeItem(threadId);
      if (!done) return false;
      const feedback = completionFeedback(done.before, getEntries(threadId));
      // The celebration plays its own haptics.
      if (feedback.celebration) celebrate(feedback.celebration);
      else haptic.success();
      showToast({
        message: feedback.toast,
        actionLabel: 'Undo',
        onAction: () => {
          done.undo();
          if (wasFocus) setFocusThread(threadId);
        },
      });
      return true;
    },
    [completeItem, getEntries, focusThreadId, setFocusThread, showToast],
  );
}

/**
 * Ticking a thread's next step, wherever its check is (the thread, Welcome, the weekly review).
 * On a thread that is one thing to do, the step is the task, so it finishes the thread (one
 * Done, one feedback); otherwise it ticks the step, with Undo.
 */
export function useStepDone(): (threadId: string) => void {
  const { getThread, getEntries, completeNextStep } = useMnemoStore();
  const { showUndoToast } = useUndoToast();
  const completeThread = useCompleteThread();
  return useCallback(
    (threadId: string) => {
      const thread = getThread(threadId);
      if (!thread?.nextStep) return;
      if (finishModel(thread, getEntries(threadId)) === 'single') {
        completeThread(threadId);
        return;
      }
      const step = thread.nextStep;
      showUndoToast(`Done: ${step}`, completeNextStep(threadId));
    },
    [getThread, getEntries, completeNextStep, completeThread, showUndoToast],
  );
}
