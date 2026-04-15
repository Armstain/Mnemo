import { useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export interface ContextDump {
  id: string;
  title: string;
  notes: string;
  links: string[];
  createdAt: number;
  summary?: {
    leftOff: string;
    nextSteps: string[];
    resources: { name: string; url: string }[];
  };
  /** True when AI structuring is queued for later (e.g. recorded offline). */
  pending?: boolean;
  /** Raw text to be structured by AI when connectivity returns. */
  pendingRawText?: string;
  /** Permanent local URI of an audio file to be transcribed when connectivity returns. */
  pendingAudioUri?: string;
}

const STORAGE_KEY = 'mnemo-work-contexts';

export function useContextStore() {
  const [contexts, setContexts] = useState<ContextDump[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load contexts on mount
  useEffect(() => {
    async function load() {
      try {
        let stored: string | null = null;
        if (Platform.OS === 'web') {
          stored = localStorage.getItem(STORAGE_KEY);
        } else {
          stored = await SecureStore.getItemAsync(STORAGE_KEY);
        }
        if (stored) {
          setContexts(JSON.parse(stored));
        }
      } catch (e) {
        console.error('Failed to load contexts', e);
      } finally {
        setIsLoaded(true);
      }
    }
    load();
  }, []);

  // Save contexts whenever they change
  useEffect(() => {
    if (isLoaded) {
      if (Platform.OS === 'web') {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(contexts));
        } catch (e) {
          console.error('Failed to save contexts to localStorage', e);
        }
      } else {
        SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(contexts))
          .catch(e => console.error('Failed to save contexts', e));
      }
    }
  }, [contexts, isLoaded]);

  const addContext = (context: Omit<ContextDump, 'id' | 'createdAt'>) => {
    const newContext: ContextDump = {
      ...context,
      id: Math.random().toString(36).substring(7), // Simple ID for now
      createdAt: Date.now(),
    };
    setContexts((prev) => [newContext, ...prev]);
    return newContext;
  };

  const updateContext = (id: string, updates: Partial<ContextDump>) => {
    setContexts((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...updates } : c))
    );
  };

  const deleteContext = (id: string) => {
    setContexts((prev) => prev.filter((c) => c.id !== id));
  };

  return {
    contexts,
    addContext,
    updateContext,
    deleteContext,
    isLoaded,
  };
}
