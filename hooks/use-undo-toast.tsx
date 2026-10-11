import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

/**
 * How long a soft delete waits before it's persisted for real. Matched by
 * use-mnemo-store's own delete timer so the toast and the actual data
 * lifetime never drift apart — undo always works for exactly as long as
 * the toast says it will.
 */
export const UNDO_WINDOW_MS = 4000;

interface ToastState {
  id: number;
  message: string;
  actionLabel: string;
  onAction: () => void;
}

export interface ToastOptions {
  message: string;
  /** Defaults to "Undo". */
  actionLabel?: string;
  onAction: () => void;
  /** Defaults to UNDO_WINDOW_MS. */
  durationMs?: number;
}

interface UndoToastContextType {
  toast: ToastState | null;
  showUndoToast: (message: string, onUndo: () => void) => void;
  /** A toast with its own action ("Move", "Open") and duration. */
  showToast: (options: ToastOptions) => void;
  dismiss: () => void;
}

const UndoToastContext = createContext<UndoToastContextType | undefined>(undefined);

/**
 * One toast slot, app-wide. A second delete while one is showing replaces
 * it rather than stacking — the prior action has already been committed
 * to its own timer in the store, it just loses its visible undo window.
 */
export function UndoToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);

  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setToast(null);
  }, []);

  const showToast = useCallback(
    ({ message, actionLabel = 'Undo', onAction, durationMs = UNDO_WINDOW_MS }: ToastOptions) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const id = ++idRef.current;
      setToast({ id, message, actionLabel, onAction });
      timerRef.current = setTimeout(() => {
        setToast((current) => (current?.id === id ? null : current));
      }, durationMs);
    },
    [],
  );

  const showUndoToast = useCallback(
    (message: string, onUndo: () => void) => showToast({ message, onAction: onUndo }),
    [showToast],
  );

  return (
    <UndoToastContext.Provider value={{ toast, showUndoToast, showToast, dismiss }}>
      {children}
    </UndoToastContext.Provider>
  );
}

export function useUndoToast() {
  const context = useContext(UndoToastContext);
  if (context === undefined) {
    throw new Error('useUndoToast must be used within an UndoToastProvider');
  }
  return context;
}
