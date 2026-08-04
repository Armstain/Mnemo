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
  onUndo: () => void;
}

interface UndoToastContextType {
  toast: ToastState | null;
  showUndoToast: (message: string, onUndo: () => void) => void;
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

  const showUndoToast = useCallback((message: string, onUndo: () => void) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const id = ++idRef.current;
    setToast({ id, message, onUndo });
    timerRef.current = setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, UNDO_WINDOW_MS);
  }, []);

  return (
    <UndoToastContext.Provider value={{ toast, showUndoToast, dismiss }}>
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
