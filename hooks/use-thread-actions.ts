import { useCallback } from 'react';

import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useUndoToast } from '@/hooks/use-undo-toast';
import { DAY_MS } from '@/utils/time';
import { STILL_ON_IT_DAYS } from '@/lib/review';
import type { MnemoItem } from '@/types/mnemo';

export function useDeleteThread(): (item: Pick<MnemoItem, 'id' | 'title'>) => void {
  const { deleteItem, undoDelete } = useMnemoStore();
  const { showUndoToast } = useUndoToast();
  return useCallback(
    (item) => {
      deleteItem(item.id);
      showUndoToast(`"${item.title}" deleted`, () => undoDelete(item.id));
    },
    [deleteItem, undoDelete, showUndoToast],
  );
}

export function useQuietActions(): {
  stillOnIt: (item: MnemoItem) => void;
  pause: (item: MnemoItem) => void;
} {
  const { updateItem, restoreItem } = useMnemoStore();
  const { showUndoToast } = useUndoToast();
  return {
    stillOnIt: (item) => {
      updateItem(item.id, { quietUntil: Date.now() + STILL_ON_IT_DAYS * DAY_MS }, { touch: false });
      showUndoToast(`Won't ask about it for a month`, () => restoreItem(item));
    },
    pause: (item) => {
      updateItem(item.id, { status: 'paused' });
      showUndoToast(`Paused ${item.title}`, () => restoreItem(item));
    },
  };
}
