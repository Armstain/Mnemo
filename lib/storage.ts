import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const browser: KeyValueStore = {
  get: async (key) => (typeof localStorage === 'undefined' ? null : localStorage.getItem(key)),
  set: async (key, value) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  },
  remove: async (key) => {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  },
};

const secure = () => require('expo-secure-store') as typeof import('expo-secure-store');

const onPhone = (native: KeyValueStore): KeyValueStore => (Platform.OS === 'web' ? browser : native);

export const storage = onPhone({
  get: async (key) => AsyncStorage.getItem(key),
  set: async (key, value) => AsyncStorage.setItem(key, value),
  remove: async (key) => AsyncStorage.removeItem(key),
});

export const secureStorage = onPhone({
  get: async (key) => secure().getItemAsync(key),
  set: async (key, value) => secure().setItemAsync(key, value),
  remove: async (key) => secure().deleteItemAsync(key),
});

export async function readJson(key: string): Promise<unknown> {
  const raw = await storage.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): Promise<void> {
  return storage.set(key, JSON.stringify(value));
}
