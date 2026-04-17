import React, { createContext, useContext, useState, useEffect } from 'react';
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
  pending?: boolean;
  pendingRawText?: string;
  pendingAudioUri?: string;
}

interface ContextStoreType {
  contexts: ContextDump[];
  addContext: (context: Omit<ContextDump, 'id' | 'createdAt'>) => ContextDump;
  updateContext: (id: string, updates: Partial<ContextDump>) => void;
  deleteContext: (id: string) => void;
  isLoaded: boolean;
}

const StoreContext = createContext<ContextStoreType | undefined>(undefined);

const STORAGE_KEY = 'mnemo-work-contexts';

export function ContextStoreProvider({ children }: { children: React.ReactNode }) {
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
      const data = JSON.stringify(contexts);
      if (Platform.OS === 'web') {
        localStorage.setItem(STORAGE_KEY, data);
      } else {
        SecureStore.setItemAsync(STORAGE_KEY, data);
      }
    }
  }, [contexts, isLoaded]);

  const addContext = (context: Omit<ContextDump, 'id' | 'createdAt'>) => {
    const newContext: ContextDump = {
      ...context,
      id: Math.random().toString(36).substring(7),
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

  return (
    <StoreContext.Provider value={{ contexts, addContext, updateContext, deleteContext, isLoaded }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useContextStore() {
  const context = useContext(StoreContext);
  if (context === undefined) {
    throw new Error('useContextStore must be used within a ContextStoreProvider');
  }
  return context;
}
