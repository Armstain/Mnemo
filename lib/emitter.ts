export function createEmitter<T = void>() {
  const listeners = new Set<(value: T) => void>();
  return {
    on(listener: (value: T) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(value: T): void {
      for (const listener of [...listeners]) {
        try {
          listener(value);
        } catch (e) {
          console.error('A listener failed', e);
        }
      }
    },
  };
}
