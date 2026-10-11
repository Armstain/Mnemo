import { useState } from 'react';

import { useMnemoStore } from '@/hooks/use-mnemo-store';
import type { Filing, MnemoItem } from '@/types/mnemo';

/**
 * Where a capture screen saves to. Opened from a thread (`?threadId=`), it's
 * that thread. Otherwise it's the focus thread if one is set, unless the
 * person taps "Keep separate" for this one capture; then a new thread.
 */
export function useCaptureTarget(threadIdParam?: string | string[]) {
  const { items, focusThreadId } = useMnemoStore();
  const [separate, setSeparate] = useState(false);

  const explicitId = typeof threadIdParam === 'string' && threadIdParam ? threadIdParam : undefined;
  const explicit = explicitId ? items.find((i) => i.id === explicitId) : undefined;
  const focusThread: MnemoItem | undefined =
    !explicit && focusThreadId ? items.find((i) => i.id === focusThreadId) : undefined;
  const destination = explicit ?? (separate ? undefined : focusThread);
  const filing: Filing | undefined = explicit
    ? { by: 'user' }
    : destination
      ? { by: 'focus' }
      : undefined;

  return { explicit, focusThread, destination, filing, separate, setSeparate };
}
