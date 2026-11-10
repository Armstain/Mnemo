import { secureStorage } from '@/lib/storage';

const KEY = 'mnemo-onboarded';

export async function isOnboarded(): Promise<boolean> {
  return (await secureStorage.get(KEY)) === 'true';
}

export const markOnboarded = (): Promise<void> => secureStorage.set(KEY, 'true');

export const resetOnboarding = (): Promise<void> => secureStorage.remove(KEY);
