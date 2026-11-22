import { useSyncExternalStore } from 'react';

import { createEmitter } from '@/lib/emitter';

export function createValueStore<T>(initial: T) {
  let current = initial;
  const changed = createEmitter();
  return {
    get: (): T => current,
    set(next: T): void {
      current = next;
      changed.emit();
    },
    subscribe: changed.on,
    useValue: (): T => useSyncExternalStore(changed.on, () => current, () => current),
  };
}
