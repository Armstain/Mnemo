import { useSyncExternalStore } from 'react';

// Whether the capture button is "in use" (its menu open, or recording), so
// the tab bar can move its dot under the button and close the menu when a
// tab is tapped. Module state: there's only ever one capture button.

let active = false;
let close: (() => void) | null = null;
const listeners = new Set<() => void>();

export function setCaptureActive(value: boolean, onClose?: () => void): void {
  close = onClose ?? null;
  if (active === value) return;
  active = value;
  listeners.forEach((l) => l());
}

/** Closes the capture menu, if it's open. */
export function closeCapture(): void {
  close?.();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCaptureActive(): boolean {
  return useSyncExternalStore(subscribe, () => active, () => active);
}
