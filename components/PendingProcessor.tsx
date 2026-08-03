import { useEffect, useRef } from 'react';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { resolvePendingItem } from '@/lib/capture';

/**
 * Invisible component mounted at the app root.
 * On startup it finds any items that were saved while offline (or whose
 * background AI processing never finished) and retries structuring them
 * via Gemini once connectivity is available.
 */
export function PendingProcessor() {
  const { items, isLoaded, updateItem } = useMnemoStore();
  const hasRun = useRef(false);

  useEffect(() => {
    if (!isLoaded || hasRun.current) return;
    hasRun.current = true;

    const pending = items.filter((c) => c.pending);
    for (const item of pending) {
      resolvePendingItem(item, updateItem);
    }
  }, [isLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
